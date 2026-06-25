#!/usr/bin/env node
// Electron desktop runtime message panel smoke checker.
//
// Verifies that App.tsx renders a compact runtime-details-panel grouping
// lastMessage, lastError, and pipelineError, that accessibility semantics are
// preserved, and that main.css defines the required panel classes.
// Dependency-free: Node built-ins only.
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
const cssPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "assets",
  "main.css",
);
const packageJsonPath = join(repoRoot, "package.json");

const fail = (message) => {
  console.error(`Electron runtime message panel check failed: ${message}`);
  process.exit(1);
};

const source = readFileSync(appRendererPath, "utf8");
const css = readFileSync(cssPath, "utf8");
const packageJson = readFileSync(packageJsonPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

requireMatch(
  source,
  /className=['"]runtime-details-panel['"]/u,
  'App.tsx must render an element with className="runtime-details-panel"',
);

requireMatch(
  source,
  /Runtime details/u,
  'App.tsx must include "Runtime details" label text',
);

const summaryIndex = source.indexOf("runtime-status-summary");
const detailsPanelIndex = source.indexOf("runtime-details-panel");

if (detailsPanelIndex === -1) {
  fail("runtime-details-panel not found in App.tsx");
}
if (summaryIndex === -1) {
  fail("runtime-status-summary not found in App.tsx");
}
if (detailsPanelIndex <= summaryIndex) {
  fail(
    "runtime-details-panel must appear after runtime-status-summary in App.tsx",
  );
}

requireMatch(
  source,
  /runtime-details-panel[\s\S]*?Latest status/u,
  'runtime-details-panel must include "Latest status" label',
);

requireMatch(
  source,
  /runtime-details-panel[\s\S]*?runtimeStatus\.lastMessage\s*\?\s*\(\s*<p[\s\S]*?role=['"]status['"]/u,
  'runtime-details-panel must render runtimeStatus.lastMessage with role="status"',
);

requireMatch(
  source,
  /runtime-details-panel[\s\S]*?Latest error/u,
  'runtime-details-panel must include "Latest error" label',
);

requireMatch(
  source,
  /runtime-details-panel[\s\S]*?runtimeStatus\.lastError\s*\?\s*\(\s*<p[\s\S]*?role=['"]alert['"]/u,
  'runtime-details-panel must render runtimeStatus.lastError with role="alert"',
);

requireMatch(
  source,
  /runtime-details-panel[\s\S]*?pipelineError\s*\?\s*\(\s*<p[\s\S]*?role=['"]alert['"]/u,
  'runtime-details-panel must render pipelineError with role="alert"',
);

requireMatch(
  css,
  /\.runtime-details-panel\s*\{/u,
  "main.css must define .runtime-details-panel",
);

requireMatch(
  css,
  /\.runtime-details-panel__header\s*\{/u,
  "main.css must define .runtime-details-panel__header",
);

requireMatch(
  css,
  /\.runtime-details-panel__items\s*\{/u,
  "main.css must define .runtime-details-panel__items",
);

requireMatch(
  css,
  /\.runtime-details-panel__item\s*\{/u,
  "main.css must define .runtime-details-panel__item",
);

requireMatch(
  packageJson,
  /"test:electron-runtime-message-panel":\s*"node tools\/check-electron-runtime-message-panel\.mjs"/u,
  'package.json must include "test:electron-runtime-message-panel" script',
);

requireMatch(
  packageJson,
  /test:electron-runtime-message-panel/u,
  'package.json "test" script must wire in test:electron-runtime-message-panel',
);

console.log(
  "Electron runtime message panel check OK: " +
    'App.tsx renders runtime-details-panel after runtime-status-summary; panel includes "Runtime details" label; ' +
    '"Latest status" label preserved with runtimeStatus.lastMessage and role="status"; ' +
    '"Latest error" label preserved with runtimeStatus.lastError and role="alert"; ' +
    'pipelineError preserved with role="alert"; ' +
    "main.css defines runtime-details-panel, __header, __items, and __item classes; " +
    "package.json includes test:electron-runtime-message-panel script.",
);
