#!/usr/bin/env node
// Electron native helper lifecycle exit diagnostic smoke checker.
//
// Protects the source-level diagnostics used when the native tracker or Motion
// bridge exits unexpectedly during the pipeline lifecycle.
// Dependency-free: Node built-ins only.
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

// --- Native tracker unexpected-exit diagnostic ---

const exitBlockPattern = /trackerExitMessage\s*=\s*`[^`]+`/u;
const exitBlockMatch = exitBlockPattern.exec(source);
if (!exitBlockMatch) {
  fail("trackerExitMessage assignment not found in source");
}

const trackerExitMessage = exitBlockMatch[0];

requireMatch(
  trackerExitMessage,
  /stopped\s+unexpectedly|exited\s+unexpectedly/iu,
  "trackerExitMessage must describe the unexpected exit",
);
requireMatch(
  trackerExitMessage,
  /code\s*\$\{/u,
  "trackerExitMessage must include the exit code",
);
requireMatch(
  trackerExitMessage,
  /signal\s*\$\{/u,
  "trackerExitMessage must include the signal",
);
requireMatch(
  trackerExitMessage,
  /stderr|rebuild/iu,
  "trackerExitMessage must include actionable guidance (stderr or rebuild)",
);

// --- Motion bridge unexpected-exit diagnostic ---

if (
  !/kind === 'bridge' && this\.bridgeProcess === childProcess/u.test(source)
) {
  fail("bridge exit handler not found in nativePipeline.ts");
}

requireMatch(
  source,
  /Motion bridge exited unexpectedly/u,
  "bridge exit diagnostic must use 'exited unexpectedly' wording",
);
requireMatch(
  source,
  /code\s*\?\?\s*['"]null['"]/u,
  "bridge exit diagnostic must include the exit code",
);
requireMatch(
  source,
  /signal\s*\?\?\s*['"]none['"]/u,
  "bridge exit diagnostic must include signal with 'none' fallback",
);
requireMatch(
  source,
  /bridge\s+stderr|paired\s+native\s+tracker|native\s+tracker/iu,
  "bridge exit diagnostic must include actionable guidance about bridge stderr or the paired native tracker",
);

console.log(
  "Electron helper lifecycle exit diagnostic smoke OK: tracker and bridge " +
    "unexpected-exit diagnostics each include failure description, exit code, " +
    "signal, and actionable guidance.",
);
