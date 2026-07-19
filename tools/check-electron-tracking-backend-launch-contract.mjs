#!/usr/bin/env node
// Electron tracking-backend launch contract checker (#595).
//
// Protects the source-level contract for the typed Electron tracking-backend
// launch options: the closed backend union, the optional typed start option,
// IPC validation, the face-pipeline default, MediaPipe preflight validation
// order, the fixed Native Core argv, and private-value non-disclosure.
//
// Source-contract only: no Electron, no child_process spawn, no
// transpilation. Dependency-free: Node built-ins only. This does not prove
// real Electron GUI, webcam, MediaPipe, or Native Core execution.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const apiPath = join(repoRoot, "apps", "desktop", "src", "preload", "api.ts");
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
    `Electron tracking-backend launch contract check failed: ${message}`,
  );
  process.exit(1);
};

const apiSource = readFileSync(apiPath, "utf8");
const mainSource = readFileSync(mainIndexPath, "utf8");
const nativePipelineSource = readFileSync(nativePipelinePath, "utf8");
const rendererSource = readFileSync(appRendererPath, "utf8");
const packageJsonSource = readFileSync(packageJsonPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

const requireOrder = (text, beforePattern, afterPattern, message) => {
  const beforeMatch = text.match(beforePattern);
  const afterMatch = text.match(afterPattern);
  if (!beforeMatch || !afterMatch || beforeMatch.index >= afterMatch.index) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// 1. Closed type contains exactly the two approved backend tokens
// ---------------------------------------------------------------------------

const trackingBackendTypeMatch = apiSource.match(
  /export type NativePipelineTrackingBackend =([\s\S]*?)(?:\n\n|\nexport )/u,
);
if (!trackingBackendTypeMatch) {
  fail(
    "api.ts must declare export type NativePipelineTrackingBackend as a string-literal union",
  );
}
const trackingBackendTokens = [
  ...trackingBackendTypeMatch[1].matchAll(/'([^']+)'/gu),
].map((m) => m[1]);
const expectedTrackingBackendTokens = [
  "face-pipeline",
  "mediapipe-face-landmarker",
];
if (
  trackingBackendTokens.length !== expectedTrackingBackendTokens.length ||
  !expectedTrackingBackendTokens.every((token) =>
    trackingBackendTokens.includes(token),
  )
) {
  fail(
    `NativePipelineTrackingBackend must contain exactly ${JSON.stringify(expectedTrackingBackendTokens)}, found ${JSON.stringify(trackingBackendTokens)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. NativePipelineStartOptions has the optional typed trackingBackend field
// ---------------------------------------------------------------------------

const startOptionsBlockMatch = apiSource.match(
  /export interface NativePipelineStartOptions \{([\s\S]*?)\n\}/u,
);
if (!startOptionsBlockMatch) {
  fail("api.ts must declare export interface NativePipelineStartOptions");
}
requireMatch(
  startOptionsBlockMatch ? startOptionsBlockMatch[1] : "",
  /trackingBackend\?:\s*NativePipelineTrackingBackend/u,
  "NativePipelineStartOptions must declare trackingBackend?: NativePipelineTrackingBackend",
);

// ---------------------------------------------------------------------------
// 13. DesktopRuntimeSettings and the renderer carry trackingBackend (#596);
//     LvkRuntimeStatus now exposes the sanitized pipelineTrackingBackend/
//     pipelineRouteReadiness fields approved for #597
// ---------------------------------------------------------------------------

const desktopRuntimeSettingsBlockMatch = apiSource.match(
  /export interface DesktopRuntimeSettings \{([\s\S]*?)\n\}/u,
);
if (!desktopRuntimeSettingsBlockMatch) {
  fail("api.ts must declare export interface DesktopRuntimeSettings");
}
requireMatch(
  desktopRuntimeSettingsBlockMatch[1],
  /trackingBackend:\s*NativePipelineTrackingBackend/u,
  "DesktopRuntimeSettings must declare trackingBackend: NativePipelineTrackingBackend (#596)",
);

const lvkRuntimeStatusBlockMatch = apiSource.match(
  /export interface LvkRuntimeStatus \{([\s\S]*?)\n\}/u,
);
if (!lvkRuntimeStatusBlockMatch) {
  fail("api.ts must declare export interface LvkRuntimeStatus");
}
requireMatch(
  lvkRuntimeStatusBlockMatch[1],
  /pipelineTrackingBackend:\s*NativePipelineTrackingBackend/u,
  "LvkRuntimeStatus must declare pipelineTrackingBackend: NativePipelineTrackingBackend (#597)",
);
requireMatch(
  lvkRuntimeStatusBlockMatch[1],
  /pipelineRouteReadiness:\s*NativePipelineRouteReadiness/u,
  "LvkRuntimeStatus must declare pipelineRouteReadiness: NativePipelineRouteReadiness (#597)",
);

requireMatch(
  rendererSource,
  /selectedTrackingBackend/u,
  "renderer App.tsx must reference selectedTrackingBackend (#596 renderer selector)",
);

// ---------------------------------------------------------------------------
// 3 & 4. IPC parser accepts both approved values, rejects others, defaults
// ---------------------------------------------------------------------------

requireMatch(
  mainSource,
  /trackingBackend\s*!==\s*'face-pipeline'\s*&&\s*trackingBackend\s*!==\s*'mediapipe-face-landmarker'/u,
  "parseNativePipelineStartOptions must reject any trackingBackend other than 'face-pipeline' or 'mediapipe-face-landmarker'",
);

const ipcRejectBlock = mainSource.match(
  /trackingBackend\s*!==\s*'face-pipeline'\s*&&\s*trackingBackend\s*!==\s*'mediapipe-face-landmarker'\s*\)\s*\{\s*\n\s*throw new Error\(/u,
);
if (!ipcRejectBlock) {
  fail(
    "parseNativePipelineStartOptions must throw a fixed Error for an invalid explicit trackingBackend value",
  );
}

requireMatch(
  mainSource,
  /parsedOptions\.trackingBackend\s*=\s*trackingBackend\s+satisfies\s+NativePipelineTrackingBackend/u,
  "parseNativePipelineStartOptions must only assign trackingBackend after validation, typed as NativePipelineTrackingBackend",
);

// Omitted trackingBackend must not be defaulted/coerced at the IPC boundary
// (parsedOptions.trackingBackend stays unset so NativePipelineManager.start()
// applies its own default).
requireMatch(
  mainSource,
  /if\s*\(trackingBackend\s*!==\s*undefined\)\s*\{/u,
  "parseNativePipelineStartOptions must only validate trackingBackend when explicitly supplied (trackingBackend !== undefined)",
);

requireMatch(
  nativePipelineSource,
  /trackingBackend\s*=\s*'face-pipeline'/u,
  "NativePipelineManager.start() must default trackingBackend to 'face-pipeline' when omitted",
);

// ---------------------------------------------------------------------------
// 5. Default face-pipeline argv remains free of MediaPipe flags
// ---------------------------------------------------------------------------

const createTrackerArgsBlockMatch = nativePipelineSource.match(
  /function createTrackerArgs\([\s\S]*?\n\}/u,
);
if (!createTrackerArgsBlockMatch) {
  fail("nativePipeline.ts must define function createTrackerArgs(...)");
}
if (/--tracking-backend|--mediapipe-/u.test(createTrackerArgsBlockMatch[0])) {
  fail(
    "createTrackerArgs() must not unconditionally add --tracking-backend or --mediapipe-* flags; the default face-pipeline argv must stay unchanged",
  );
}

// The MediaPipe argv push must be gated on trackingBackend === 'mediapipe-face-landmarker'
requireMatch(
  nativePipelineSource,
  /trackingBackend\s*===\s*'mediapipe-face-landmarker'\s*&&\s*\n\s*mediapipePythonPath\s*&&\s*\n\s*mediapipeHelperScriptPath\s*&&\s*\n\s*mediapipeModelAssetPath/u,
  "the MediaPipe argv block must be gated on trackingBackend === 'mediapipe-face-landmarker' with all three validated values present",
);

// ---------------------------------------------------------------------------
// 6. MediaPipe requires the OpenCV camera source
// ---------------------------------------------------------------------------

requireMatch(
  nativePipelineSource,
  /trackingBackend\s*===\s*'mediapipe-face-landmarker'\s*\)\s*\{\s*\n\s*if\s*\(cameraSource\s*!==\s*'opencv'\)/u,
  "start() must reject the mediapipe-face-landmarker backend when cameraSource !== 'opencv'",
);

// ---------------------------------------------------------------------------
// 7. Only the two approved private environment-variable keys are used
// ---------------------------------------------------------------------------

const envVarTokens = [
  ...new Set(
    [...nativePipelineSource.matchAll(/LVK_MEDIAPIPE_[A-Z_]+/gu)].map(
      (m) => m[0],
    ),
  ),
];
const expectedEnvVarTokens = [
  "LVK_MEDIAPIPE_SMOKE_PYTHON",
  "LVK_MEDIAPIPE_MODEL_ASSET_PATH",
];
if (
  envVarTokens.length !== expectedEnvVarTokens.length ||
  !expectedEnvVarTokens.every((token) => envVarTokens.includes(token))
) {
  fail(
    `nativePipeline.ts must reference exactly the approved MediaPipe environment-variable keys ${JSON.stringify(expectedEnvVarTokens)}, found ${JSON.stringify(envVarTokens)}`,
  );
}

requireMatch(
  nativePipelineSource,
  /nodeProcess\.env\[MEDIAPIPE_PYTHON_ENV_VAR\]/u,
  "getConfiguredMediapipePythonPath must read nodeProcess.env[MEDIAPIPE_PYTHON_ENV_VAR]",
);
requireMatch(
  nativePipelineSource,
  /nodeProcess\.env\[MEDIAPIPE_MODEL_ASSET_ENV_VAR\]/u,
  "getConfiguredMediapipeModelAssetPath must read nodeProcess.env[MEDIAPIPE_MODEL_ASSET_ENV_VAR]",
);

// ---------------------------------------------------------------------------
// 8. Helper script derived from the fixed repository-owned relative path
// ---------------------------------------------------------------------------

const helperScriptRelativePathMatch = nativePipelineSource.match(
  /const MEDIAPIPE_HELPER_SCRIPT_RELATIVE_PATH = join\(\s*\n([\s\S]*?)\n\)/u,
);
if (!helperScriptRelativePathMatch) {
  fail(
    "nativePipeline.ts must define MEDIAPIPE_HELPER_SCRIPT_RELATIVE_PATH via join(...)",
  );
}
const helperScriptSegments = [
  ...helperScriptRelativePathMatch[1].matchAll(/'([^']+)'/gu),
].map((m) => m[1]);
const expectedHelperScriptSegments = [
  "native",
  "tracker-core",
  "helpers",
  "mediapipe_face_landmarker",
  "face_landmarker_helper_session.py",
];
if (
  helperScriptSegments.length !== expectedHelperScriptSegments.length ||
  !expectedHelperScriptSegments.every(
    (segment, index) => helperScriptSegments[index] === segment,
  )
) {
  fail(
    `MEDIAPIPE_HELPER_SCRIPT_RELATIVE_PATH must join exactly ${JSON.stringify(expectedHelperScriptSegments)}, found ${JSON.stringify(helperScriptSegments)}`,
  );
}

requireMatch(
  nativePipelineSource,
  /function resolveMediapipeHelperScriptPath\(repoRoot: string\): string \{\s*\n\s*return join\(repoRoot, MEDIAPIPE_HELPER_SCRIPT_RELATIVE_PATH\)/u,
  "resolveMediapipeHelperScriptPath must derive the helper path from repoRoot and the fixed relative path constant",
);

// No IPC/renderer/settings-provided helper-script path is ever accepted
if (/helperScriptPath\??:\s*/u.test(startOptionsBlockMatch[1])) {
  fail(
    "NativePipelineStartOptions must not accept a helper-script path from IPC/renderer",
  );
}

// ---------------------------------------------------------------------------
// 9. Python/model/helper validation occurs before bridge start and tracker spawn
// ---------------------------------------------------------------------------

requireOrder(
  nativePipelineSource,
  /isExistingFile\(mediapipePythonPath\)/u,
  /startMotionBridgeServer\(/u,
  "MediaPipe Python validation must occur before startMotionBridgeServer(...) is called",
);
requireOrder(
  nativePipelineSource,
  /isExistingFile\(mediapipeModelAssetPath\)/u,
  /startMotionBridgeServer\(/u,
  "MediaPipe model asset validation must occur before startMotionBridgeServer(...) is called",
);
requireOrder(
  nativePipelineSource,
  /isExistingFile\(mediapipeHelperScriptPath\)/u,
  /startMotionBridgeServer\(/u,
  "MediaPipe helper script validation must occur before startMotionBridgeServer(...) is called",
);
requireOrder(
  nativePipelineSource,
  /isExistingFile\(mediapipeHelperScriptPath\)/u,
  /this\.trackerProcess\s*=\s*spawn\(/u,
  "MediaPipe helper script validation must occur before the tracker process is spawned",
);

// ---------------------------------------------------------------------------
// 10. Every required MediaPipe CLI flag is added exactly once
// ---------------------------------------------------------------------------

const mediapipeArgvPushMatch = nativePipelineSource.match(
  /trackerArgs\.push\(\s*\n\s*'--tracking-backend',\s*\n\s*'mediapipe-face-landmarker',\s*\n\s*'--mediapipe-python',\s*\n\s*mediapipePythonPath,\s*\n\s*'--mediapipe-helper-script',\s*\n\s*mediapipeHelperScriptPath,\s*\n\s*'--mediapipe-model-asset',\s*\n\s*mediapipeModelAssetPath\s*\n\s*\)/u,
);
if (!mediapipeArgvPushMatch) {
  fail(
    "start() must push exactly one --tracking-backend mediapipe-face-landmarker, --mediapipe-python <value>, --mediapipe-helper-script <value>, --mediapipe-model-asset <value> sequence onto trackerArgs",
  );
}
const requiredFlags = [
  "--tracking-backend",
  "--mediapipe-python",
  "--mediapipe-helper-script",
  "--mediapipe-model-asset",
];
for (const flag of requiredFlags) {
  const occurrences = (
    nativePipelineSource.match(
      new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"),
    ) ?? []
  ).length;
  if (occurrences !== 1) {
    fail(
      `${flag} must appear exactly once in nativePipeline.ts (as a literal in the MediaPipe argv push), found ${occurrences}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 11. Tracker still uses argument-array spawn with shell:false
// ---------------------------------------------------------------------------

requireMatch(
  nativePipelineSource,
  /this\.trackerProcess\s*=\s*spawn\(\s*trackerExecutablePath,\s*trackerArgs,\s*\{[\s\S]{0,200}?shell:\s*false/u,
  "the tracker process must still be spawned as spawn(trackerExecutablePath, trackerArgs, { ..., shell: false, ... })",
);

// ---------------------------------------------------------------------------
// 12. Fixed error messages do not interpolate private values or paths
// ---------------------------------------------------------------------------

const fixedErrorConstantNames = [
  "MEDIAPIPE_INCOMPATIBLE_CAMERA_SOURCE_ERROR",
  "MEDIAPIPE_PYTHON_CONFIG_ERROR",
  "MEDIAPIPE_MODEL_CONFIG_ERROR",
  "MEDIAPIPE_HELPER_SCRIPT_ERROR",
];
for (const constantName of fixedErrorConstantNames) {
  const usagePattern = new RegExp(`lastError:\\s*${constantName}\\b`, "u");
  if (!usagePattern.test(nativePipelineSource)) {
    fail(
      `preflight error status must set lastError: ${constantName} (a fixed constant, not an interpolated string)`,
    );
  }
}

const privateValueVariables = [
  "mediapipePythonPath",
  "mediapipeModelAssetPath",
  "mediapipeHelperScriptPath",
  "repoRoot",
];
for (const constantName of fixedErrorConstantNames) {
  const constantDeclMatch = nativePipelineSource.match(
    new RegExp(`const ${constantName} =[\\s\\S]*?\\n(?=const |function )`, "u"),
  );
  if (constantDeclMatch) {
    for (const variableName of privateValueVariables) {
      if (constantDeclMatch[0].includes(`\${${variableName}}`)) {
        fail(
          `${constantName} must not interpolate ${variableName} (private value/path leak)`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 14. The new checker is registered exactly once in the root test chain
// ---------------------------------------------------------------------------

const packageJson = JSON.parse(packageJsonSource);
const scriptKey = "test:electron-tracking-backend-launch-contract";
if (
  packageJson.scripts?.[scriptKey] !==
  "node tools/check-electron-tracking-backend-launch-contract.mjs"
) {
  fail(
    `package.json must define "${scriptKey}": "node tools/check-electron-tracking-backend-launch-contract.mjs"`,
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
  "Electron tracking-backend launch contract OK: " +
    "NativePipelineTrackingBackend is a closed union of exactly face-pipeline and mediapipe-face-landmarker; " +
    "NativePipelineStartOptions declares the optional typed trackingBackend field with no helper-script path input; " +
    "DesktopRuntimeSettings and the renderer carry the persisted trackingBackend token (#596); LvkRuntimeStatus declares the sanitized pipelineTrackingBackend/pipelineRouteReadiness fields (#597); " +
    "the IPC parser rejects any explicit value other than the two approved tokens and only assigns after validation; " +
    "NativePipelineManager.start() defaults trackingBackend to face-pipeline; " +
    "createTrackerArgs() never unconditionally adds MediaPipe flags, keeping the default face-pipeline argv unchanged; " +
    "the MediaPipe route requires cameraSource opencv; " +
    "only the two approved LVK_MEDIAPIPE_* environment-variable keys are referenced; " +
    "the helper script path is derived from the fixed repository-relative path via repoRoot; " +
    "Python/model/helper validation occurs before startMotionBridgeServer and tracker spawn; " +
    "every required MediaPipe CLI flag is pushed exactly once; " +
    "the tracker is still spawned as an argument array with shell:false; " +
    "the four MediaPipe preflight errors use fixed constants with no private-value interpolation; " +
    "the new checker is registered exactly once and wired into the root test chain.",
);
