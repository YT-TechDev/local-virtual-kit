#!/usr/bin/env node
// Electron MediaPipe development controls checker (#596).
//
// Protects the source-level contract for the persisted, development-only
// tracking-backend selector: the exact two-option closed selector, its
// accessible label/description association, the MediaPipe/OpenCV camera
// compatibility guard, that the incompatible state blocks Start, that both
// start actions pass the selected backend through the existing typed IPC
// call, that unrelated camera/detector settings are never silently
// rewritten, that the selector obeys the existing busy/pending disabling,
// and that no MediaPipe Python/model/helper path or private environment
// value ever enters DesktopRuntimeSettings or renderer state.
//
// Source-contract only: no Electron, no React render, no transpilation.
// Dependency-free: Node built-ins only. This does not prove real Electron
// GUI, webcam, or MediaPipe execution.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const apiPath = join(repoRoot, "apps", "desktop", "src", "preload", "api.ts");
const runtimeSettingsConfigPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "runtimeSettingsConfig.ts",
);
const appRendererPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "App.tsx",
);
const packageJsonPath = join(repoRoot, "package.json");

const fail = (message) => {
  console.error(
    `Electron MediaPipe development controls check failed: ${message}`,
  );
  process.exit(1);
};

const apiSource = readFileSync(apiPath, "utf8");
const configSource = readFileSync(runtimeSettingsConfigPath, "utf8");
const rendererSource = readFileSync(appRendererPath, "utf8");
const packageJsonSource = readFileSync(packageJsonPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

const requireNoMatch = (text, pattern, message) => {
  if (pattern.test(text)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// 1. Exact two-option closed selector with the fixed tokens and labels
// ---------------------------------------------------------------------------

const selectorBlockMatch = rendererSource.match(
  /<select\s+id="tracking-backend"[\s\S]*?<\/select>/u,
);
if (!selectorBlockMatch) {
  fail(
    'renderer must render <select id="tracking-backend"> for the tracking backend control',
  );
}
const selectorBlock = selectorBlockMatch[0];

const optionValues = [
  ...selectorBlock.matchAll(/<option\s+(?:[^>]*?\s)?value="([^"]+)"/gu),
].map((m) => m[1]);
const expectedOptionValues = ["face-pipeline", "mediapipe-face-landmarker"];
if (
  optionValues.length !== expectedOptionValues.length ||
  !expectedOptionValues.every((value, index) => optionValues[index] === value)
) {
  fail(
    `tracking-backend selector must declare exactly the options ${JSON.stringify(expectedOptionValues)} in order, found ${JSON.stringify(optionValues)}`,
  );
}

requireMatch(
  rendererSource,
  /trackingBackendLabels:\s*Record<NativePipelineTrackingBackend,\s*string>\s*=\s*\{\s*\n\s*'face-pipeline':\s*'Face pipeline',\s*\n\s*'mediapipe-face-landmarker':\s*'MediaPipe Face Landmarker \(development\)'/u,
  "trackingBackendLabels must map face-pipeline to 'Face pipeline' and mediapipe-face-landmarker to 'MediaPipe Face Landmarker (development)'",
);

// ---------------------------------------------------------------------------
// 2. Accessible label and explanatory text association
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /<label className="field-row" htmlFor="tracking-backend">\s*\n\s*<span>Tracking backend<\/span>/u,
  'the selector must be wrapped in a <label htmlFor="tracking-backend"> with visible text "Tracking backend"',
);

requireMatch(
  selectorBlock,
  /aria-describedby="tracking-backend-description"/u,
  'the tracking-backend selector must set aria-describedby="tracking-backend-description"',
);

requireMatch(
  rendererSource,
  /<p id="tracking-backend-description" className="note">/u,
  'a <p id="tracking-backend-description"> element must exist to satisfy the selector\'s aria-describedby association',
);

// The explanatory text must not disclose configuration values or private paths
const descriptionBlockMatch = rendererSource.match(
  /<p id="tracking-backend-description"[^>]*>([\s\S]*?)<\/p>/u,
);
if (!descriptionBlockMatch) {
  fail("tracking-backend-description paragraph body must be present");
}
requireNoMatch(
  descriptionBlockMatch[1],
  /LVK_MEDIAPIPE_|[A-Za-z]:\\|\/(?:usr|home|Users)\//u,
  "tracking-backend-description must not disclose environment-variable names or resolved paths",
);

// ---------------------------------------------------------------------------
// 3. MediaPipe/OpenCV camera compatibility guard
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /const\s+isMediaPipeCameraIncompatible\s*=\s*\n?\s*selectedTrackingBackend\s*===\s*'mediapipe-face-landmarker'\s*&&\s*selectedCameraSource\s*!==\s*'opencv'/u,
  "isMediaPipeCameraIncompatible must require selectedTrackingBackend === 'mediapipe-face-landmarker' && selectedCameraSource !== 'opencv'",
);

// The MediaPipe <option> must not be newly selectable while a non-OpenCV
// camera source is selected (browsers still render an already-selected but
// disabled option, so a previously persisted value is preserved).
requireMatch(
  selectorBlock,
  /<option\s*\n?\s*value="mediapipe-face-landmarker"\s*\n?\s*disabled=\{selectedCameraSource\s*!==\s*'opencv'\}/u,
  "the mediapipe-face-landmarker <option> must set disabled={selectedCameraSource !== 'opencv'}",
);

// cameraSource must never be silently coerced to opencv when MediaPipe is selected
requireNoMatch(
  rendererSource,
  /updateSelectedTrackingBackend[\s\S]{0,400}setSelectedCameraSource/u,
  "updateSelectedTrackingBackend must not call setSelectedCameraSource (no silent cameraSource rewrite)",
);
requireNoMatch(
  rendererSource,
  /updateSelectedCameraSource[\s\S]{0,400}setSelectedTrackingBackend/u,
  "updateSelectedCameraSource must not call setSelectedTrackingBackend (no silent backend rewrite when leaving OpenCV)",
);

// ---------------------------------------------------------------------------
// 4. Incompatible state blocks Start (rejected in both start handlers)
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /const\s+startNativePipeline\s*=\s*async[\s\S]*?if\s*\(\s*!desktopApi\s*\|\|\s*pipelineActionPending\s*\|\|\s*isMediaPipeCameraIncompatible\s*\)\s*\{\s*\n\s*return\s*\n\s*\}/u,
  "startNativePipeline must return early when isMediaPipeCameraIncompatible is true",
);
requireMatch(
  rendererSource,
  /const\s+startNativePipelineAndOpenPreview\s*=\s*async[\s\S]*?if\s*\(\s*!desktopApi\s*\|\|\s*pipelineActionPending\s*\|\|\s*isMediaPipeCameraIncompatible\s*\)\s*\{\s*\n\s*return\s*\n\s*\}/u,
  "startNativePipelineAndOpenPreview must return early when isMediaPipeCameraIncompatible is true",
);

// A concise, accessible compatibility explanation renders while the
// incompatible state exists
requireMatch(
  rendererSource,
  /\{isMediaPipeCameraIncompatible\s*\?\s*\(\s*\n\s*<p\s*\n\s*className="runtime-message compact"\s*\n\s*role="alert"/u,
  "an accessible (role=alert) compatibility explanation must render while isMediaPipeCameraIncompatible is true",
);

// ---------------------------------------------------------------------------
// 5. Both start actions pass selectedTrackingBackend through the typed IPC call
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /const\s+startNativePipeline\s*=\s*async[\s\S]*?desktopApi\.startNativePipeline\(\{[\s\S]*?trackingBackend:\s*selectedTrackingBackend[\s\S]*?\}\)/u,
  "startNativePipeline must pass trackingBackend: selectedTrackingBackend to desktopApi.startNativePipeline({...})",
);
requireMatch(
  rendererSource,
  /const\s+startNativePipelineAndOpenPreview\s*=\s*async[\s\S]*?desktopApi\.startNativePipeline\(\{[\s\S]*?trackingBackend:\s*selectedTrackingBackend[\s\S]*?\}\)/u,
  "startNativePipelineAndOpenPreview must pass trackingBackend: selectedTrackingBackend to desktopApi.startNativePipeline({...})",
);

// No new IPC channel was introduced for this Issue
const startNativePipelineIpcOccurrences = (
  rendererSource.match(/desktopApi\.startNativePipeline\(/gu) ?? []
).length;
if (startNativePipelineIpcOccurrences !== 2) {
  fail(
    `renderer must call desktopApi.startNativePipeline(...) exactly twice (start, start-and-open), found ${startNativePipelineIpcOccurrences}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Camera/detector settings are not silently rewritten by backend selection
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /const\s+updateSelectedTrackingBackend\s*=\s*\(trackingBackend:\s*NativePipelineTrackingBackend\):\s*void\s*=>\s*\{\s*\n\s*setSelectedTrackingBackend\(trackingBackend\)\s*\n\s*void\s+saveRuntimeSettings\(\{\s*\.\.\.getSelectedRuntimeSettings\(\),\s*trackingBackend\s*\}\)\s*\n\s*\}/u,
  "updateSelectedTrackingBackend must only set selectedTrackingBackend and save {...getSelectedRuntimeSettings(), trackingBackend} without touching other fields",
);

// ---------------------------------------------------------------------------
// 7. Selector obeys the existing busy/pending disabling, matching camera/detector controls
// ---------------------------------------------------------------------------

requireMatch(
  selectorBlock,
  /disabled=\{isPipelineBusy\s*\|\|\s*isPipelineActionPending\}/u,
  "the tracking-backend selector must set disabled={isPipelineBusy || isPipelineActionPending}, matching camera-source/face-detector controls",
);

// ---------------------------------------------------------------------------
// 8. No MediaPipe Python/model/helper path fields or private environment
//    values enter DesktopRuntimeSettings or renderer state
// ---------------------------------------------------------------------------

const desktopRuntimeSettingsBlockMatch = apiSource.match(
  /export interface DesktopRuntimeSettings \{([\s\S]*?)\n\}/u,
);
if (!desktopRuntimeSettingsBlockMatch) {
  fail("api.ts must declare export interface DesktopRuntimeSettings");
}
const forbiddenFieldPattern =
  /python|model|helper|repo|LVK_MEDIAPIPE|argv|pid|handle|stderr/iu;
requireNoMatch(
  desktopRuntimeSettingsBlockMatch[1],
  forbiddenFieldPattern,
  "DesktopRuntimeSettings must not add Python/model/helper/repository path fields or private environment values",
);
requireNoMatch(
  rendererSource,
  /LVK_MEDIAPIPE_SMOKE_PYTHON|LVK_MEDIAPIPE_MODEL_ASSET_PATH/u,
  "renderer App.tsx must never reference the private MediaPipe environment-variable names",
);
requireNoMatch(
  configSource,
  /LVK_MEDIAPIPE_SMOKE_PYTHON|LVK_MEDIAPIPE_MODEL_ASSET_PATH|python|helperScript|modelAsset/iu,
  "runtimeSettingsConfig.ts must never reference private MediaPipe Python/model/helper configuration",
);

// ---------------------------------------------------------------------------
// 9. The checker is registered exactly once in package.json and the root test chain
// ---------------------------------------------------------------------------

const packageJson = JSON.parse(packageJsonSource);
const scriptKey = "test:electron-mediapipe-development-controls";
if (
  packageJson.scripts?.[scriptKey] !==
  "node tools/check-electron-mediapipe-development-controls.mjs"
) {
  fail(
    `package.json must define "${scriptKey}": "node tools/check-electron-mediapipe-development-controls.mjs"`,
  );
}

const rootTestScript = packageJson.scripts?.test ?? "";
const testChainOccurrences = (
  rootTestScript.match(new RegExp(`pnpm ${scriptKey}(?!\\S)`, "gu")) ?? []
).length;
if (testChainOccurrences !== 1) {
  fail(
    `root "test" script must run "pnpm ${scriptKey}" exactly once, found ${testChainOccurrences}`,
  );
}

console.log(
  "Electron MediaPipe development controls OK: " +
    "the tracking-backend selector declares exactly the face-pipeline and mediapipe-face-landmarker options with the fixed labels; " +
    'the selector is labeled "Tracking backend" and associated with explanatory text via aria-describedby, ' +
    "and that text discloses no environment-variable names or resolved paths; " +
    "isMediaPipeCameraIncompatible requires the mediapipe-face-landmarker backend plus a non-OpenCV camera source; " +
    "the mediapipe-face-landmarker option is disabled while a non-OpenCV camera source is selected; " +
    "backend selection never rewrites cameraSource, and camera-source selection never rewrites trackingBackend; " +
    "both start handlers reject (return early) when isMediaPipeCameraIncompatible is true, and an accessible role=alert compatibility explanation renders; " +
    "both start actions pass trackingBackend: selectedTrackingBackend through the existing typed desktopApi.startNativePipeline call, with no new IPC channel; " +
    "updateSelectedTrackingBackend only touches trackingBackend when saving; " +
    "the selector obeys the existing isPipelineBusy/isPipelineActionPending disabling; " +
    "DesktopRuntimeSettings, the renderer, and runtimeSettingsConfig.ts stay free of Python/model/helper path fields and private environment-variable names; " +
    "the checker is registered exactly once and wired into the root test chain.",
);
