#!/usr/bin/env node
// Electron native helper spawn diagnostic smoke checker.
//
// Protects the source-level diagnostics used when Electron cannot spawn the
// native tracker helper. Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const nativePipelinePath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "nativePipeline.ts",
);

const fail = (message) => {
  console.error(`Electron helper spawn diagnostic smoke check failed: ${message}`);
  process.exit(1);
};

const source = readFileSync(nativePipelinePath, "utf8");

const extractFunctionBody = (functionName) => {
  const signature = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*:[^{]+\\{`, "u");
  const match = signature.exec(source);
  if (!match) {
    fail(`missing ${functionName}() helper`);
  }

  let depth = 1;
  let index = match.index + match[0].length;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
    index += 1;
  }

  if (depth !== 0) {
    fail(`could not parse ${functionName}() helper body`);
  }

  return source.slice(match.index, index);
};

const describeBody = extractFunctionBody("describeTrackerSpawnError");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

requireMatch(
  describeBody,
  /errno\.code\s*===\s*['"]ENOENT['"]/u,
  "describeTrackerSpawnError() must handle ENOENT explicitly",
);
requireMatch(
  describeBody,
  /errno\.code\s*===\s*['"]EACCES['"]/u,
  "describeTrackerSpawnError() must handle EACCES explicitly",
);
requireMatch(
  describeBody,
  /ENOENT/u,
  "ENOENT diagnostic must include the ENOENT code",
);
requireMatch(
  describeBody,
  /not\s+accessible|missing|not\s+found|deleted|shared\s+library/iu,
  "ENOENT diagnostic must include actionable missing/inaccessible binary wording",
);
requireMatch(
  describeBody,
  /EACCES/u,
  "EACCES diagnostic must include the EACCES code",
);
requireMatch(
  describeBody,
  /executable|permissions/iu,
  "EACCES diagnostic must include executable/permissions wording",
);

requireMatch(
  source,
  /lastError:\s*truncateStatusMessage\(\s*describeTrackerSpawnError\(error\)\s*\)/u,
  "tracker spawn error handler must use describeTrackerSpawnError(error) inside truncateStatusMessage(...) protection",
);

console.log(
  "Electron helper spawn diagnostic smoke OK: describeTrackerSpawnError() " +
    "keeps explicit ENOENT/EACCES diagnostics and the tracker spawn handler " +
    "keeps truncateStatusMessage(describeTrackerSpawnError(error)).",
);
