#!/usr/bin/env node
// Electron/Desktop native runtime status contract smoke checker.
//
// Covers:
//   A. Preload API contract — LvkRuntimeStatus fields and LVK_IPC_CHANNELS keys.
//   B. Main process IPC registration — handler registration and openExternalUrl guard.
//   C. Local preview URL allowlist — only localhost/127.0.0.1 origins allowed.
//   D. Initial NativePipelineManager status — constants and createInitialStatus shape.
//
// Source-level only. No Electron, no child_process spawn, no transpilation.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const preloadApiPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "preload",
  "api.ts",
);
const mainIndexPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "index.ts",
);
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
    `Electron native runtime status contract check failed: ${message}`,
  );
  process.exit(1);
};

const preloadSrc = readFileSync(preloadApiPath, "utf8");
const mainSrc = readFileSync(mainIndexPath, "utf8");
const pipelineSrc = readFileSync(nativePipelinePath, "utf8");

const requireMatch = (src, pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// A. Preload API contract
// ---------------------------------------------------------------------------

requireMatch(
  preloadSrc,
  /export\s+interface\s+LvkRuntimeStatus\s*\{/u,
  "preload/api.ts must export LvkRuntimeStatus interface",
);

requireMatch(
  preloadSrc,
  /previewDummyUrl:\s*string/u,
  "LvkRuntimeStatus must include previewDummyUrl: string",
);

requireMatch(
  preloadSrc,
  /previewNativeUrl:\s*string/u,
  "LvkRuntimeStatus must include previewNativeUrl: string",
);

requireMatch(
  preloadSrc,
  /previewObsNativeUrl:\s*string/u,
  "LvkRuntimeStatus must include previewObsNativeUrl: string",
);

requireMatch(
  preloadSrc,
  /motionEndpoint:\s*string/u,
  "LvkRuntimeStatus must include motionEndpoint: string",
);

requireMatch(
  preloadSrc,
  /nativeTrackerStatus:\s*NativeTrackerStatus/u,
  "LvkRuntimeStatus must include nativeTrackerStatus: NativeTrackerStatus",
);

requireMatch(
  preloadSrc,
  /motionBridgeStatus:\s*MotionBridgeStatus/u,
  "LvkRuntimeStatus must include motionBridgeStatus: MotionBridgeStatus",
);

requireMatch(
  preloadSrc,
  /pipelineCameraSource\?:\s*NativePipelineCameraSource/u,
  "LvkRuntimeStatus must include optional pipelineCameraSource",
);

requireMatch(
  preloadSrc,
  /pipelineFaceDetector\?:\s*NativePipelineFaceDetector/u,
  "LvkRuntimeStatus must include optional pipelineFaceDetector",
);

requireMatch(
  preloadSrc,
  /pipelineCameraIndex\?:\s*number/u,
  "LvkRuntimeStatus must include optional pipelineCameraIndex",
);

requireMatch(
  preloadSrc,
  /pipelineCameraFps\?:\s*number/u,
  "LvkRuntimeStatus must include optional pipelineCameraFps",
);

requireMatch(
  preloadSrc,
  /pipelineCameraWidth\?:\s*number/u,
  "LvkRuntimeStatus must include optional pipelineCameraWidth",
);

requireMatch(
  preloadSrc,
  /pipelineCameraHeight\?:\s*number/u,
  "LvkRuntimeStatus must include optional pipelineCameraHeight",
);

requireMatch(
  preloadSrc,
  /lastError\?:\s*string/u,
  "LvkRuntimeStatus must include optional lastError",
);

requireMatch(
  preloadSrc,
  /lastMessage\?:\s*string/u,
  "LvkRuntimeStatus must include optional lastMessage",
);

requireMatch(
  preloadSrc,
  /export\s+const\s+LVK_IPC_CHANNELS\s*=/u,
  "preload/api.ts must export LVK_IPC_CHANNELS",
);

const requiredIpcKeys = [
  "getRuntimeStatus",
  "getRuntimeSettings",
  "saveRuntimeSettings",
  "startNativePipeline",
  "stopNativePipeline",
  "openExternalUrl",
];

for (const key of requiredIpcKeys) {
  requireMatch(
    preloadSrc,
    new RegExp(`${key}:\\s*['"]lvk:`, "u"),
    `LVK_IPC_CHANNELS must include ${key} with an 'lvk:' prefixed channel string`,
  );
}

// ---------------------------------------------------------------------------
// B. Main process IPC registration
// ---------------------------------------------------------------------------

for (const key of requiredIpcKeys) {
  requireMatch(
    mainSrc,
    new RegExp(`ipcMain\\.handle\\(\\s*LVK_IPC_CHANNELS\\.${key}`, "u"),
    `main/index.ts must register ipcMain.handle for LVK_IPC_CHANNELS.${key}`,
  );
}

requireMatch(
  mainSrc,
  /function\s+isSafeLocalPreviewUrl\s*\(\s*url:\s*string\s*\):\s*boolean/u,
  "main/index.ts must define isSafeLocalPreviewUrl(url: string): boolean",
);

requireMatch(
  mainSrc,
  /isSafeLocalPreviewUrl\(url\)/u,
  "openExternalUrl IPC handler must call isSafeLocalPreviewUrl(url) before shell.openExternal",
);

requireMatch(
  mainSrc,
  /shell\.openExternal\(url\)/u,
  "openExternalUrl IPC handler must call shell.openExternal(url)",
);

// Guard must come before openExternal in handler
const openExternalHandlerMatch = mainSrc.match(
  /LVK_IPC_CHANNELS\.openExternalUrl[\s\S]*?shell\.openExternal/u,
);
if (!openExternalHandlerMatch) {
  fail(
    "openExternalUrl IPC handler must reach shell.openExternal after the url safety check",
  );
}
if (!openExternalHandlerMatch[0].includes("isSafeLocalPreviewUrl")) {
  fail(
    "openExternalUrl IPC handler must call isSafeLocalPreviewUrl before shell.openExternal",
  );
}

requireMatch(
  mainSrc,
  /throw\s+new\s+Error\s*\(.*Only local LVK preview URLs/u,
  "openExternalUrl IPC handler must throw when the URL is not a safe local preview URL",
);

// Verify that registerLvkIpcHandlers is called during app.whenReady
requireMatch(
  mainSrc,
  /registerLvkIpcHandlers\s*\(\s*\)/u,
  "main/index.ts must call registerLvkIpcHandlers()",
);

// ---------------------------------------------------------------------------
// C. Local preview URL allowlist
// ---------------------------------------------------------------------------

const allowlistBlockMatch = mainSrc.match(
  /const\s+allowedPreviewUrls\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/u,
);
if (!allowlistBlockMatch) {
  fail(
    "main/index.ts must define allowedPreviewUrls as a Set of allowed URL strings",
  );
}

const allowlistBlock = allowlistBlockMatch[1];
const extractedUrls = [...allowlistBlock.matchAll(/['"]([^'"]+)['"]/gu)].map(
  (m) => m[1],
);

if (extractedUrls.length === 0) {
  fail("allowedPreviewUrls Set must contain at least one URL string literal");
}

const expectedLocalUrls = [
  "http://localhost:5173/?source=dummy",
  "http://localhost:5173/?source=native",
  "http://localhost:5173/?mode=obs&source=native",
  "http://127.0.0.1:5173/?source=dummy",
  "http://127.0.0.1:5173/?source=native",
  "http://127.0.0.1:5173/?mode=obs&source=native",
];

for (const expected of expectedLocalUrls) {
  if (!extractedUrls.includes(expected)) {
    fail(`allowedPreviewUrls must include the local preview URL: ${expected}`);
  }
}

for (const url of extractedUrls) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`allowedPreviewUrls contains an invalid URL: ${url}`);
  }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    fail(
      `allowedPreviewUrls must only contain localhost/127.0.0.1 URLs — found non-local host: ${parsed.hostname} in ${url}`,
    );
  }
}

// ---------------------------------------------------------------------------
// D. Initial NativePipelineManager status (source-level constants check)
//
// Importing nativePipeline.ts directly is not viable here: it imports
// 'node:child_process' (fine) and TypeScript types from '../preload/api' (not
// transpiled), and the class accesses __dirname which requires a CJS context.
// A source-level regex check avoids Electron/tsc build dependencies while still
// protecting the contract values that the Desktop UI and OBS preview depend on.
// ---------------------------------------------------------------------------

const expectedConstants = [
  ["PREVIEW_DUMMY_URL", "http://localhost:5173/?source=dummy"],
  ["PREVIEW_NATIVE_URL", "http://localhost:5173/?source=native"],
  ["PREVIEW_OBS_NATIVE_URL", "http://localhost:5173/?mode=obs&source=native"],
  ["MOTION_ENDPOINT", "ws://127.0.0.1:45731/motion"],
];

for (const [name, value] of expectedConstants) {
  requireMatch(
    pipelineSrc,
    new RegExp(
      `const\\s+${name}\\s*=\\s*['"]${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`,
      "u",
    ),
    `nativePipeline.ts must define ${name} = '${value}'`,
  );
}

const expectedDefaults = [
  ["DEFAULT_CAMERA_FPS", "60"],
  ["DEFAULT_CAMERA_WIDTH", "640"],
  ["DEFAULT_CAMERA_HEIGHT", "480"],
];

for (const [name, value] of expectedDefaults) {
  requireMatch(
    pipelineSrc,
    new RegExp(`const\\s+${name}\\s*=\\s*${value}\\b`, "u"),
    `nativePipeline.ts must define ${name} = ${value}`,
  );
}

requireMatch(
  pipelineSrc,
  /function\s+createInitialStatus\s*\(\s*\):\s*LvkRuntimeStatus/u,
  "nativePipeline.ts must define createInitialStatus(): LvkRuntimeStatus",
);

requireMatch(
  pipelineSrc,
  /previewDummyUrl:\s*PREVIEW_DUMMY_URL/u,
  "createInitialStatus must set previewDummyUrl from PREVIEW_DUMMY_URL",
);

requireMatch(
  pipelineSrc,
  /previewNativeUrl:\s*PREVIEW_NATIVE_URL/u,
  "createInitialStatus must set previewNativeUrl from PREVIEW_NATIVE_URL",
);

requireMatch(
  pipelineSrc,
  /previewObsNativeUrl:\s*PREVIEW_OBS_NATIVE_URL/u,
  "createInitialStatus must set previewObsNativeUrl from PREVIEW_OBS_NATIVE_URL",
);

requireMatch(
  pipelineSrc,
  /motionEndpoint:\s*MOTION_ENDPOINT/u,
  "createInitialStatus must set motionEndpoint from MOTION_ENDPOINT",
);

requireMatch(
  pipelineSrc,
  /nativeTrackerStatus:\s*['"]not_started['"]/u,
  "createInitialStatus must set nativeTrackerStatus to 'not_started'",
);

requireMatch(
  pipelineSrc,
  /motionBridgeStatus:\s*['"]manual_dev_tool['"]/u,
  "createInitialStatus must set motionBridgeStatus to 'manual_dev_tool'",
);

requireMatch(
  pipelineSrc,
  /pipelineCameraSource:\s*['"]dummy['"]/u,
  "createInitialStatus must set pipelineCameraSource to 'dummy'",
);

requireMatch(
  pipelineSrc,
  /pipelineFaceDetector:\s*['"]noop['"]/u,
  "createInitialStatus must set pipelineFaceDetector to 'noop'",
);

requireMatch(
  pipelineSrc,
  /pipelineCameraIndex:\s*0/u,
  "createInitialStatus must set pipelineCameraIndex to 0",
);

requireMatch(
  pipelineSrc,
  /pipelineCameraFps:\s*DEFAULT_CAMERA_FPS/u,
  "createInitialStatus must set pipelineCameraFps from DEFAULT_CAMERA_FPS",
);

requireMatch(
  pipelineSrc,
  /pipelineCameraWidth:\s*DEFAULT_CAMERA_WIDTH/u,
  "createInitialStatus must set pipelineCameraWidth from DEFAULT_CAMERA_WIDTH",
);

requireMatch(
  pipelineSrc,
  /pipelineCameraHeight:\s*DEFAULT_CAMERA_HEIGHT/u,
  "createInitialStatus must set pipelineCameraHeight from DEFAULT_CAMERA_HEIGHT",
);

requireMatch(
  pipelineSrc,
  /export\s+class\s+NativePipelineManager/u,
  "nativePipeline.ts must export NativePipelineManager class",
);

requireMatch(
  pipelineSrc,
  /private\s+status\s*=\s*createInitialStatus\(\)/u,
  "NativePipelineManager must initialise status from createInitialStatus()",
);

requireMatch(
  pipelineSrc,
  /getStatus\s*\(\s*\):\s*LvkRuntimeStatus\s*\{[\s\S]*?return\s*\{\s*\.\.\.\s*this\.status\s*\}/u,
  "NativePipelineManager.getStatus must return a shallow copy of this.status",
);

console.log(
  "Electron native runtime status contract OK:\n" +
    "  A. Preload API — LvkRuntimeStatus required and optional fields present; " +
    "LVK_IPC_CHANNELS includes all six required handler keys with lvk: prefix.\n" +
    "  B. Main IPC registration — all six LVK_IPC_CHANNELS handlers registered; " +
    "openExternalUrl guard calls isSafeLocalPreviewUrl before shell.openExternal " +
    "and throws for non-local URLs; registerLvkIpcHandlers is called at startup.\n" +
    "  C. Local preview URL allowlist — all six expected localhost/127.0.0.1 URLs " +
    "present; no non-local hosts detected.\n" +
    "  D. Initial pipeline status — PREVIEW_DUMMY_URL, PREVIEW_NATIVE_URL, " +
    "PREVIEW_OBS_NATIVE_URL, MOTION_ENDPOINT constants match expected values; " +
    "DEFAULT_CAMERA_FPS=60, DEFAULT_CAMERA_WIDTH=640, DEFAULT_CAMERA_HEIGHT=480; " +
    "createInitialStatus returns not_started/manual_dev_tool with dummy/noop defaults " +
    "and cameraIndex 0; NativePipelineManager.getStatus returns a shallow copy.",
);
