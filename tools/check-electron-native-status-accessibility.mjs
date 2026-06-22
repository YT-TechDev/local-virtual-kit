#!/usr/bin/env node
// Electron native runtime status accessibility smoke checker.
//
// Protects the source-level renderer markup for native runtime status/error
// announcements. Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appRendererPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "App.tsx",
);

const fail = (message) => {
  console.error(
    `Electron native status accessibility smoke check failed: ${message}`,
  );
  process.exit(1);
};

const source = readFileSync(appRendererPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

requireMatch(
  source,
  /<strong\s+id=['"]latest-error-label['"]\s+className=['"]status-detail-label['"]>\s*Latest error\s*<\/strong>/u,
  "runtimeStatus.lastError must keep a visible Latest error label",
);
requireMatch(
  source,
  /<strong\s+id=['"]latest-status-label['"]\s+className=['"]status-detail-label['"]>\s*Latest status\s*<\/strong>/u,
  "runtimeStatus.lastMessage must keep a visible Latest status label",
);
requireMatch(
  source,
  /runtimeStatus\.lastError\s*\?\s*\(\s*<p\s+className=['"]error-message compact['"]\s+role=['"]alert['"]\s+aria-labelledby=['"]latest-error-label['"][\s\S]*?\{runtimeStatus\.lastError\}/u,
  'runtimeStatus.lastError must keep role="alert" and aria-labelledby="latest-error-label" linkage',
);
requireMatch(
  source,
  /runtimeStatus\.lastMessage\s*\?\s*\(\s*<p\s+className=['"]runtime-message['"]\s+role=['"]status['"]\s+aria-labelledby=['"]latest-status-label['"][\s\S]*?\{runtimeStatus\.lastMessage\}/u,
  'runtimeStatus.lastMessage must keep role="status" and aria-labelledby="latest-status-label" linkage',
);
requireMatch(
  source,
  /pipelineError\s*\?\s*\(\s*<p\s+className=['"]error-message compact['"]\s+role=['"]alert['"]>\s*\{pipelineError\}/u,
  'pipelineError must keep role="alert" semantics',
);

console.log(
  "Electron native status accessibility smoke OK: lastError keeps a visible " +
    "Latest error label with alert semantics and aria-labelledby linkage; " +
    "lastMessage keeps a visible Latest status label with status semantics and " +
    "aria-labelledby linkage; pipelineError keeps alert semantics.",
);
