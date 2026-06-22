#!/usr/bin/env node
// Electron Motion bridge lifecycle exit diagnostic smoke checker.
//
// Protects the source-level diagnostic set when the Motion bridge exits
// unexpectedly during pipeline operation. Dependency-free: Node built-ins only.
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
    `Electron bridge lifecycle exit diagnostic smoke check failed: ${message}`,
  );
  process.exit(1);
};

const source = readFileSync(nativePipelinePath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

if (!/kind === 'bridge' && this\.bridgeProcess === childProcess/u.test(source)) {
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
  "Electron bridge lifecycle exit diagnostic smoke OK: bridge unexpected-exit " +
    "lastError includes exit code, signal, and actionable guidance.",
);
