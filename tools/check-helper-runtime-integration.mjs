#!/usr/bin/env node
// Helper runtime integration smoke checker (H1d) + H2 Gate 2 smoke-path guard
// + H2 Gate 3 unsafe-diagnostic fail-closed guard.
//
// Positive control: runs lvk-tracker-core with the explicit --helper-runtime-smoke
// path and validates that stdout contains only existing MotionFrame JSON while
// helper stdout/stderr stay private to Native Core.
//
// Gate 2 guard: runs lvk-tracker-core WITHOUT --helper-runtime-smoke and proves
// the default runtime path is unchanged -- helper supervision is not entered,
// stdout is MotionFrame JSON only, and no helper smoke diagnostics or private
// helper child output leak to stdout/stderr. Synthetic/smoke-only, CI-safe (the
// default path uses the dummy camera; no real camera, no hardware). See
// docs/TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md.
//
// Gate 3 guard: runs the explicit smoke path with --helper-runtime-smoke-case
// unsafe-diagnostic, where the synthetic helper emits one unsafe stderr
// diagnostic. The runtime smoke must FAIL CLOSED -- non-zero exit, EMPTY public
// stdout (no MotionFrame, no fallback frame), and no unsafe child output
// forwarded to any public stream. The unsafe child stderr stays private to
// Native Core. Synthetic/smoke-only, CI-safe (no camera). See
// docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const trackerPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const helperPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

const fail = (message, result) => {
  console.error(`Helper runtime integration smoke check failed: ${message}`);
  if (result) {
    const snippet = (value) => {
      const trimmed = (value ?? "").trim();
      if (trimmed.length === 0) return "(empty)";
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    };
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${snippet(result.stderr)}`);
    console.error(`stdout: ${snippet(result.stdout)}`);
  }
  process.exit(1);
};

if (!trackerPath || !helperPath) {
  fail(
    "expected two arguments: <lvk-tracker-core-path> <lvk-synthetic-helper-path>",
  );
}

const result = spawnSync(
  trackerPath,
  ["--helper-runtime-smoke", helperPath, "--frames", "3"],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);

if (result.error) {
  fail(`could not run ${trackerPath}: ${result.error.message}`, result);
}
if (result.status !== 0) {
  fail("expected exit status 0", result);
}

const stdout = result.stdout ?? "";
const stdoutLines = stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (stdoutLines.length !== 3) {
  fail(
    `expected exactly 3 non-empty stdout lines, got ${stdoutLines.length}`,
    result,
  );
}

const forbiddenStdoutMarkers = [
  '"type"',
  '"diag"',
  '"inferenceMs"',
  '"faceRotation"',
  '"source":"synthetic-helper"',
  "raw pixels",
  "image dump",
  "screenshot",
  "frame dump",
  "model contents",
  "secret",
];

for (const marker of forbiddenStdoutMarkers) {
  if (stdout.includes(marker)) {
    fail(`stdout leaked forbidden marker ${JSON.stringify(marker)}`, result);
  }
}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

stdoutLines.forEach((line, index) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch (error) {
    fail(
      `stdout line ${index + 1} is not valid JSON: ${error.message}`,
      result,
    );
  }

  if (frame.schemaVersion !== 1)
    fail(`line ${index + 1}: schemaVersion !== 1`, result);
  if (frame.source !== "native")
    fail(`line ${index + 1}: source is not native`, result);
  if (!frame.tracking || typeof frame.tracking.status !== "string") {
    fail(`line ${index + 1}: tracking.status missing`, result);
  }
  if (
    !isNumber(frame.tracking.confidence) ||
    frame.tracking.confidence < 0 ||
    frame.tracking.confidence > 1
  ) {
    fail(`line ${index + 1}: tracking.confidence out of range`, result);
  }
  if (!frame.face?.position || !frame.face?.rotation) {
    fail(`line ${index + 1}: face position/rotation missing`, result);
  }
  if (
    !frame.eyes ||
    !isNumber(frame.eyes.leftOpen) ||
    !isNumber(frame.eyes.rightOpen) ||
    !frame.eyes.gaze
  ) {
    fail(`line ${index + 1}: eyes shape missing`, result);
  }
  if (
    !frame.mouth ||
    !isNumber(frame.mouth.open) ||
    !isNumber(frame.mouth.smile)
  ) {
    fail(`line ${index + 1}: mouth shape missing`, result);
  }
});

const stderrLines = (result.stderr ?? "")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

stderrLines.forEach((line) => {
  if (!line.startsWith("[helper-runtime-smoke] ")) {
    fail(`unexpected stderr line without safe prefix: ${line}`, result);
  }
  const forbidden = [
    "raw pixels",
    "images",
    "screenshots",
    "frame dumps",
    "model contents",
    "secret",
  ];
  for (const marker of forbidden) {
    if (line.toLowerCase().includes(marker)) {
      fail(
        `stderr contains forbidden diagnostic marker ${JSON.stringify(marker)}`,
        result,
      );
    }
  }
});

console.log(
  "Helper runtime integration smoke OK: MotionFrame-only stdout and safe diagnostics.",
);

// --- H2 Gate 2: default-runtime smoke-path isolation guard ------------------
// Omitting --helper-runtime-smoke must keep the default lvk-tracker-core path
// unchanged: helper supervision is NOT entered, stdout stays MotionFrame JSON
// only, and no helper smoke diagnostics or private helper child output leak.

// Markers that would indicate the helper smoke path was entered or that private
// helper child output leaked into a public stream. The default runtime emits
// none of these (MotionFrame has no top-level "type"; the helper contract and
// the smoke diagnostic prefix do).
const helperSmokeEntryMarkers = [
  "[helper-runtime-smoke]",
  '"source":"synthetic-helper"',
  '"type":"ready"',
  '"type":"result"',
  '"type":"stopped"',
];

// Raw helper child stderr forms. The synthetic helper writes lines like
// "[helper] startup: source=synthetic-helper" to ITS OWN stderr; under
// supervision those are captured privately and never forwarded. If a regression
// accidentally started the helper on the default path and leaked its stderr,
// these raw forms would appear even though the smoke prefix and minified JSON
// contract markers above would not. They are checked separately so the failure
// message is explicit. Note: "[helper]" is not a substring of the safe
// "[helper-runtime-smoke]" prefix.
const helperStderrLeakMarkers = ["[helper]", "source=synthetic-helper"];

const defaultResult = spawnSync(trackerPath, ["--frames", "3"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (defaultResult.error) {
  fail(
    `could not run default ${trackerPath}: ${defaultResult.error.message}`,
    defaultResult,
  );
}
if (defaultResult.status !== 0) {
  fail("expected default-runtime exit status 0", defaultResult);
}

const defaultStdout = defaultResult.stdout ?? "";
const defaultStdoutLines = defaultStdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (defaultStdoutLines.length !== 3) {
  fail(
    `expected exactly 3 default-runtime stdout lines, got ${defaultStdoutLines.length}`,
    defaultResult,
  );
}

// Default stdout must be MotionFrame JSON only: no smoke-path/helper markers and
// none of the raw-leak markers guarded above.
for (const marker of [...helperSmokeEntryMarkers, ...forbiddenStdoutMarkers]) {
  if (defaultStdout.includes(marker)) {
    fail(
      `default-runtime stdout leaked smoke-path/helper marker ${JSON.stringify(marker)}`,
      defaultResult,
    );
  }
}

// Each default-runtime stdout line must validate as native MotionFrame JSON.
defaultStdoutLines.forEach((line, index) => {
  if (parseNativeMotionFrameJson(line) === null) {
    fail(
      `default-runtime stdout line ${index + 1} is not valid native MotionFrame JSON: ${line}`,
      defaultResult,
    );
  }
});

// Default stderr must not show that the helper smoke path was entered, and must
// not leak private helper child output -- in either the smoke-diagnostic /
// minified-contract form or the raw helper child stderr form.
const defaultStderr = defaultResult.stderr ?? "";
for (const marker of helperSmokeEntryMarkers) {
  if (defaultStderr.includes(marker)) {
    fail(
      `default-runtime stderr leaked smoke-path/helper marker ${JSON.stringify(marker)}`,
      defaultResult,
    );
  }
}
for (const marker of helperStderrLeakMarkers) {
  if (defaultStderr.includes(marker)) {
    fail(
      `default-runtime stderr leaked helper stderr marker ${JSON.stringify(marker)}`,
      defaultResult,
    );
  }
}

console.log(
  "Default-runtime guard OK: --helper-runtime-smoke omitted keeps MotionFrame-only " +
    "stdout, no helper supervision entered, no helper output leaked.",
);

// --- H2 Gate 3: unsafe-diagnostic fail-closed (public stdout) guard ----------
// Running the explicit smoke path with --helper-runtime-smoke-case
// unsafe-diagnostic makes the synthetic helper emit one unsafe stderr diagnostic
// (lacking the safe "[helper] " prefix) and otherwise complete cleanly. The
// runtime smoke must FAIL CLOSED: non-zero exit, EMPTY public stdout (no
// MotionFrame, no fallback frame), and no unsafe child output forwarded to public
// stdout or stderr. The unsafe child stderr stays private to Native Core.

// Exact unsafe child markers the synthetic helper writes, plus the raw helper
// child stderr forms. None of these may appear on any PUBLIC stream.
const unsafeChildMarkers = [
  "unsafe-synthetic-diagnostic",
  "modeled-policy-violation",
  ...helperStderrLeakMarkers,
];

const unsafeResult = spawnSync(
  trackerPath,
  [
    "--helper-runtime-smoke",
    helperPath,
    "--frames",
    "3",
    "--helper-runtime-smoke-case",
    "unsafe-diagnostic",
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);

if (unsafeResult.error) {
  fail(
    `could not run unsafe-diagnostic ${trackerPath}: ${unsafeResult.error.message}`,
    unsafeResult,
  );
}

// Fail-closed: the smoke must exit non-zero.
if (unsafeResult.status === 0) {
  fail(
    "expected non-zero exit for unsafe-diagnostic fail-closed case",
    unsafeResult,
  );
}

// Public stdout must be EMPTY (no MotionFrame, no fallback frame) on fail-closed.
const unsafeStdout = unsafeResult.stdout ?? "";
const unsafeStdoutLines = unsafeStdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (unsafeStdoutLines.length !== 0) {
  fail(
    `expected empty public stdout on fail-closed, got ${unsafeStdoutLines.length} line(s)`,
    unsafeResult,
  );
}

// Public stdout must not leak any unsafe child marker, helper smoke-path marker,
// or any forbidden marker.
for (const marker of [
  ...unsafeChildMarkers,
  ...helperSmokeEntryMarkers,
  ...forbiddenStdoutMarkers,
]) {
  if (unsafeStdout.includes(marker)) {
    fail(
      `unsafe-diagnostic public stdout leaked marker ${JSON.stringify(marker)}`,
      unsafeResult,
    );
  }
}

// Public stderr must be only safe "[helper-runtime-smoke] " diagnostics and must
// never forward the unsafe child diagnostic or raw helper child stderr.
const unsafeStderr = unsafeResult.stderr ?? "";
const unsafeStderrLines = unsafeStderr
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

unsafeStderrLines.forEach((line) => {
  if (!line.startsWith("[helper-runtime-smoke] ")) {
    fail(
      `unsafe-diagnostic public stderr line without safe prefix: ${line}`,
      unsafeResult,
    );
  }
});

const unsafeDetectionMessage = "unsafe helper diagnostic detected";
if (!unsafeStderr.includes(unsafeDetectionMessage)) {
  fail(
    "unsafe-diagnostic public stderr did not report unsafe helper diagnostic detection",
    unsafeResult,
  );
}

for (const marker of unsafeChildMarkers) {
  if (unsafeStderr.includes(marker)) {
    fail(
      `unsafe-diagnostic public stderr leaked unsafe child marker ${JSON.stringify(marker)}`,
      unsafeResult,
    );
  }
}

console.log(
  "Unsafe-diagnostic fail-closed guard OK: non-zero exit, empty MotionFrame stdout, " +
    "unsafe helper diagnostic detected and kept private to Native Core.",
);
