#!/usr/bin/env node
// Helper runtime integration smoke checker (H1d) + H2 Gate 2 smoke-path guard
// + H2 Gate 3 unsafe-diagnostic fail-closed guard
// + H2 Gate 4 helper runtime failure-case public stdout guards
// + H2 Gate 5 helper runtime normal-path public stream guard
// + H2 Gate 6 helper runtime normal-path frame-count variation guards
// + H2 Gate 7 helper runtime normal-path zero-frame public stream guard
// + H2 helper lifecycle handshake explicit-smoke guard (zero public stdout)
// + H2 helper lifecycle handshake failure guards (launch-failure, nonzero-exit,
//   timeout, missing-ready, missing-stopped, malformed-ready: fail closed with
//   zero public stdout, safe parent stderr only).
// + H2 helper-runtime-smoke case-without-path isolation guard (selecting
//   --helper-runtime-smoke-case without --helper-runtime-smoke PATH fails closed
//   and does not fall through to the default camera runtime).
//
// Positive control: runs lvk-tracker-core with the explicit --helper-runtime-smoke
// path and validates that stdout contains only existing MotionFrame JSON while
// helper stdout/stderr stay private to Native Core.
//
// Gate 5 guard: re-runs the same explicit normal/success smoke path and asserts
// the full public-stream boundary with the same marker sets used by the later
// gates -- public stdout is MotionFrame JSON only, public stderr (if any) is safe
// parent [helper-runtime-smoke] diagnostics only, and no helper lifecycle marker,
// helper diagnostic, raw child stderr, child stdout JSON, policy/error text,
// unsafe child output, or smoke-only marker reaches any public stream. Helper
// stdout/stderr stay private to Native Core. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md.
//
// Gate 6 guard: runs the same explicit normal/success smoke path for additional
// source-supported small positive frame counts (1 and 5) and applies the same
// public stdout/stderr boundary assertions. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md.
//
// Gate 7 guard: runs the same explicit normal/success smoke path for the
// source-supported zero-frame edge case (--frames 0) and applies the same public
// stdout/stderr boundary assertions, with exactly zero public stdout lines.
// Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md.
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

// Extracted as a reusable guard so the later H2 Foundation Boundary consolidation
// can re-exercise the exact same default-runtime isolation evidence without
// duplicating logic. Behavior is unchanged from the original inline Gate 2 block.
const assertDefaultRuntimeIsolationGuard = () => {
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
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
  ]) {
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
};

assertDefaultRuntimeIsolationGuard();
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

// --- H2 Gate 4: explicit helper runtime failure-case public stdout guards -----
// Each existing explicit --helper-runtime-smoke failure case (launch-failure,
// nonzero-exit, timeout) must keep public lvk-tracker-core stdout MotionFrame
// JSON only -- here exactly one PRE-EXISTING fallback MotionFrame (status
// "lost") emitted by helper_runtime_smoke.cpp -- and must not forward helper
// diagnostics, lifecycle markers, raw child stderr, policy/error text, or unsafe
// child output to any public stream. This asserts the EXISTING behavior; it adds
// no new fallback emission and changes no runtime behavior. The helper child's
// own stdout/stderr stay private to Native Core. Synthetic/smoke-only, CI-safe.

// Run one explicit failure case and assert the public stdout/stderr boundary.
// helperArg is the helper path passed to lvk-tracker-core; launch-failure uses a
// deliberately non-existent path so the helper genuinely fails to launch (with a
// valid path that case would run normally and not exercise the failure branch).
const assertFailureCaseStdoutGuard = ({ caseName, helperArg }) => {
  const caseResult = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      helperArg,
      "--frames",
      "3",
      "--helper-runtime-smoke-case",
      caseName,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (caseResult.error) {
    fail(
      `could not run ${caseName} ${trackerPath}: ${caseResult.error.message}`,
      caseResult,
    );
  }

  // All existing explicit failure cases emit one safe fallback MotionFrame and
  // exit 0.
  if (caseResult.status !== 0) {
    fail(`expected exit status 0 for ${caseName} failure case`, caseResult);
  }

  const caseStdout = caseResult.stdout ?? "";
  const caseStdoutLines = caseStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Public stdout must be MotionFrame JSON only -- exactly one native MotionFrame.
  if (caseStdoutLines.length !== 1) {
    fail(
      `expected exactly 1 public stdout line for ${caseName}, got ${caseStdoutLines.length}`,
      caseResult,
    );
  }

  // No helper smoke-path markers, forbidden markers, or unsafe child markers may
  // appear on public stdout (covers helper diagnostics, lifecycle markers, raw
  // child stderr forms, and unsafe child output).
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (caseStdout.includes(marker)) {
      fail(
        `${caseName} public stdout leaked marker ${JSON.stringify(marker)}`,
        caseResult,
      );
    }
  }

  // The single stdout line must validate as native MotionFrame JSON AND be the
  // existing fallback MotionFrame, i.e. tracking.status === "lost".
  caseStdoutLines.forEach((line, index) => {
    const frame = parseNativeMotionFrameJson(line);
    if (frame === null) {
      fail(
        `${caseName} public stdout line ${index + 1} is not valid native MotionFrame JSON: ${line}`,
        caseResult,
      );
    }
    if (frame.tracking?.status !== "lost") {
      fail(
        `${caseName} public stdout line ${index + 1} expected fallback MotionFrame with tracking.status "lost", got ${JSON.stringify(frame.tracking?.status)}`,
        caseResult,
      );
    }
  });

  // Public stderr must be only safe parent diagnostics; no raw child stderr or
  // helper child output forwarded.
  const caseStderr = caseResult.stderr ?? "";
  const caseStderrLines = caseStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  caseStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `${caseName} public stderr line without safe prefix: ${line}`,
        caseResult,
      );
    }
  });

  // Even when carried behind the valid "[helper-runtime-smoke] " parent prefix,
  // public stderr must not contain helper lifecycle / contract markers, raw child
  // stderr forms, unsafe child output, or other forbidden child JSON / policy /
  // error text. We reuse the same marker sets as the stdout guard but exclude the
  // safe parent prefix itself so valid parent diagnostics remain allowed.
  const forbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of forbiddenStderrMarkers) {
    if (caseStderr.includes(marker)) {
      fail(
        `${caseName} public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        caseResult,
      );
    }
  }
};

assertFailureCaseStdoutGuard({
  caseName: "nonzero-exit",
  helperArg: helperPath,
});
assertFailureCaseStdoutGuard({ caseName: "timeout", helperArg: helperPath });
// launch-failure needs the helper to genuinely fail to launch: pass a path that
// does not exist so runHelperProcessForSmoke reports launched=false.
assertFailureCaseStdoutGuard({
  caseName: "launch-failure",
  helperArg: `${helperPath}.does-not-exist-lvk-gate4`,
});

console.log(
  "Failure-case stdout guard OK: launch-failure, nonzero-exit, timeout keep public " +
    "stdout MotionFrame-JSON-only and forward no helper child output.",
);

// --- H2 Gates 5/6: helper runtime normal-path public stream guards -----------
// The existing explicit --helper-runtime-smoke NORMAL/SUCCESS path must keep the
// public lvk-tracker-core stream boundary clean: public stdout is MotionFrame
// JSON only (exactly N native MotionFrame lines for --frames N), public stderr --
// if present -- is only safe parent [helper-runtime-smoke] diagnostics, and no
// helper lifecycle marker, helper diagnostic, raw child stderr form, child stdout
// JSON marker, policy/error text, unsafe child output, or smoke-only marker
// reaches any public stream. The helper child's own stdout/stderr stay private to
// Native Core. Gate 5 keeps the existing --frames 3 positive control intact; Gate
// 6 adds source-supported small positive frame-count variation checks for
// --frames 1 and --frames 5. Gate 7 adds the source-supported zero-frame
// normal/success edge case, asserting exactly zero public stdout lines while the
// helper ready/stopped lifecycle stays private to Native Core. Asserts EXISTING
// behavior only; adds no runtime behavior. Synthetic/smoke-only, CI-safe.

const assertNormalPathPublicStreamGuard = (frameCount, gateLabel) => {
  const normalResult = spawnSync(
    trackerPath,
    ["--helper-runtime-smoke", helperPath, "--frames", String(frameCount)],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (normalResult.error) {
    fail(
      `could not run ${gateLabel} normal-path --frames ${frameCount} ${trackerPath}: ${normalResult.error.message}`,
      normalResult,
    );
  }

  // The normal/success smoke path exits 0.
  if (normalResult.status !== 0) {
    fail(
      `expected exit status 0 for ${gateLabel} normal-path --frames ${frameCount} smoke`,
      normalResult,
    );
  }

  const normalStdout = normalResult.stdout ?? "";
  const normalStdoutLines = normalStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Public stdout must be MotionFrame JSON only -- exactly N lines for --frames N.
  if (normalStdoutLines.length !== frameCount) {
    fail(
      `expected exactly ${frameCount} ${gateLabel} normal-path public stdout lines, got ${normalStdoutLines.length}`,
      normalResult,
    );
  }

  // No helper smoke-path markers, forbidden markers, or unsafe child markers may
  // appear on public stdout (covers helper lifecycle markers, helper diagnostics,
  // raw child stderr forms, child stdout JSON markers, policy/error text, unsafe
  // child output, and smoke-only markers).
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (normalStdout.includes(marker)) {
      fail(
        `${gateLabel} normal-path --frames ${frameCount} public stdout leaked marker ${JSON.stringify(marker)}`,
        normalResult,
      );
    }
  }

  // Each stdout line must validate as native MotionFrame JSON.
  normalStdoutLines.forEach((line, index) => {
    if (parseNativeMotionFrameJson(line) === null) {
      fail(
        `${gateLabel} normal-path --frames ${frameCount} public stdout line ${index + 1} is not valid native MotionFrame JSON: ${line}`,
        normalResult,
      );
    }
  });

  // Public stderr, if non-empty, must be only safe parent [helper-runtime-smoke]
  // diagnostics; no raw child stderr or helper child output forwarded.
  const normalStderr = normalResult.stderr ?? "";
  const normalStderrLines = normalStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  normalStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `${gateLabel} normal-path --frames ${frameCount} public stderr line without safe prefix: ${line}`,
        normalResult,
      );
    }
  });

  // Even behind the safe parent prefix, public stderr must not carry helper
  // lifecycle / contract markers, raw child stderr forms, unsafe child output, or
  // other forbidden child JSON / policy / error text. Same set Gate 4 builds,
  // minus the safe parent prefix itself so valid parent diagnostics remain
  // allowed.
  const normalForbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of normalForbiddenStderrMarkers) {
    if (normalStderr.includes(marker)) {
      fail(
        `${gateLabel} normal-path --frames ${frameCount} public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        normalResult,
      );
    }
  }
};

assertNormalPathPublicStreamGuard(3, "Gate 5");

console.log(
  "Normal-path stream guard OK: helper runtime normal/success path keeps public stdout " +
    "MotionFrame-JSON-only, public stderr safe parent diagnostics only, helper output private.",
);

for (const frameCount of [1, 5]) {
  assertNormalPathPublicStreamGuard(frameCount, "Gate 6");
}

console.log(
  "Normal-path frame-count guard OK: helper runtime normal/success path keeps public " +
    "streams clean for --frames 1 and --frames 5.",
);

assertNormalPathPublicStreamGuard(0, "Gate 7");

console.log(
  "Zero-frame normal-path guard OK: helper runtime normal/success path exits cleanly " +
    "with zero public stdout lines and safe public stderr only for --frames 0.",
);

// --- H2 Foundation Boundary: explicit-smoke-only consolidation assertion -------
// H2 Foundation Implementation Gate 1: explicit-smoke-only foundation boundary
// assertion. This block adds NO new runtime behavior, NO new --helper-runtime-smoke
// case, NO C++ change, and NO default runtime wiring. It is an honest CONSOLIDATION
// that re-exercises, under one named foundation-boundary assertion, the two boundary
// facts already proven above by reusing the existing guard helpers:
//   (1) the default lvk-tracker-core path (no --helper-runtime-smoke) never enters
//       helper supervision and keeps public stdout MotionFrame-JSON-only -- reuses
//       the Gate 2 default-runtime isolation guard; and
//   (2) the explicit --helper-runtime-smoke normal/success path keeps the public
//       stdout/stderr boundary clean while helper stdout/stderr stay private to
//       Native Core -- reuses the Gate 5/6/7 normal-path public stream guard.
// It asserts EXISTING behavior only and makes NO new production runtime guarantee.
// Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_BOUNDARY_ASSERTION_CLOSEOUT.md.

assertDefaultRuntimeIsolationGuard();
assertNormalPathPublicStreamGuard(3, "Foundation boundary");

console.log(
  "Foundation boundary consolidation OK: default path stays out of helper supervision " +
    "and the explicit smoke path keeps public streams clean with helper output private. " +
    "Consolidates existing Gate 2 + Gate 5/6/7 evidence; asserts no new runtime guarantee.",
);

// --- H2 helper lifecycle handshake explicit-smoke guard ----------------------
// The new explicit-smoke-only helper-lifecycle-handshake case runs the synthetic
// helper through the existing bounded supervisor and observes the helper
// lifecycle/ready boundary from the PRIVATELY captured helper stdout only. Unlike
// the normal/success case it maps NO helper result to MotionFrame: it emits ZERO
// public stdout lines (no MotionFrame, no fallback frame), exits cleanly (0), and
// writes only safe parent [helper-runtime-smoke] diagnostics to public stderr while
// helper stdout/stderr stay private to Native Core. This guard asserts that public
// boundary. The case only runs through explicit --helper-runtime-smoke invocation;
// the default-runtime isolation guard above already proves the default path never
// enters helper supervision. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_LIFECYCLE_HANDSHAKE_SMOKE_CLOSEOUT.md.

const assertLifecycleHandshakeGuard = () => {
  const handshakeResult = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      helperPath,
      "--frames",
      "3",
      "--helper-runtime-smoke-case",
      "helper-lifecycle-handshake",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (handshakeResult.error) {
    fail(
      `could not run helper-lifecycle-handshake ${trackerPath}: ${handshakeResult.error.message}`,
      handshakeResult,
    );
  }

  // The clean handshake exits 0.
  if (handshakeResult.status !== 0) {
    fail(
      "expected exit status 0 for helper-lifecycle-handshake case",
      handshakeResult,
    );
  }

  // Public stdout must be EMPTY: the handshake observes the lifecycle/ready boundary
  // privately and maps no MotionFrame, so there are exactly zero public stdout lines.
  const handshakeStdout = handshakeResult.stdout ?? "";
  const handshakeStdoutLines = handshakeStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (handshakeStdoutLines.length !== 0) {
    fail(
      `expected zero public stdout lines for helper-lifecycle-handshake, got ${handshakeStdoutLines.length}`,
      handshakeResult,
    );
  }

  // No helper smoke-path / lifecycle markers, forbidden markers, or unsafe child
  // markers may appear on public stdout (covers helper lifecycle markers, helper
  // diagnostics, raw child stderr forms, child stdout JSON markers, policy/error
  // text, unsafe child output, and smoke-only markers).
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (handshakeStdout.includes(marker)) {
      fail(
        `helper-lifecycle-handshake public stdout leaked marker ${JSON.stringify(marker)}`,
        handshakeResult,
      );
    }
  }

  // Public stderr, if non-empty, must be only safe parent [helper-runtime-smoke]
  // diagnostics; no raw child stderr or helper child output forwarded.
  const handshakeStderr = handshakeResult.stderr ?? "";
  const handshakeStderrLines = handshakeStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  handshakeStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `helper-lifecycle-handshake public stderr line without safe prefix: ${line}`,
        handshakeResult,
      );
    }
  });

  // Even behind the safe parent prefix, public stderr must not carry helper
  // lifecycle / contract markers, raw child stderr forms, unsafe child output, or
  // other forbidden child JSON / policy / error text. Same set the later gates
  // build, minus the safe parent prefix itself so valid parent diagnostics remain
  // allowed.
  const handshakeForbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of handshakeForbiddenStderrMarkers) {
    if (handshakeStderr.includes(marker)) {
      fail(
        `helper-lifecycle-handshake public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        handshakeResult,
      );
    }
  }

  // Positive evidence: the parent reports it observed the lifecycle handshake.
  if (!handshakeStderr.includes("helper lifecycle handshake observed")) {
    fail(
      "helper-lifecycle-handshake public stderr did not report lifecycle handshake observation",
      handshakeResult,
    );
  }
};

assertLifecycleHandshakeGuard();

console.log(
  "Lifecycle-handshake guard OK: explicit helper-lifecycle-handshake case observes the " +
    "helper ready/stopped boundary privately, emits zero public stdout lines, keeps public " +
    "stderr to safe parent diagnostics only, and keeps helper stdout/stderr private.",
);

// --- H2 helper lifecycle handshake failure guards ----------------------------
// The lifecycle-handshake observation must FAIL CLOSED when the helper never
// reaches a clean handshake. Each failure vector below drives the same
// handleLifecycleHandshake observation through an existing synthetic helper
// failure mode (or, for launch-failure, a non-existent helper path) and asserts
// the same public/private boundary as the success guard, except inverted: the run
// exits NON-ZERO, public stdout is EMPTY (no MotionFrame, no fallback frame), and
// public stderr carries only the expected safe parent [helper-runtime-smoke]
// failure diagnostic -- never the success marker, helper lifecycle markers, raw
// child stderr, child stdout JSON, unsafe child output, policy/error text, or
// smoke-only markers. Helper stdout/stderr stay private to Native Core. These
// cases are explicit-smoke-only and add no fallback MotionFrame emission and no
// default runtime behavior. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_LIFECYCLE_HANDSHAKE_FAILURE_GUARDS_CLOSEOUT.md.

const assertLifecycleHandshakeFailureGuard = ({
  vectorLabel,
  caseName,
  helperArg,
  expectedDiagnostic,
}) => {
  const failureResult = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      helperArg,
      "--frames",
      "3",
      "--helper-runtime-smoke-case",
      caseName,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (failureResult.error) {
    fail(
      `could not run ${vectorLabel} ${trackerPath}: ${failureResult.error.message}`,
      failureResult,
    );
  }

  // Fail-closed: the lifecycle-handshake failure guard must exit non-zero.
  if (failureResult.status === 0) {
    fail(
      `expected non-zero exit for ${vectorLabel} lifecycle-handshake failure guard`,
      failureResult,
    );
  }

  // Public stdout must be EMPTY on a lifecycle-handshake failure (no MotionFrame,
  // no fallback frame): exactly zero public stdout lines.
  const failureStdout = failureResult.stdout ?? "";
  const failureStdoutLines = failureStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (failureStdoutLines.length !== 0) {
    fail(
      `expected zero public stdout lines for ${vectorLabel}, got ${failureStdoutLines.length}`,
      failureResult,
    );
  }

  // No helper smoke-path / lifecycle markers, forbidden markers, or unsafe child
  // markers may appear on public stdout.
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (failureStdout.includes(marker)) {
      fail(
        `${vectorLabel} public stdout leaked marker ${JSON.stringify(marker)}`,
        failureResult,
      );
    }
  }

  // Public stderr must be only safe parent [helper-runtime-smoke] diagnostics.
  const failureStderr = failureResult.stderr ?? "";
  const failureStderrLines = failureStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  failureStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `${vectorLabel} public stderr line without safe prefix: ${line}`,
        failureResult,
      );
    }
  });

  // Even behind the safe parent prefix, public stderr must not carry helper
  // lifecycle / contract markers, raw child stderr forms, unsafe child output, or
  // other forbidden child JSON / policy / error text.
  const failureForbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of failureForbiddenStderrMarkers) {
    if (failureStderr.includes(marker)) {
      fail(
        `${vectorLabel} public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        failureResult,
      );
    }
  }

  // The failed guard must report the expected safe failure diagnostic and must NOT
  // report the success marker (the handshake did not complete cleanly).
  if (!failureStderr.includes(expectedDiagnostic)) {
    fail(
      `${vectorLabel} public stderr did not report expected diagnostic ${JSON.stringify(expectedDiagnostic)}`,
      failureResult,
    );
  }
  if (failureStderr.includes("helper lifecycle handshake observed")) {
    fail(
      `${vectorLabel} public stderr reported the success marker on a failure vector`,
      failureResult,
    );
  }
};

// launch-failure reuses the existing helper-lifecycle-handshake case with a
// non-existent helper path so the helper genuinely fails to launch.
assertLifecycleHandshakeFailureGuard({
  vectorLabel: "lifecycle-handshake launch-failure",
  caseName: "helper-lifecycle-handshake",
  helperArg: `${helperPath}.does-not-exist-lvk-handshake-launch-failure`,
  expectedDiagnostic: "helper launch failed",
});
assertLifecycleHandshakeFailureGuard({
  vectorLabel: "lifecycle-handshake nonzero-exit",
  caseName: "helper-lifecycle-handshake-nonzero-exit",
  helperArg: helperPath,
  expectedDiagnostic: "helper exited non-zero",
});
assertLifecycleHandshakeFailureGuard({
  vectorLabel: "lifecycle-handshake timeout",
  caseName: "helper-lifecycle-handshake-timeout",
  helperArg: helperPath,
  expectedDiagnostic: "helper timed out",
});

// missing-ready: the synthetic helper completes cleanly (exits 0, no timeout)
// but never emits the "ready" lifecycle boundary. The parent observation must
// fail closed: non-zero exit, empty public stdout (no MotionFrame, no fallback
// frame), and only a safe "[helper-runtime-smoke] " failure diagnostic on public
// stderr. Helper stdout/stderr stay private to Native Core. This is
// explicit-smoke-only and adds no default runtime behavior.
assertLifecycleHandshakeFailureGuard({
  vectorLabel: "lifecycle-handshake missing-ready",
  caseName: "helper-lifecycle-handshake-missing-ready",
  helperArg: helperPath,
  expectedDiagnostic: "helper ready boundary missing",
});

// missing-stopped: the synthetic helper emits the "ready" lifecycle boundary
// and otherwise completes cleanly (exits 0, no timeout), but never emits the
// "stopped" lifecycle boundary. The parent observation must fail closed:
// non-zero exit, empty public stdout (no MotionFrame, no fallback frame), and
// only a safe "[helper-runtime-smoke] " failure diagnostic on public stderr.
// Helper stdout/stderr stay private to Native Core. This is explicit-smoke-only
// and adds no default runtime behavior.
assertLifecycleHandshakeFailureGuard({
  vectorLabel: "lifecycle-handshake missing-stopped",
  caseName: "helper-lifecycle-handshake-missing-stopped",
  helperArg: helperPath,
  expectedDiagnostic: "helper stopped boundary missing",
});

// malformed-ready: the synthetic helper emits a "ready" line with an invalid
// schema version (schemaVersion:10 instead of 1) and otherwise completes
// cleanly (exits 0, no timeout, emits the "stopped" boundary). The value 10 is
// chosen to directly test that a bare "schemaVersion":1 substring match would
// incorrectly accept it, while the fixed exact-boundary check rejects it. The
// parent observation must fail closed: non-zero exit, empty public stdout (no
// MotionFrame, no fallback frame), and only a safe "[helper-runtime-smoke] "
// failure diagnostic on public stderr. Helper stdout/stderr stay private to
// Native Core. This is explicit-smoke-only and adds no default runtime behavior.
assertLifecycleHandshakeFailureGuard({
  vectorLabel: "lifecycle-handshake malformed-ready",
  caseName: "helper-lifecycle-handshake-malformed-ready",
  helperArg: helperPath,
  expectedDiagnostic: "helper ready line malformed",
});

console.log(
  "Lifecycle-handshake failure guards OK: launch-failure, nonzero-exit, timeout, " +
    "missing-ready, missing-stopped, and malformed-ready each fail closed with " +
    "non-zero exit, zero public stdout lines, safe parent-prefixed stderr only, " +
    "and helper stdout/stderr kept private to Native Core.",
);

// --- H2 helper-runtime-smoke case-without-path isolation guard ---------------
// Selecting a helper runtime smoke case via --helper-runtime-smoke-case WITHOUT
// providing --helper-runtime-smoke PATH must FAIL CLOSED. The Native Core CLI
// rejects the invocation (see main.cpp) rather than silently discarding the
// requested helper runtime state and falling through to the DEFAULT camera
// runtime. This protects the smoke-path isolation boundary from the opposite
// direction of the Gate 2 default-runtime guard: Gate 2 proves that omitting the
// smoke flags leaves the default path untouched; this guard proves that asking
// for a smoke case without the explicit helper path does not accidentally emit
// default-runtime MotionFrames on public stdout. The run must exit non-zero,
// produce ZERO public stdout lines (no MotionFrame, no fallback frame, no helper
// output), and report the safe fail-closed reason on public stderr. It needs no
// helper child and no camera, so it is synthetic/smoke-only and CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SMOKE_CASE_WITHOUT_PATH_GUARD_CLOSEOUT.md
// and the narrow implementation gate decision
// docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md.

const caseWithoutPathReason =
  "--helper-runtime-smoke-case requires --helper-runtime-smoke PATH.";

const assertCaseWithoutPathIsolationGuard = (caseName) => {
  // Deliberately pass --helper-runtime-smoke-case WITHOUT --helper-runtime-smoke.
  // --frames 3 is a valid default-runtime argument; if the CLI wrongly fell
  // through to the default camera runtime it would emit 3 MotionFrame lines here.
  const caseResult = spawnSync(
    trackerPath,
    ["--frames", "3", "--helper-runtime-smoke-case", caseName],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (caseResult.error) {
    fail(
      `could not run case-without-path ${caseName} ${trackerPath}: ${caseResult.error.message}`,
      caseResult,
    );
  }

  // Fail-closed: a smoke case without the explicit helper path must exit non-zero.
  if (caseResult.status === 0) {
    fail(
      `expected non-zero exit for case-without-path ${caseName} (must not fall through to default runtime)`,
      caseResult,
    );
  }

  // Public stdout must be EMPTY: no default-runtime MotionFrames, no fallback
  // frame, no helper output.
  const caseStdout = caseResult.stdout ?? "";
  const caseStdoutLines = caseStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (caseStdoutLines.length !== 0) {
    fail(
      `expected zero public stdout lines for case-without-path ${caseName}, got ${caseStdoutLines.length}`,
      caseResult,
    );
  }

  // No MotionFrame markers, helper smoke-path markers, or unsafe child markers may
  // appear on public stdout.
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (caseStdout.includes(marker)) {
      fail(
        `case-without-path ${caseName} public stdout leaked marker ${JSON.stringify(marker)}`,
        caseResult,
      );
    }
  }

  // The rejection must report the safe fail-closed reason on public stderr. (The
  // CLI usage text is also printed here and legitimately mentions the helper flag
  // names, so this guard asserts the fail-closed reason and stdout cleanliness
  // rather than a stderr prefix.)
  const caseStderr = caseResult.stderr ?? "";
  if (!caseStderr.includes(caseWithoutPathReason)) {
    fail(
      `case-without-path ${caseName} public stderr did not report the fail-closed reason ${JSON.stringify(caseWithoutPathReason)}`,
      caseResult,
    );
  }
};

// Cover a normal case and a fail-closed case name to show the guard is
// independent of which case was requested: neither may fall through to the
// default runtime when the explicit helper path is absent.
assertCaseWithoutPathIsolationGuard("normal");
assertCaseWithoutPathIsolationGuard("unsafe-diagnostic");

console.log(
  "Case-without-path isolation guard OK: --helper-runtime-smoke-case without " +
    "--helper-runtime-smoke PATH fails closed with non-zero exit, zero public " +
    "stdout lines, and the safe fail-closed reason on stderr; it does not fall " +
    "through to the default camera runtime.",
);

// --- H2 helper runtime normal-path malformed result schemaVersion guard -------
// The NORMAL helper-runtime smoke parse path must accept schemaVersion exactly
// equal to 1 and reject prefix cases such as schemaVersion:10. The new explicit
// --helper-runtime-smoke-case malformed-result-schema makes the synthetic helper
// emit one otherwise well-formed "result" line with schemaVersion:10 before its
// normal result frames. Before the exact-boundary fix a bare "schemaVersion":1
// substring match would have wrongly accepted that line and mapped it to a public
// MotionFrame; the fixed parser rejects it and FAILS CLOSED. This guard asserts
// the fail-closed public boundary: non-zero exit, EMPTY public stdout (no
// MotionFrame, no fallback frame), public stderr limited to safe parent
// [helper-runtime-smoke] diagnostics reporting the parse error, and no helper
// lifecycle marker, raw child stderr, child stdout JSON, unsafe child output, or
// policy/error text on any public stream. Helper stdout/stderr stay private to
// Native Core. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md.

const assertNormalPathMalformedResultSchemaRejected = () => {
  const malformedResult = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      helperPath,
      "--frames",
      "3",
      "--helper-runtime-smoke-case",
      "malformed-result-schema",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (malformedResult.error) {
    fail(
      `could not run malformed-result-schema ${trackerPath}: ${malformedResult.error.message}`,
      malformedResult,
    );
  }

  // Fail-closed: the normal parse path must reject the malformed result line and
  // exit non-zero.
  if (malformedResult.status === 0) {
    fail(
      "expected non-zero exit for malformed-result-schema fail-closed case",
      malformedResult,
    );
  }

  // Public stdout must be EMPTY (no MotionFrame, no fallback frame): the parser
  // rejects the malformed result line before mapping any MotionFrame.
  const malformedStdout = malformedResult.stdout ?? "";
  const malformedStdoutLines = malformedStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (malformedStdoutLines.length !== 0) {
    fail(
      `expected zero public stdout lines for malformed-result-schema, got ${malformedStdoutLines.length}`,
      malformedResult,
    );
  }

  // No helper smoke-path / lifecycle markers, forbidden markers, or unsafe child
  // markers may appear on public stdout.
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (malformedStdout.includes(marker)) {
      fail(
        `malformed-result-schema public stdout leaked marker ${JSON.stringify(marker)}`,
        malformedResult,
      );
    }
  }

  // Public stderr must be only safe parent [helper-runtime-smoke] diagnostics.
  const malformedStderr = malformedResult.stderr ?? "";
  const malformedStderrLines = malformedStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  malformedStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `malformed-result-schema public stderr line without safe prefix: ${line}`,
        malformedResult,
      );
    }
  });

  // Even behind the safe parent prefix, public stderr must not carry helper
  // lifecycle / contract markers, raw child stderr forms, unsafe child output, or
  // other forbidden child JSON / policy / error text.
  const malformedForbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of malformedForbiddenStderrMarkers) {
    if (malformedStderr.includes(marker)) {
      fail(
        `malformed-result-schema public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        malformedResult,
      );
    }
  }

  // The parser must report the expected safe parse-error diagnostic for the
  // rejected result line.
  if (!malformedStderr.includes("missing result/schema marker")) {
    fail(
      "malformed-result-schema public stderr did not report the expected parse-error diagnostic",
      malformedResult,
    );
  }
};

assertNormalPathMalformedResultSchemaRejected();

console.log(
  "Normal-path malformed-result-schema guard OK: a result line with " +
    "schemaVersion:10 is rejected by exact-boundary parsing, fails closed with " +
    "non-zero exit and zero public stdout lines, keeps public stderr to safe " +
    "parent diagnostics only, and keeps helper stdout/stderr private to Native Core.",
);

// --- H2 helper runtime normal-path malformed stopped schemaVersion guard ------
// The NORMAL helper-runtime smoke parse path also guards the "stopped" lifecycle
// boundary line: it must accept schemaVersion exactly equal to 1 and reject prefix
// cases such as schemaVersion:10. The new explicit --helper-runtime-smoke-case
// malformed-stopped-schema makes the synthetic helper emit its "stopped" line with
// schemaVersion:10 in place of the normal stopped line. Run with --frames 0 so no
// result frame is mapped before the malformed stopped line is reached: the parser
// observes the ready boundary, then rejects the malformed stopped line via the same
// shared exact-boundary check and FAILS CLOSED. Before the exact-boundary fix a bare
// "schemaVersion":1 substring match would have wrongly accepted that line. This guard
// asserts the fail-closed public boundary: non-zero exit, EMPTY public stdout (no
// MotionFrame, no fallback frame), public stderr limited to safe parent
// [helper-runtime-smoke] diagnostics reporting the parse error, and no helper
// lifecycle marker, raw child stderr, child stdout JSON, unsafe child output, or
// policy/error text on any public stream. Helper stdout/stderr stay private to
// Native Core. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_STOPPED_SCHEMA_GUARD_CLOSEOUT.md.

const assertNormalPathMalformedStoppedSchemaRejected = () => {
  const malformedResult = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      helperPath,
      "--frames",
      "0",
      "--helper-runtime-smoke-case",
      "malformed-stopped-schema",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (malformedResult.error) {
    fail(
      `could not run malformed-stopped-schema ${trackerPath}: ${malformedResult.error.message}`,
      malformedResult,
    );
  }

  // Fail-closed: the normal parse path must reject the malformed stopped line and
  // exit non-zero.
  if (malformedResult.status === 0) {
    fail(
      "expected non-zero exit for malformed-stopped-schema fail-closed case",
      malformedResult,
    );
  }

  // Public stdout must be EMPTY (no MotionFrame, no fallback frame): with --frames 0
  // the parser reaches and rejects the malformed stopped line before mapping any
  // MotionFrame.
  const malformedStdout = malformedResult.stdout ?? "";
  const malformedStdoutLines = malformedStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (malformedStdoutLines.length !== 0) {
    fail(
      `expected zero public stdout lines for malformed-stopped-schema, got ${malformedStdoutLines.length}`,
      malformedResult,
    );
  }

  // No helper smoke-path / lifecycle markers, forbidden markers, or unsafe child
  // markers may appear on public stdout.
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (malformedStdout.includes(marker)) {
      fail(
        `malformed-stopped-schema public stdout leaked marker ${JSON.stringify(marker)}`,
        malformedResult,
      );
    }
  }

  // Public stderr must be only safe parent [helper-runtime-smoke] diagnostics.
  const malformedStderr = malformedResult.stderr ?? "";
  const malformedStderrLines = malformedStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  malformedStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `malformed-stopped-schema public stderr line without safe prefix: ${line}`,
        malformedResult,
      );
    }
  });

  // Even behind the safe parent prefix, public stderr must not carry helper
  // lifecycle / contract markers, raw child stderr forms, unsafe child output, or
  // other forbidden child JSON / policy / error text.
  const malformedForbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of malformedForbiddenStderrMarkers) {
    if (malformedStderr.includes(marker)) {
      fail(
        `malformed-stopped-schema public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        malformedResult,
      );
    }
  }

  // The parser must report the expected safe parse-error diagnostic for the
  // rejected stopped line.
  if (!malformedStderr.includes("invalid stopped line")) {
    fail(
      "malformed-stopped-schema public stderr did not report the expected parse-error diagnostic",
      malformedResult,
    );
  }
};

assertNormalPathMalformedStoppedSchemaRejected();

console.log(
  "Normal-path malformed-stopped-schema guard OK: a stopped line with " +
    "schemaVersion:10 is rejected by exact-boundary parsing, fails closed with " +
    "non-zero exit and zero public stdout lines, keeps public stderr to safe " +
    "parent diagnostics only, and keeps helper stdout/stderr private to Native Core.",
);

// --- H2 helper runtime normal-path malformed ready schemaVersion guard --------
// The NORMAL helper-runtime smoke parse path also guards the "ready" lifecycle
// boundary line: it must accept schemaVersion exactly equal to 1 and reject prefix
// cases such as schemaVersion:10. The new explicit --helper-runtime-smoke-case
// malformed-ready-schema makes the synthetic helper emit its "ready" line with
// schemaVersion:10 (via --emit-malformed-ready) in place of the normal ready line.
// This is the NORMAL parse path -- distinct from the existing lifecycle-handshake
// malformed-ready failure guard, which routes the same helper mode through the
// handshake observation. Run with --frames 0: the ready line is the first line the
// parser reads, so it rejects the malformed ready line via the same shared
// exact-boundary check and FAILS CLOSED before any result frame could be mapped.
// Before the exact-boundary fix a bare "schemaVersion":1 substring match would have
// wrongly accepted that line. This guard asserts the fail-closed public boundary:
// non-zero exit, EMPTY public stdout (no MotionFrame, no fallback frame), public
// stderr limited to safe parent [helper-runtime-smoke] diagnostics reporting the
// parse error, and no helper lifecycle marker, raw child stderr, child stdout JSON,
// unsafe child output, or policy/error text on any public stream. Helper
// stdout/stderr stay private to Native Core. Synthetic/smoke-only, CI-safe. See
// docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_READY_SCHEMA_GUARD_CLOSEOUT.md.

const assertNormalPathMalformedReadySchemaRejected = () => {
  const malformedResult = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      helperPath,
      "--frames",
      "0",
      "--helper-runtime-smoke-case",
      "malformed-ready-schema",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (malformedResult.error) {
    fail(
      `could not run malformed-ready-schema ${trackerPath}: ${malformedResult.error.message}`,
      malformedResult,
    );
  }

  // Fail-closed: the normal parse path must reject the malformed ready line and
  // exit non-zero.
  if (malformedResult.status === 0) {
    fail(
      "expected non-zero exit for malformed-ready-schema fail-closed case",
      malformedResult,
    );
  }

  // Public stdout must be EMPTY (no MotionFrame, no fallback frame): the parser
  // rejects the malformed ready line before mapping any MotionFrame.
  const malformedStdout = malformedResult.stdout ?? "";
  const malformedStdoutLines = malformedStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (malformedStdoutLines.length !== 0) {
    fail(
      `expected zero public stdout lines for malformed-ready-schema, got ${malformedStdoutLines.length}`,
      malformedResult,
    );
  }

  // No helper smoke-path / lifecycle markers, forbidden markers, or unsafe child
  // markers may appear on public stdout.
  for (const marker of [
    ...helperSmokeEntryMarkers,
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ]) {
    if (malformedStdout.includes(marker)) {
      fail(
        `malformed-ready-schema public stdout leaked marker ${JSON.stringify(marker)}`,
        malformedResult,
      );
    }
  }

  // Public stderr must be only safe parent [helper-runtime-smoke] diagnostics.
  const malformedStderr = malformedResult.stderr ?? "";
  const malformedStderrLines = malformedStderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  malformedStderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `malformed-ready-schema public stderr line without safe prefix: ${line}`,
        malformedResult,
      );
    }
  });

  // Even behind the safe parent prefix, public stderr must not carry helper
  // lifecycle / contract markers, raw child stderr forms, unsafe child output, or
  // other forbidden child JSON / policy / error text.
  const malformedForbiddenStderrMarkers = [
    ...helperSmokeEntryMarkers.filter(
      (marker) => marker !== "[helper-runtime-smoke]",
    ),
    ...forbiddenStdoutMarkers,
    ...unsafeChildMarkers,
  ];
  for (const marker of malformedForbiddenStderrMarkers) {
    if (malformedStderr.includes(marker)) {
      fail(
        `malformed-ready-schema public stderr leaked forbidden/helper marker ${JSON.stringify(marker)}`,
        malformedResult,
      );
    }
  }

  // The parser must report the expected safe parse-error diagnostic for the
  // rejected ready line.
  if (!malformedStderr.includes("invalid ready line")) {
    fail(
      "malformed-ready-schema public stderr did not report the expected parse-error diagnostic",
      malformedResult,
    );
  }
};

assertNormalPathMalformedReadySchemaRejected();

console.log(
  "Normal-path malformed-ready-schema guard OK: a ready line with " +
    "schemaVersion:10 is rejected by exact-boundary parsing, fails closed with " +
    "non-zero exit and zero public stdout lines, keeps public stderr to safe " +
    "parent diagnostics only, and keeps helper stdout/stderr private to Native Core.",
);
