#!/usr/bin/env node
// Electron/Desktop native runtime repository-root resolution checker.
//
// Covers findRepoRoot()/isLvkRepoRoot() in apps/desktop/src/main/nativePipeline.ts:
//   A. isLvkRepoRoot uses stable repo-level markers (package.json name +
//      native/tracker-core), not a bare package.json existence check, so a
//      nested workspace package (apps/desktop) is never mistaken for the root.
//   B. package.json reads are guarded against parse/read failures.
//   C. findRepoRoot walks upward using isLvkRepoRoot and keeps a bounded,
//      dependency-free fallback.
//   D. Tracker executable candidates resolve from native/tracker-core/build/...
//      under the resolved repository root.
//
// Source-level only. No Electron, no child_process spawn, no transpilation.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    `Electron native runtime root resolution check failed: ${message}`,
  );
  process.exit(1);
};

const src = readFileSync(nativePipelinePath, "utf8");

const requireMatch = (pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// A. isLvkRepoRoot marker-based check
// ---------------------------------------------------------------------------

requireMatch(
  /function\s+isLvkRepoRoot\s*\(\s*candidatePath:\s*string\s*\)\s*:\s*boolean/u,
  "nativePipeline.ts must define isLvkRepoRoot(candidatePath: string): boolean",
);

// Must confirm the LVK monorepo root package.json name, not any package.json.
requireMatch(
  /parsed\.name\s*===\s*['"]local-virtual-kit['"]/u,
  "isLvkRepoRoot must confirm the repo root package.json name is 'local-virtual-kit'",
);

// Must require the Native Core source tree so nested packages are rejected.
requireMatch(
  /existsSync\s*\(\s*join\s*\(\s*candidatePath\s*,\s*['"]native['"]\s*,\s*['"]tracker-core['"]\s*\)\s*\)/u,
  "isLvkRepoRoot must require native/tracker-core under the candidate path",
);

// ---------------------------------------------------------------------------
// B. Safe package.json parsing
// ---------------------------------------------------------------------------

const guardedParse = src.match(
  /try\s*\{[\s\S]{0,200}?JSON\.parse\s*\(\s*readFileSync\s*\([\s\S]{0,200}?\}\s*catch\s*\{/u,
);
if (!guardedParse) {
  fail(
    "isLvkRepoRoot must wrap JSON.parse(readFileSync(...)) in try/catch to handle read/parse failures",
  );
}

// ---------------------------------------------------------------------------
// C. findRepoRoot walk + bounded fallback
// ---------------------------------------------------------------------------

requireMatch(
  /function\s+findRepoRoot\s*\(\s*\)\s*:\s*string/u,
  "nativePipeline.ts must define findRepoRoot(): string",
);

// The walk must use the marker check, not a bare package.json existence test.
const findRepoRootBody = src.match(
  /function\s+findRepoRoot\s*\(\s*\)\s*:\s*string\s*\{([\s\S]*?)\n\}/u,
);
if (!findRepoRootBody) {
  fail("Unable to locate findRepoRoot() body for inspection");
}
if (!/isLvkRepoRoot\s*\(\s*current\s*\)/u.test(findRepoRootBody[1])) {
  fail("findRepoRoot must decide the repo root via isLvkRepoRoot(current)");
}
if (
  /if\s*\(\s*existsSync\s*\(\s*join\s*\(\s*current\s*,\s*['"]package\.json['"]\s*\)\s*\)\s*\)\s*\{\s*return\s+current/u.test(
    findRepoRootBody[1],
  )
) {
  fail(
    "findRepoRoot must not return the first directory that merely contains a package.json",
  );
}

// The upward walk must stay bounded.
if (!/for\s*\([\s\S]{0,80}?depth\s*<\s*\d+/u.test(findRepoRootBody[1])) {
  fail("findRepoRoot must keep the upward walk bounded by a depth limit");
}

// A safe fallback must remain when no marker is found.
if (!/return\s+resolve\s*\(\s*__dirname\s*,/u.test(findRepoRootBody[1])) {
  fail(
    "findRepoRoot must keep a bounded __dirname-relative fallback when no repo root marker is found",
  );
}

// ---------------------------------------------------------------------------
// D. Candidate paths resolve under native/tracker-core/build from the repo root
// ---------------------------------------------------------------------------

requireMatch(
  /join\s*\(\s*repoRoot\s*,\s*['"]native['"]\s*,\s*['"]tracker-core['"]\s*,\s*['"]build['"]\s*\)/u,
  "getTrackerExecutableCandidates must build from native/tracker-core/build under the resolved repoRoot",
);

requireMatch(
  /const\s+configDirs\s*=\s*\[\s*['"]{2}\s*,\s*['"]Debug['"]\s*,\s*['"]Release['"]\s*,\s*['"]RelWithDebInfo['"]\s*,\s*['"]MinSizeRel['"]\s*\]/u,
  "getTrackerExecutableCandidates must keep explicit, deterministic config dir ordering ('', Debug, Release, RelWithDebInfo, MinSizeRel)",
);

console.log(
  "Electron native runtime root resolution OK:\n" +
    "  A. isLvkRepoRoot requires package.json name 'local-virtual-kit' AND native/tracker-core, " +
    "so nested workspace packages (apps/desktop) are not mistaken for the repo root.\n" +
    "  B. package.json parsing is guarded by try/catch for read/parse failures.\n" +
    "  C. findRepoRoot walks upward via isLvkRepoRoot within a bounded depth and " +
    "keeps a dependency-free __dirname-relative fallback; it never returns on a bare package.json match.\n" +
    "  D. Tracker candidates resolve from native/tracker-core/build/... under the resolved repo root " +
    "with deterministic config ordering ('', Debug, Release, RelWithDebInfo, MinSizeRel).",
);
