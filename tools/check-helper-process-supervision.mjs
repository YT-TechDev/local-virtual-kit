#!/usr/bin/env node
// Helper process supervision smoke checker (H1c).
//
// Runs lvk-helper-process-supervision-smoke against lvk-synthetic-helper and
// validates that supervision succeeded, that the parent kept its stdout empty
// (captured child output is private and must not be forwarded), and that parent
// stderr uses only the safe [supervision-smoke] prefix. See
// docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
//
// Dependency-free: Node built-ins only.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const supervisionPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const helperPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

const fail = (message, result) => {
  console.error(`Helper process supervision smoke check failed: ${message}`);
  if (result) {
    const snippet = (value) => {
      const trimmed = (value ?? "").trim();
      if (trimmed.length === 0) {
        return "(empty)";
      }
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    };
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${snippet(result.stderr)}`);
    console.error(`stdout: ${snippet(result.stdout)}`);
  }
  process.exit(1);
};

if (!supervisionPath || !helperPath) {
  fail(
    "expected two arguments: <supervision-smoke-path> <synthetic-helper-path>",
  );
}

const result = spawnSync(supervisionPath, [helperPath], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.error) {
  fail(`could not run ${supervisionPath}: ${result.error.message}`, result);
}
if (result.status !== 0) {
  fail("expected exit status 0", result);
}

// The parent must not forward captured child output. Its stdout should be empty
// and must never contain MotionFrame JSON or helper internal result JSON.
const stdout = result.stdout ?? "";
if (stdout.trim().length !== 0) {
  fail(
    "expected empty parent stdout (captured child output must be private)",
    result,
  );
}

const leakMarkers = [
  '"source":"native"', // MotionFrame
  '"schemaVersion"', // MotionFrame / helper contract
  '"source":"synthetic-helper"', // helper ready line
  '"type":"result"', // helper internal result
  '"type":"ready"',
  '"type":"stopped"',
];
for (const marker of leakMarkers) {
  if (stdout.includes(marker)) {
    fail(
      `parent stdout leaked child output marker ${JSON.stringify(marker)}`,
      result,
    );
  }
}

// Parent diagnostics must use only the safe [supervision-smoke] prefix.
const stderrLines = (result.stderr ?? "")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (stderrLines.length === 0) {
  fail(
    "expected at least one [supervision-smoke] diagnostic line on stderr",
    result,
  );
}
stderrLines.forEach((line) => {
  if (!line.startsWith("[supervision-smoke] ")) {
    fail(`unexpected non-supervision-smoke stderr line: ${line}`, result);
  }
});

console.log(
  "Helper process supervision smoke OK: supervision succeeded, parent stdout " +
    "empty (no child output leaked), safe [supervision-smoke] stderr.",
);
