#!/usr/bin/env node
// Electron/Desktop native runtime capabilities contract smoke checker.
//
// Covers:
//   A. Preload API contract — NativeRuntimeCapabilities interface fields,
//      LVK_IPC_CHANNELS key, LvkDesktopApi method.
//   B. Preload bridge — getNativeRuntimeCapabilities invokes the IPC channel.
//   C. Main IPC handler — getNativeRuntimeCapabilities handler registered.
//   D. Capability query — queryNativeRuntimeCapabilities exported, uses
//      --print-runtime-capabilities, hardcodes cameraOpened/motionFramesEmitted/localOnly.
//   E. Renderer UI — capabilities section present, disclaimer present, no
//      webcam/OBS/OS camera permission validation claimed.
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
const preloadIndexPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "preload",
  "index.ts",
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
const appTsxPath = join(
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
    `Electron native runtime capabilities check failed: ${message}`,
  );
  process.exit(1);
};

const preloadApiSrc = readFileSync(preloadApiPath, "utf8");
const preloadIndexSrc = readFileSync(preloadIndexPath, "utf8");
const mainSrc = readFileSync(mainIndexPath, "utf8");
const pipelineSrc = readFileSync(nativePipelinePath, "utf8");
const appSrc = readFileSync(appTsxPath, "utf8");

const requireMatch = (src, pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

const requireNoMatch = (src, pattern, message) => {
  if (pattern.test(src)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// A. Preload API contract
// ---------------------------------------------------------------------------

requireMatch(
  preloadApiSrc,
  /export\s+interface\s+NativeRuntimeCapabilities\s*\{/u,
  "preload/api.ts must export NativeRuntimeCapabilities interface",
);

requireMatch(
  preloadApiSrc,
  /opencvCameraSupport:\s*boolean\s*\|\s*null/u,
  "NativeRuntimeCapabilities must include opencvCameraSupport: boolean | null",
);

requireMatch(
  preloadApiSrc,
  /opencvFaceDetectorSupport:\s*boolean\s*\|\s*null/u,
  "NativeRuntimeCapabilities must include opencvFaceDetectorSupport: boolean | null",
);

requireMatch(
  preloadApiSrc,
  /supportedCameraSources:\s*string\[\]/u,
  "NativeRuntimeCapabilities must include supportedCameraSources: string[]",
);

requireMatch(
  preloadApiSrc,
  /supportedFaceDetectors:\s*string\[\]/u,
  "NativeRuntimeCapabilities must include supportedFaceDetectors: string[]",
);

requireMatch(
  preloadApiSrc,
  /cameraOpened:\s*false/u,
  "NativeRuntimeCapabilities must include cameraOpened: false",
);

requireMatch(
  preloadApiSrc,
  /motionFramesEmitted:\s*false/u,
  "NativeRuntimeCapabilities must include motionFramesEmitted: false",
);

requireMatch(
  preloadApiSrc,
  /localOnly:\s*true/u,
  "NativeRuntimeCapabilities must include localOnly: true",
);

requireMatch(
  preloadApiSrc,
  /getNativeRuntimeCapabilities:\s*['"]lvk:get-native-runtime-capabilities['"]/u,
  "LVK_IPC_CHANNELS must include getNativeRuntimeCapabilities with channel 'lvk:get-native-runtime-capabilities'",
);

requireMatch(
  preloadApiSrc,
  /getNativeRuntimeCapabilities:\s*\(\s*\)\s*=>\s*Promise<NativeRuntimeCapabilities>/u,
  "LvkDesktopApi must include getNativeRuntimeCapabilities: () => Promise<NativeRuntimeCapabilities>",
);

// ---------------------------------------------------------------------------
// B. Preload bridge
// ---------------------------------------------------------------------------

requireMatch(
  preloadIndexSrc,
  /getNativeRuntimeCapabilities/u,
  "preload/index.ts must implement getNativeRuntimeCapabilities",
);

requireMatch(
  preloadIndexSrc,
  /LVK_IPC_CHANNELS\.getNativeRuntimeCapabilities/u,
  "preload/index.ts getNativeRuntimeCapabilities must invoke LVK_IPC_CHANNELS.getNativeRuntimeCapabilities",
);

// ---------------------------------------------------------------------------
// C. Main IPC handler
// ---------------------------------------------------------------------------

requireMatch(
  mainSrc,
  /ipcMain\.handle\(\s*LVK_IPC_CHANNELS\.getNativeRuntimeCapabilities/u,
  "main/index.ts must register ipcMain.handle for LVK_IPC_CHANNELS.getNativeRuntimeCapabilities",
);

requireMatch(
  mainSrc,
  /queryNativeRuntimeCapabilities/u,
  "main/index.ts must call queryNativeRuntimeCapabilities in the IPC handler",
);

// ---------------------------------------------------------------------------
// D. Capability query in nativePipeline.ts
// ---------------------------------------------------------------------------

requireMatch(
  pipelineSrc,
  /export\s+async\s+function\s+queryNativeRuntimeCapabilities/u,
  "nativePipeline.ts must export async function queryNativeRuntimeCapabilities",
);

requireMatch(
  pipelineSrc,
  /['"]--print-runtime-capabilities['"]/u,
  "nativePipeline.ts queryNativeRuntimeCapabilities must pass '--print-runtime-capabilities' to the binary",
);

requireMatch(
  pipelineSrc,
  /cameraOpened:\s*false/u,
  "nativePipeline.ts must hardcode cameraOpened: false in capability results",
);

requireMatch(
  pipelineSrc,
  /motionFramesEmitted:\s*false/u,
  "nativePipeline.ts must hardcode motionFramesEmitted: false in capability results",
);

requireMatch(
  pipelineSrc,
  /localOnly:\s*true/u,
  "nativePipeline.ts must hardcode localOnly: true in capability results",
);

// Non-zero exit code must produce a generic error, not parsed output
requireMatch(
  pipelineSrc,
  /child\.on\s*\(\s*['"]close['"][\s\S]*?code[\s\S]*?!==\s*0/u,
  "nativePipeline.ts close handler must treat non-zero exit codes as a failure",
);

// close handler must not call parseCapabilitiesOutput unconditionally
const closeHandlerMatch = pipelineSrc.match(
  /child\.on\s*\(\s*['"]close['"][\s\S]*?\}\s*\)/u,
);
if (!closeHandlerMatch) {
  fail(
    "nativePipeline.ts must define a close handler for the capabilities child process",
  );
}
if (
  !/code\s*!==\s*0/.test(closeHandlerMatch[0]) ||
  !closeHandlerMatch[0].includes("parseCapabilitiesOutput")
) {
  fail(
    "nativePipeline.ts close handler must guard parseCapabilitiesOutput behind a zero-exit-code check",
  );
}

// Spawn error handler must not forward describeTrackerSpawnError or err.message to renderer
requireNoMatch(
  pipelineSrc,
  /child\.on\s*\(\s*['"]error['"][\s\S]{0,300}describeTrackerSpawnError/u,
  "nativePipeline.ts capabilities error handler must not pass describeTrackerSpawnError to the renderer",
);

requireNoMatch(
  pipelineSrc,
  /child\.on\s*\(\s*['"]error['"][\s\S]{0,300}err\.message/u,
  "nativePipeline.ts capabilities error handler must not expose err.message to the renderer",
);

// Header validation must be present before parsing
requireMatch(
  pipelineSrc,
  /LVK native runtime capabilities/u,
  "nativePipeline.ts must validate the 'LVK native runtime capabilities' header before accepting output",
);

// ---------------------------------------------------------------------------
// E. Renderer UI
// ---------------------------------------------------------------------------

requireMatch(
  appSrc,
  /native-capabilities-heading/u,
  "App.tsx must include a capabilities section with id/aria reference 'native-capabilities-heading'",
);

requireMatch(
  appSrc,
  /Native runtime capabilities/u,
  "App.tsx must include 'Native runtime capabilities' heading text",
);

requireMatch(
  appSrc,
  /getNativeRuntimeCapabilities/u,
  "App.tsx must call getNativeRuntimeCapabilities via the desktop API",
);

requireMatch(
  appSrc,
  /[Dd]oes not open a camera/u,
  "App.tsx capabilities section must include a disclaimer that it does not open a camera",
);

// The capabilities section must not claim webcam/OS camera permission/OBS validation
const capabilitiesSectionMatch = appSrc.match(
  /native-capabilities-heading[\s\S]*?<\/section>/u,
);
if (!capabilitiesSectionMatch) {
  fail(
    "App.tsx must contain a complete capabilities section ending with </section>",
  );
}

const capabilitiesSection = capabilitiesSectionMatch[0];

requireNoMatch(
  capabilitiesSection,
  /webcam\s+validated|webcam\s+access\s+confirmed|camera\s+permission\s+granted|OS\s+camera\s+permission\s+validated|OBS\s+validated/iu,
  "App.tsx capabilities section must not claim webcam, OS camera permission, or OBS validation",
);

console.log(
  "Electron native runtime capabilities check OK:\n" +
    "  A. Preload API — NativeRuntimeCapabilities interface exported with all required fields " +
    "(opencvCameraSupport, opencvFaceDetectorSupport, supportedCameraSources, " +
    "supportedFaceDetectors, cameraOpened: false, motionFramesEmitted: false, localOnly: true); " +
    "LVK_IPC_CHANNELS includes getNativeRuntimeCapabilities; " +
    "LvkDesktopApi includes getNativeRuntimeCapabilities method.\n" +
    "  B. Preload bridge — getNativeRuntimeCapabilities invokes LVK_IPC_CHANNELS.getNativeRuntimeCapabilities.\n" +
    "  C. Main IPC handler — ipcMain.handle registered for getNativeRuntimeCapabilities; " +
    "queryNativeRuntimeCapabilities is called.\n" +
    "  D. Capability query — queryNativeRuntimeCapabilities exported; " +
    "--print-runtime-capabilities flag used; " +
    "cameraOpened/motionFramesEmitted/localOnly hardcoded in results; " +
    "non-zero exit codes produce a sanitized generic error; " +
    "spawn error handler does not expose describeTrackerSpawnError or err.message; " +
    "output header validated before parsing.\n" +
    "  E. Renderer UI — capabilities section present with heading and disclaimer; " +
    "getNativeRuntimeCapabilities called; no webcam/OBS/OS camera permission validation claimed.",
);
