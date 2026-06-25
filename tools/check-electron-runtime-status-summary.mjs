#!/usr/bin/env node
// Electron desktop runtime status summary smoke checker.
//
// Verifies that App.tsx renders the runtime-status-summary panel before
// status-list, that it includes native tracker, motion bridge, active camera
// source, and last-refreshed time using existing state, and that main.css
// defines the required summary classes. Dependency-free: Node built-ins only.
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
  console.error(`Electron runtime status summary check failed: ${message}`);
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
  /className=['"]runtime-status-summary['"]/u,
  'App.tsx must render an element with className="runtime-status-summary"',
);

requireMatch(
  source,
  /Native runtime overview/u,
  'App.tsx runtime-status-summary must include text "Native runtime overview"',
);

const summaryIndex = source.indexOf("runtime-status-summary");
const statusListIndex = source.indexOf('className="status-list"');

if (summaryIndex === -1) {
  fail("runtime-status-summary not found in App.tsx");
}
if (statusListIndex === -1) {
  fail("status-list not found in App.tsx");
}
if (summaryIndex >= statusListIndex) {
  fail("runtime-status-summary must appear before status-list in App.tsx");
}

requireMatch(
  source,
  /runtime-status-summary[\s\S]*?statusLabels\[runtimeStatus\.nativeTrackerStatus\][\s\S]*?getStatusTone\(runtimeStatus\.nativeTrackerStatus\)/u,
  "runtime-status-summary must display native tracker status using statusLabels and getStatusTone",
);

requireMatch(
  source,
  /runtime-status-summary[\s\S]*?bridgeLabels\[runtimeStatus\.motionBridgeStatus\][\s\S]*?getStatusTone\(runtimeStatus\.motionBridgeStatus\)/u,
  "runtime-status-summary must display motion bridge status using bridgeLabels and getStatusTone",
);

requireMatch(
  source,
  /runtime-status-summary[\s\S]*?cameraSourceLabels\[activeCameraSource\]/u,
  "runtime-status-summary must display active camera source using cameraSourceLabels[activeCameraSource]",
);

requireMatch(
  source,
  /runtime-status-summary[\s\S]*?lastRuntimeStatusRefreshLabel/u,
  "runtime-status-summary must reference lastRuntimeStatusRefreshLabel",
);

requireMatch(
  css,
  /\.runtime-status-summary\s*\{/u,
  "main.css must define .runtime-status-summary",
);

requireMatch(
  css,
  /\.runtime-status-summary__header\s*\{/u,
  "main.css must define .runtime-status-summary__header",
);

requireMatch(
  css,
  /\.runtime-status-summary__items\s*\{/u,
  "main.css must define .runtime-status-summary__items",
);

requireMatch(
  css,
  /\.runtime-status-summary__item\s*\{/u,
  "main.css must define .runtime-status-summary__item",
);

requireMatch(
  packageJson,
  /"test:electron-runtime-status-summary":\s*"node tools\/check-electron-runtime-status-summary\.mjs"/u,
  'package.json must include "test:electron-runtime-status-summary" script',
);

console.log(
  "Electron runtime status summary check OK: " +
    "App.tsx renders runtime-status-summary before status-list; " +
    "summary includes Native runtime overview label; " +
    "native tracker status shown via statusLabels and getStatusTone; " +
    "motion bridge status shown via bridgeLabels and getStatusTone; " +
    "active camera source shown via cameraSourceLabels[activeCameraSource]; " +
    "lastRuntimeStatusRefreshLabel referenced in summary; " +
    "main.css defines runtime-status-summary, __header, __items, and __item classes; " +
    "package.json includes test:electron-runtime-status-summary script.",
);
