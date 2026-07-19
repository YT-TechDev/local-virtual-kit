#!/usr/bin/env node
// Electron MediaPipe development route status checker (#597).
//
// Protects the source-level contract for the sanitized
// pipelineTrackingBackend/pipelineRouteReadiness fields on LvkRuntimeStatus:
// the closed readiness union, that every MediaPipe preflight rejection
// branch assigns the correct fixed readiness category, that a fully
// validated MediaPipe route resolves to 'ready', that the face-pipeline
// route always reports 'not-applicable', that the renderer uses only fixed
// label maps (never raw field values or parsed error/stderr/output text) in
// the runtime summary/details and copied diagnostics, and that no private
// path, environment-variable, argv, stderr, or identity-derived value can
// enter these fields or their renderer labels.
//
// Source-contract only: no Electron, no child_process spawn, no
// transpilation. Dependency-free: Node built-ins only. This does not prove
// real Electron GUI, webcam, MediaPipe, or Native Core execution.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const apiPath = join(repoRoot, "apps", "desktop", "src", "preload", "api.ts");
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
    `Electron MediaPipe development route status check failed: ${message}`,
  );
  process.exit(1);
};

const apiSource = readFileSync(apiPath, "utf8");
const nativePipelineSource = readFileSync(nativePipelinePath, "utf8");
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
// 1. NativePipelineRouteReadiness is a closed union of exactly the seven
//    approved tokens
// ---------------------------------------------------------------------------

const readinessTypeMatch = apiSource.match(
  /export type NativePipelineRouteReadiness =([\s\S]*?)(?:\n\n|\nexport )/u,
);
if (!readinessTypeMatch) {
  fail(
    "api.ts must declare export type NativePipelineRouteReadiness as a string-literal union",
  );
}
const readinessTokens = [...readinessTypeMatch[1].matchAll(/'([^']+)'/gu)].map(
  (m) => m[1],
);
const expectedReadinessTokens = [
  "not-applicable",
  "unchecked",
  "ready",
  "incompatible-camera-source",
  "python-unavailable",
  "model-unavailable",
  "helper-unavailable",
];
if (
  readinessTokens.length !== expectedReadinessTokens.length ||
  !expectedReadinessTokens.every((token) => readinessTokens.includes(token))
) {
  fail(
    `NativePipelineRouteReadiness must contain exactly ${JSON.stringify(expectedReadinessTokens)}, found ${JSON.stringify(readinessTokens)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. LvkRuntimeStatus declares both fields as required (not optional,
//    not free-form, not path-bearing)
// ---------------------------------------------------------------------------

const lvkRuntimeStatusBlockMatch = apiSource.match(
  /export interface LvkRuntimeStatus \{([\s\S]*?)\n\}/u,
);
if (!lvkRuntimeStatusBlockMatch) {
  fail("api.ts must declare export interface LvkRuntimeStatus");
}
requireMatch(
  lvkRuntimeStatusBlockMatch[1],
  /pipelineTrackingBackend:\s*NativePipelineTrackingBackend/u,
  "LvkRuntimeStatus must declare a required pipelineTrackingBackend: NativePipelineTrackingBackend field",
);
requireMatch(
  lvkRuntimeStatusBlockMatch[1],
  /pipelineRouteReadiness:\s*NativePipelineRouteReadiness/u,
  "LvkRuntimeStatus must declare a required pipelineRouteReadiness: NativePipelineRouteReadiness field",
);
requireNoMatch(
  lvkRuntimeStatusBlockMatch[1],
  /pipelineTrackingBackend\?:/u,
  "LvkRuntimeStatus.pipelineTrackingBackend must be required, not optional",
);
requireNoMatch(
  lvkRuntimeStatusBlockMatch[1],
  /pipelineRouteReadiness\?:/u,
  "LvkRuntimeStatus.pipelineRouteReadiness must be required, not optional",
);

// ---------------------------------------------------------------------------
// 3. Default/initial status is face-pipeline / not-applicable
// ---------------------------------------------------------------------------

requireMatch(
  nativePipelineSource,
  /function createInitialStatus\(\): LvkRuntimeStatus \{[\s\S]*?pipelineTrackingBackend:\s*'face-pipeline',\s*\n\s*pipelineRouteReadiness:\s*'not-applicable'/u,
  "createInitialStatus() must set pipelineTrackingBackend: 'face-pipeline' and pipelineRouteReadiness: 'not-applicable'",
);

// ---------------------------------------------------------------------------
// 4. Every MediaPipe preflight rejection branch assigns the correct fixed
//    readiness category alongside its existing unchanged lastError constant
// ---------------------------------------------------------------------------

const rejectionBranches = [
  {
    readiness: "incompatible-camera-source",
    errorConstant: "MEDIAPIPE_INCOMPATIBLE_CAMERA_SOURCE_ERROR",
  },
  {
    readiness: "python-unavailable",
    errorConstant: "MEDIAPIPE_PYTHON_CONFIG_ERROR",
  },
  {
    readiness: "model-unavailable",
    errorConstant: "MEDIAPIPE_MODEL_CONFIG_ERROR",
  },
  {
    readiness: "helper-unavailable",
    errorConstant: "MEDIAPIPE_HELPER_SCRIPT_ERROR",
  },
];

for (const { readiness, errorConstant } of rejectionBranches) {
  const pattern = new RegExp(
    `pipelineTrackingBackend:\\s*'mediapipe-face-landmarker',\\s*\\n\\s*pipelineRouteReadiness:\\s*'${readiness}'[\\s\\S]{0,300}?lastError:\\s*${errorConstant}\\b`,
    "u",
  );
  if (!pattern.test(nativePipelineSource)) {
    fail(
      `the ${errorConstant} preflight rejection branch must set pipelineTrackingBackend: 'mediapipe-face-landmarker' and pipelineRouteReadiness: '${readiness}' alongside its unchanged lastError constant`,
    );
  }
}

// Exactly one status assignment per rejection branch (no accidental reuse)
for (const { readiness } of rejectionBranches) {
  const occurrences = (
    nativePipelineSource.match(
      new RegExp(`pipelineRouteReadiness:\\s*'${readiness}'`, "gu"),
    ) ?? []
  ).length;
  if (occurrences !== 1) {
    fail(
      `pipelineRouteReadiness: '${readiness}' must be assigned exactly once in nativePipeline.ts, found ${occurrences}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. A fully validated MediaPipe route resolves to 'ready'; the
//    face-pipeline route always resolves to 'not-applicable'; readiness is
//    never computed inline with a private path/env value, only via the two
//    fixed helper functions or a fixed string literal
// ---------------------------------------------------------------------------

requireMatch(
  nativePipelineSource,
  /function getReadyOrNotApplicableReadiness\(\s*\n\s*trackingBackend:\s*NativePipelineTrackingBackend\s*\n\)\s*:\s*NativePipelineRouteReadiness\s*\{\s*\n\s*return trackingBackend === 'mediapipe-face-landmarker' \? 'ready' : 'not-applicable'/u,
  "getReadyOrNotApplicableReadiness must return 'ready' for mediapipe-face-landmarker and 'not-applicable' otherwise",
);
requireMatch(
  nativePipelineSource,
  /function getUncheckedOrNotApplicableReadiness\(\s*\n\s*trackingBackend:\s*NativePipelineTrackingBackend\s*\n\)\s*:\s*NativePipelineRouteReadiness\s*\{\s*\n\s*return trackingBackend === 'mediapipe-face-landmarker' \? 'unchecked' : 'not-applicable'/u,
  "getUncheckedOrNotApplicableReadiness must return 'unchecked' for mediapipe-face-landmarker and 'not-applicable' otherwise",
);

// getReadyOrNotApplicableReadiness must be the readiness assigned once every
// MediaPipe preflight check has passed (post-preflight executable-missing
// branch, and the successful "starting" status transition)
const readyReadinessCallSites = (
  nativePipelineSource.match(
    /pipelineRouteReadiness:\s*getReadyOrNotApplicableReadiness\(trackingBackend\)/gu,
  ) ?? []
).length;
if (readyReadinessCallSites !== 2) {
  fail(
    `pipelineRouteReadiness: getReadyOrNotApplicableReadiness(trackingBackend) must appear exactly twice (post-preflight executable check, successful starting transition), found ${readyReadinessCallSites}`,
  );
}

const uncheckedReadinessCallSites = (
  nativePipelineSource.match(
    /pipelineRouteReadiness:\s*getUncheckedOrNotApplicableReadiness\(trackingBackend\)/gu,
  ) ?? []
).length;
if (uncheckedReadinessCallSites !== 1) {
  fail(
    `pipelineRouteReadiness: getUncheckedOrNotApplicableReadiness(trackingBackend) must appear exactly once (the unrelated cascade-path rejection branch reached before any MediaPipe-specific validation), found ${uncheckedReadinessCallSites}`,
  );
}

// pipelineRouteReadiness/pipelineTrackingBackend must never be assigned via
// a template literal (the only way a private path/env value could leak in)
requireNoMatch(
  nativePipelineSource,
  /pipelineRouteReadiness:\s*`/u,
  "pipelineRouteReadiness must never be assigned via a template literal",
);
requireNoMatch(
  nativePipelineSource,
  /pipelineTrackingBackend:\s*`/u,
  "pipelineTrackingBackend must never be assigned via a template literal",
);

// ---------------------------------------------------------------------------
// 6. Private path/argv/env/stderr/frame/landmark values never enter the new
//    fields or nearby renderer label maps. Enforced as an allow-list: every
//    assignment must be one of the fixed literals, the requested-backend
//    variable, or the two closed-return-type helper-function calls.
// ---------------------------------------------------------------------------

const allowedTrackingBackendAssignments = new Set([
  "'face-pipeline'",
  "'mediapipe-face-landmarker'",
  "trackingBackend",
]);
const trackingBackendAssignments = [
  ...nativePipelineSource.matchAll(/pipelineTrackingBackend:\s*([^,\n]+)/gu),
];
if (trackingBackendAssignments.length === 0) {
  fail("nativePipeline.ts must assign pipelineTrackingBackend at least once");
}
for (const [, value] of trackingBackendAssignments) {
  if (!allowedTrackingBackendAssignments.has(value.trim())) {
    fail(
      `pipelineTrackingBackend assignment "${value.trim()}" must be one of ${JSON.stringify([...allowedTrackingBackendAssignments])}`,
    );
  }
}

const allowedRouteReadinessAssignments = new Set([
  ...expectedReadinessTokens.map((token) => `'${token}'`),
  "getUncheckedOrNotApplicableReadiness(trackingBackend)",
  "getReadyOrNotApplicableReadiness(trackingBackend)",
]);
const routeReadinessAssignments = [
  ...nativePipelineSource.matchAll(/pipelineRouteReadiness:\s*([^,\n]+)/gu),
];
if (routeReadinessAssignments.length === 0) {
  fail("nativePipeline.ts must assign pipelineRouteReadiness at least once");
}
for (const [, value] of routeReadinessAssignments) {
  if (!allowedRouteReadinessAssignments.has(value.trim())) {
    fail(
      `pipelineRouteReadiness assignment "${value.trim()}" must be one of ${JSON.stringify([...allowedRouteReadinessAssignments])}`,
    );
  }
}

requireNoMatch(
  rendererSource,
  /LVK_MEDIAPIPE_SMOKE_PYTHON|LVK_MEDIAPIPE_MODEL_ASSET_PATH/u,
  "renderer App.tsx must never reference the private MediaPipe environment-variable names",
);
requireNoMatch(
  rendererSource,
  /pipelineTrackingBackendStatusLabels\s*=[\s\S]{0,400}?(argv|stderr|landmark|blendshape|confidence|matrix)/iu,
  "pipelineTrackingBackendStatusLabels must not reference argv/stderr/landmark/blendshape/confidence/matrix data",
);
requireNoMatch(
  rendererSource,
  /pipelineRouteReadinessLabels\s*=[\s\S]{0,600}?(argv|stderr|landmark|blendshape|confidence|matrix)/iu,
  "pipelineRouteReadinessLabels must not reference argv/stderr/landmark/blendshape/confidence/matrix data",
);

// ---------------------------------------------------------------------------
// 7. Renderer declares fixed label maps for both fields with the exact
//    recommended labels, and never derives the category from lastError/
//    warning/stderr/process-output text
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /const pipelineTrackingBackendStatusLabels: Record<NativePipelineTrackingBackend, string> = \{\s*\n\s*'face-pipeline':\s*'Default face pipeline',\s*\n\s*'mediapipe-face-landmarker':\s*'MediaPipe Face Landmarker'\s*\n\s*\}/u,
  "renderer must declare pipelineTrackingBackendStatusLabels mapping face-pipeline to 'Default face pipeline' and mediapipe-face-landmarker to 'MediaPipe Face Landmarker'",
);

const expectedReadinessLabels = {
  "not-applicable": "Not applicable",
  unchecked: "Not checked",
  ready: "Configured",
  "incompatible-camera-source": "OpenCV camera required",
  "python-unavailable": "Local Python configuration unavailable",
  "model-unavailable": "Local model configuration unavailable",
  "helper-unavailable": "Repository helper unavailable",
};

const readinessLabelsBlockMatch = rendererSource.match(
  /const pipelineRouteReadinessLabels: Record<NativePipelineRouteReadiness, string> = \{([\s\S]*?)\n\}/u,
);
if (!readinessLabelsBlockMatch) {
  fail(
    "renderer must declare const pipelineRouteReadinessLabels: Record<NativePipelineRouteReadiness, string>",
  );
}
for (const [token, label] of Object.entries(expectedReadinessLabels)) {
  const entryPattern = new RegExp(
    `(?:'${token}'|${token}):\\s*'${label}'`,
    "u",
  );
  if (!entryPattern.test(readinessLabelsBlockMatch[1])) {
    fail(`pipelineRouteReadinessLabels must map ${token} to '${label}'`);
  }
}

requireNoMatch(
  rendererSource,
  /pipelineTrackingBackendStatusLabels\[[^\]]*\.lastError/u,
  "renderer must not derive the backend label by parsing lastError",
);
requireNoMatch(
  rendererSource,
  /pipelineRouteReadinessLabels\[[^\]]*\.lastError/u,
  "renderer must not derive the readiness label by parsing lastError",
);

// ---------------------------------------------------------------------------
// 8. Runtime summary/details and copied diagnostics use the typed fixed
//    fields via the fixed label maps
// ---------------------------------------------------------------------------

requireMatch(
  rendererSource,
  /pipelineTrackingBackendStatusLabels\[runtimeStatus\.pipelineTrackingBackend\]/u,
  "the runtime summary/details UI must render pipelineTrackingBackendStatusLabels[runtimeStatus.pipelineTrackingBackend]",
);
requireMatch(
  rendererSource,
  /pipelineRouteReadinessLabels\[runtimeStatus\.pipelineRouteReadiness\]/u,
  "the detailed status UI must render pipelineRouteReadinessLabels[runtimeStatus.pipelineRouteReadiness]",
);

const diagnosticsBuilderMatch = rendererSource.match(
  /const buildNativeRuntimeDiagnostics = \([\s\S]*?\n\): string =>\s*\n\s*\[([\s\S]*?)\]\s*\n\s*\.filter/u,
);
if (!diagnosticsBuilderMatch) {
  fail(
    "renderer must define buildNativeRuntimeDiagnostics(...) building an array of lines",
  );
}
requireMatch(
  diagnosticsBuilderMatch[1],
  /Tracking backend:\s*\$\{pipelineTrackingBackendStatusLabels\[status\.pipelineTrackingBackend\]\}/u,
  "buildNativeRuntimeDiagnostics() must include a fixed 'Tracking backend: ...' line using pipelineTrackingBackendStatusLabels[status.pipelineTrackingBackend]",
);
requireMatch(
  diagnosticsBuilderMatch[1],
  /MediaPipe route readiness:\s*\$\{pipelineRouteReadinessLabels\[status\.pipelineRouteReadiness\]\}/u,
  "buildNativeRuntimeDiagnostics() must include a fixed 'MediaPipe route readiness: ...' line using pipelineRouteReadinessLabels[status.pipelineRouteReadiness]",
);

// ---------------------------------------------------------------------------
// 9. No new IPC channel was introduced for this Issue
// ---------------------------------------------------------------------------

const ipcChannelsBlockMatch = apiSource.match(
  /export const LVK_IPC_CHANNELS = \{([\s\S]*?)\n\} as const/u,
);
if (!ipcChannelsBlockMatch) {
  fail("api.ts must declare export const LVK_IPC_CHANNELS");
}
const ipcChannelKeys = [
  ...ipcChannelsBlockMatch[1].matchAll(/^\s*([A-Za-z]+):/gmu),
].map((m) => m[1]);
const expectedIpcChannelKeys = [
  "getRuntimeStatus",
  "getRuntimeSettings",
  "saveRuntimeSettings",
  "startNativePipeline",
  "stopNativePipeline",
  "openExternalUrl",
  "getNativeRuntimeCapabilities",
];
if (
  ipcChannelKeys.length !== expectedIpcChannelKeys.length ||
  !expectedIpcChannelKeys.every((key) => ipcChannelKeys.includes(key))
) {
  fail(
    `LVK_IPC_CHANNELS must stay exactly ${JSON.stringify(expectedIpcChannelKeys)} (no new channel for #597), found ${JSON.stringify(ipcChannelKeys)}`,
  );
}

// ---------------------------------------------------------------------------
// 10. The checker is registered exactly once in package.json and the root
//     test chain
// ---------------------------------------------------------------------------

const packageJson = JSON.parse(packageJsonSource);
const scriptKey = "test:electron-mediapipe-development-route-status";
if (
  packageJson.scripts?.[scriptKey] !==
  "node tools/check-electron-mediapipe-development-route-status.mjs"
) {
  fail(
    `package.json must define "${scriptKey}": "node tools/check-electron-mediapipe-development-route-status.mjs"`,
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
  "Electron MediaPipe development route status OK: " +
    "NativePipelineRouteReadiness is a closed union of exactly the seven approved tokens; " +
    "LvkRuntimeStatus declares pipelineTrackingBackend and pipelineRouteReadiness as required (non-optional) fixed-category fields; " +
    "createInitialStatus() and every face-pipeline start attempt resolve to face-pipeline/not-applicable; " +
    "every MediaPipe preflight rejection branch (incompatible camera, Python, model, helper) sets the correct fixed readiness category alongside its unchanged lastError constant; " +
    "a fully validated MediaPipe route resolves to 'ready', including when a later unrelated executable failure occurs; " +
    "readiness/backend are only ever assigned via fixed string literals or the two closed-return-type helper functions, never a template literal; " +
    "no private Python/model/helper/executable path, repoRoot, environment-variable name, argv, stderr, landmark, blendshape, confidence, or matrix value can enter these fields or their renderer labels; " +
    "the renderer declares fixed pipelineTrackingBackendStatusLabels/pipelineRouteReadinessLabels maps with the exact recommended labels and never derives them from lastError; " +
    "the runtime summary/details UI and buildNativeRuntimeDiagnostics() render the typed fields through those fixed label maps; " +
    "LVK_IPC_CHANNELS stays exactly the existing seven keys (no new IPC channel); " +
    "the checker is registered exactly once and wired into the root test chain.",
);
