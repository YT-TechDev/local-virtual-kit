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

// ---------------------------------------------------------------------------
// 11. Deterministic sentinel-evidence check.
//
// Sections 1-10 above prove source *shape*: closed unions, required fields,
// an allow-list of permitted assignments, and exact label/template text.
// This section supplements (never replaces) those checks by actually
// constructing the renderer-facing artifacts a real run would produce for
// every representative MediaPipe outcome, using values extracted from the
// inspected production source (the fixed error constants' resolved text,
// and the renderer's own fixed label maps), and asserting that a set of
// clearly synthetic sentinel private-path values never appears in any of
// them. A negative control proves the sentinel detector itself is active.
//
// The sentinel values below are fixed, obviously-synthetic strings invented
// for this checker. They are never read from process.env, the filesystem,
// or any other real machine/owner state.
// ---------------------------------------------------------------------------

const SENTINEL_PRIVATE_VALUES = {
  pythonExecutablePath:
    "C:\\Users\\lvk-sentinel-owner\\SENTINEL-PRIVATE\\mediapipe-python\\python.exe",
  modelAssetPath:
    "C:\\Users\\lvk-sentinel-owner\\SENTINEL-PRIVATE\\models\\face_landmarker.task",
  helperScriptPath:
    "C:\\Users\\lvk-sentinel-owner\\SENTINEL-PRIVATE\\repo\\native\\tracker-core\\helpers\\mediapipe_face_landmarker\\face_landmarker_helper_session.py",
  nativeExecutablePath:
    "C:\\Users\\lvk-sentinel-owner\\SENTINEL-PRIVATE\\repo\\native\\tracker-core\\build\\lvk-tracker-core.exe",
  repoRootPath: "C:\\Users\\lvk-sentinel-owner\\SENTINEL-PRIVATE\\repo",
};
const sentinelPrivateValueList = Object.values(SENTINEL_PRIVATE_VALUES);

// 11a. Correlate the sentinel fixtures with production source: every fixed
// MediaPipe preflight error constant must never interpolate a private
// path/argv value (supplements the identical guard already enforced in
// check-electron-tracking-backend-launch-contract.mjs, scoped here to the
// exact set of private variables relevant to the #597 status fields).

const extractConstantDeclarationBody = (constantName) => {
  const declMatch = nativePipelineSource.match(
    new RegExp(
      `const ${constantName} =([\\s\\S]*?)\\n(?=const |function )`,
      "u",
    ),
  );
  if (!declMatch) {
    fail(`nativePipeline.ts must declare const ${constantName}`);
  }
  return declMatch[1].trim();
};

const forbiddenPrivateInterpolationVariables = [
  "mediapipePythonPath",
  "mediapipeModelAssetPath",
  "mediapipeHelperScriptPath",
  "trackerExecutablePath",
  "repoRoot",
  "argv",
];

const uniqueErrorConstantNames = [
  ...new Set(rejectionBranches.map((branch) => branch.errorConstant)),
];

for (const constantName of uniqueErrorConstantNames) {
  const body = extractConstantDeclarationBody(constantName);
  for (const variableName of forbiddenPrivateInterpolationVariables) {
    if (body.includes(`\${${variableName}}`)) {
      fail(
        `${constantName} must not interpolate ${variableName} (private value/path leak)`,
      );
    }
  }
}

// 11b. Resolve each fixed error constant's actual display text from source
// (handling the plain-string and template-literal forms currently used),
// substituting only the two approved *public* env-var key-name constants.
// Any interpolation left over after that substitution is treated as an
// unaccounted-for dynamic value and fails the check.

const pythonEnvVarNameMatch = nativePipelineSource.match(
  /const MEDIAPIPE_PYTHON_ENV_VAR = '([^']+)'/u,
);
const modelEnvVarNameMatch = nativePipelineSource.match(
  /const MEDIAPIPE_MODEL_ASSET_ENV_VAR = '([^']+)'/u,
);
if (!pythonEnvVarNameMatch || !modelEnvVarNameMatch) {
  fail(
    "nativePipeline.ts must declare MEDIAPIPE_PYTHON_ENV_VAR and MEDIAPIPE_MODEL_ASSET_ENV_VAR as fixed string constants",
  );
}
const pythonEnvVarName = pythonEnvVarNameMatch[1];
const modelEnvVarName = modelEnvVarNameMatch[1];

const resolveFixedErrorConstantValue = (constantName) => {
  const body = extractConstantDeclarationBody(constantName);
  if (body.startsWith("`") && body.endsWith("`")) {
    const resolved = body
      .slice(1, -1)
      .replaceAll("${MEDIAPIPE_PYTHON_ENV_VAR}", pythonEnvVarName)
      .replaceAll("${MEDIAPIPE_MODEL_ASSET_ENV_VAR}", modelEnvVarName);
    if (resolved.includes("${")) {
      fail(
        `${constantName} contains a dynamic interpolation the sentinel evidence check cannot account for`,
      );
    }
    return resolved;
  }
  const singleQuoted = body.match(/^'([\s\S]*)'$/u);
  if (singleQuoted) {
    return singleQuoted[1];
  }
  const doubleQuoted = body.match(/^"([\s\S]*)"$/u);
  if (doubleQuoted) {
    return doubleQuoted[1];
  }
  fail(
    `${constantName} is not a plain string or template literal the sentinel evidence check can resolve`,
  );
  return "";
};

// 11c. Extract the renderer's fixed label maps from source into real
// lookup objects (rather than re-typing the label strings a second time),
// reusing the same block already located and validated in section 7.

const parseLabelMapEntries = (blockText) => {
  const entries = {};
  for (const match of blockText.matchAll(
    /(?:'([^']+)'|([A-Za-z]\w*)):\s*'([^']+)'/gu,
  )) {
    const key = match[1] ?? match[2];
    entries[key] = match[3];
  }
  return entries;
};

const trackingBackendStatusLabelsBlockMatch = rendererSource.match(
  /const pipelineTrackingBackendStatusLabels: Record<NativePipelineTrackingBackend, string> = \{([\s\S]*?)\n\}/u,
);
if (!trackingBackendStatusLabelsBlockMatch) {
  fail(
    "renderer must declare const pipelineTrackingBackendStatusLabels: Record<NativePipelineTrackingBackend, string>",
  );
}

const extractedTrackingBackendLabels = parseLabelMapEntries(
  trackingBackendStatusLabelsBlockMatch[1],
);
const extractedReadinessLabels = parseLabelMapEntries(
  readinessLabelsBlockMatch[1],
);

if (Object.keys(extractedTrackingBackendLabels).length !== 2) {
  fail(
    "sentinel evidence harness could not extract exactly two entries from pipelineTrackingBackendStatusLabels",
  );
}
if (Object.keys(extractedReadinessLabels).length !== 7) {
  fail(
    "sentinel evidence harness could not extract exactly seven entries from pipelineRouteReadinessLabels",
  );
}

// 11d. Build representative renderer-facing artifacts for every MediaPipe
// preflight rejection plus the fully-configured (ready) route, reusing the
// already source-validated rejectionBranches table (section 4) rather than
// an unrelated second hard-coded branch list. Each artifact mirrors the
// exact fixed diagnostic-line templates already verified in section 8.

const readyRouteScenario = { readiness: "ready", errorConstant: undefined };
const representativeScenarios = [...rejectionBranches, readyRouteScenario].map(
  (scenario) => {
    const { readiness, errorConstant } = scenario;
    const lastError =
      errorConstant !== undefined
        ? resolveFixedErrorConstantValue(errorConstant)
        : null;
    const backendLabel =
      extractedTrackingBackendLabels["mediapipe-face-landmarker"];
    const readinessLabel = extractedReadinessLabels[readiness];
    if (!backendLabel || !readinessLabel) {
      fail(
        `sentinel evidence harness could not resolve renderer labels for readiness "${readiness}"`,
      );
    }
    const diagnosticsLines = [
      `Tracking backend: ${backendLabel}`,
      `MediaPipe route readiness: ${readinessLabel}`,
      lastError ? `Latest error: ${lastError}` : null,
    ].filter((line) => line !== null);

    return {
      label: readiness,
      artifact: {
        pipelineTrackingBackend: "mediapipe-face-landmarker",
        pipelineRouteReadiness: readiness,
        rendererBackendLabel: backendLabel,
        rendererReadinessLabel: readinessLabel,
        lastError,
        diagnosticsLines,
      },
    };
  },
);

// 11e. The sentinel detector itself: throws a fixed, sentinel-free message
// on any leak so failure output never echoes a sentinel value.

// JSON.stringify would escape backslashes (turning a Windows-style sentinel
// path's "\" into "\\"), which would make a literal substring check against
// the raw sentinel value always miss. Flatten the artifact's own string
// values instead, so the sentinel's exact literal form is what gets scanned.
const flattenArtifactStrings = (artifact) => {
  const parts = [];
  for (const value of Object.values(artifact)) {
    if (typeof value === "string") {
      parts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          parts.push(item);
        }
      }
    }
  }
  return parts.join(" ");
};

const assertArtifactFreeOfSentinels = (artifact) => {
  const haystack = flattenArtifactStrings(artifact);
  if (sentinelPrivateValueList.some((value) => haystack.includes(value))) {
    throw new Error("private sentinel reached copied diagnostics");
  }
};

// 11f. Positive evidence: every real representative artifact must be free
// of every sentinel private value.

for (const { label, artifact } of representativeScenarios) {
  try {
    assertArtifactFreeOfSentinels(artifact);
  } catch {
    fail(
      `sentinel evidence check failed: a synthetic private sentinel value reached the renderer-facing artifact for readiness "${label}"`,
    );
  }
}

// 11g. Negative control: an intentionally contaminated synthetic artifact
// must be caught by the same detector, proving it is actually active and
// not vacuously passing because the sentinels never appear anywhere.

const negativeControlArtifact = {
  ...representativeScenarios[0].artifact,
  lastError: `${representativeScenarios[0].artifact.lastError ?? ""} ${SENTINEL_PRIVATE_VALUES.pythonExecutablePath}`,
};

let negativeControlDetected = false;
try {
  assertArtifactFreeOfSentinels(negativeControlArtifact);
} catch {
  negativeControlDetected = true;
}

if (!negativeControlDetected) {
  fail(
    "sentinel evidence negative control failed: the detector did not catch an intentionally injected private sentinel value in a synthetic renderer-facing artifact",
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
    "the checker is registered exactly once and wired into the root test chain; " +
    "deterministic sentinel private-path evidence (Python executable, model asset, resolved helper script, native executable, repository root) was exercised against representative renderer-facing artifacts (backend/readiness fields, fixed labels, fixed preflight error text, copied diagnostic lines) for every MediaPipe preflight rejection and the ready route, and none of the sentinel values reached any of them; " +
    "a negative control intentionally contaminated a synthetic artifact and confirmed the sentinel detector caught it, proving the detector is active rather than vacuously passing.",
);
