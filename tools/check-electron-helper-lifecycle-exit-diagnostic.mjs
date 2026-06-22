#!/usr/bin/env node
// Electron native helper lifecycle exit diagnostic smoke checker.
//
// Protects the source-level diagnostic used when the native tracker helper
// exits unexpectedly during the pipeline lifecycle. Dependency-free: Node
// built-ins only.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nativePipelinePath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "nativePipeline.ts",
);

const fail = (message) => {
  console.error(
    `Electron helper lifecycle exit diagnostic smoke check failed: ${message}`,
  );
  process.exit(1);
};

const source = readFileSync(nativePipelinePath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

// Locate the tracker unexpected-exit block inside attachProcessHandlers.
const exitBlockPattern = /trackerExitMessage\s*=\s*`[^`]+`/u;
const exitBlockMatch = exitBlockPattern.exec(source);
if (!exitBlockMatch) {
  fail("trackerExitMessage assignment not found in source");
}

const exitMessage = exitBlockMatch[0];

requireMatch(
  exitMessage,
  /stopped\s+unexpectedly|exited\s+unexpectedly/iu,
  "trackerExitMessage must describe the unexpected exit",
);
requireMatch(
  exitMessage,
  /code\s*\$\{/u,
  "trackerExitMessage must include the exit code",
);
requireMatch(
  exitMessage,
  /signal\s*\$\{/u,
  "trackerExitMessage must include the signal",
);
requireMatch(
  exitMessage,
  /stderr|rebuild/iu,
  "trackerExitMessage must include actionable guidance (stderr or rebuild)",
);

console.log(
  "Electron helper lifecycle exit diagnostic smoke OK: trackerExitMessage " +
    "includes unexpected-exit description, code, signal, and actionable guidance.",
);
