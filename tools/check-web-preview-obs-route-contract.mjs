#!/usr/bin/env node
// Focused Web Preview OBS route contract checker.
//
// This is a source/behavior contract checker, not a real OBS Browser Source,
// Electron GUI, webcam, or native runtime validation. It protects the current
// intended OBS route contract without changing any production behavior:
//
//   - mode / source / debug query helpers stay independent
//   - mode=obs produces transparent document/root/shell/canvas output
//   - the OBS preview panel fills the viewport
//   - standard source-status and renderer calibration controls are excluded
//   - debug=motion remains an explicit, independent opt-in
//   - persisted renderer calibration still flows into AvatarScene
//   - dummy and native source selection stay independent
//
// It uses only Node built-ins plus the existing @lvk/web-preview TypeScript dev
// dependency (to transpile the standalone helpers). It adds no new dependency.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB_PREVIEW_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
  import.meta.url,
);
const PREVIEW_MODE_SOURCE_URL = new URL(
  "../apps/web-preview/src/preview/previewMode.ts",
  import.meta.url,
);
const PREVIEW_SOURCE_SOURCE_URL = new URL(
  "../apps/web-preview/src/preview/previewSource.ts",
  import.meta.url,
);
const PREVIEW_DEBUG_SOURCE_URL = new URL(
  "../apps/web-preview/src/preview/previewDebug.ts",
  import.meta.url,
);
const APP_SOURCE_URL = new URL(
  "../apps/web-preview/src/App.tsx",
  import.meta.url,
);
const AVATAR_PREVIEW_SOURCE_URL = new URL(
  "../apps/web-preview/src/components/AvatarPreview.tsx",
  import.meta.url,
);
const APP_CSS_SOURCE_URL = new URL(
  "../apps/web-preview/src/App.css",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(`Web Preview OBS route contract check failed: ${message}`);
};

const assert = (condition, message) => {
  if (!condition) {
    fail(message);
  }
};

// Transpile a standalone, dependency-free TypeScript helper to a temporary ESM
// module and import it. The three preview route helpers have no runtime imports,
// so no import rewriting is required.
const loadHelper = async (sourceUrl, fileName) => {
  const source = await readFile(sourceUrl, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-obs-route-contract-"));
  const tempModulePath = join(tempDir, fileName.replace(/\.ts$/, ".mjs"));
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

// Locate a bounded JSX slice for the !isObsMode standard-controls block instead
// of relying on one extremely broad regular expression.
const sliceBetween = (source, startNeedle, endNeedle) => {
  const startIndex = source.indexOf(startNeedle);
  assert(startIndex !== -1, `expected to find source marker: ${startNeedle}`);
  const endIndex = source.indexOf(endNeedle, startIndex);
  assert(
    endIndex !== -1 && endIndex > startIndex,
    `expected to find source marker after "${startNeedle}": ${endNeedle}`,
  );
  return { startIndex, endIndex, slice: source.slice(startIndex, endIndex) };
};

const runCheck = async () => {
  // --- 1. Route helper independence ----------------------------------------
  const { getPreviewModeFromSearch } = await loadHelper(
    PREVIEW_MODE_SOURCE_URL,
    "previewMode.ts",
  );
  const { getPreviewSourceFromSearch } = await loadHelper(
    PREVIEW_SOURCE_SOURCE_URL,
    "previewSource.ts",
  );
  const { getPreviewDebugModeFromSearch } = await loadHelper(
    PREVIEW_DEBUG_SOURCE_URL,
    "previewDebug.ts",
  );

  assert(
    typeof getPreviewModeFromSearch === "function",
    "previewMode helper must export getPreviewModeFromSearch",
  );
  assert(
    typeof getPreviewSourceFromSearch === "function",
    "previewSource helper must export getPreviewSourceFromSearch",
  );
  assert(
    typeof getPreviewDebugModeFromSearch === "function",
    "previewDebug helper must export getPreviewDebugModeFromSearch",
  );

  // Each case asserts that mode, source, and debug are decoded independently
  // from the same query string, regardless of ordering or unknown values.
  const routeMatrix = [
    { search: "", mode: "default", source: "dummy", debug: null },
    {
      search: "?mode=obs&source=dummy",
      mode: "obs",
      source: "dummy",
      debug: null,
    },
    {
      search: "?mode=obs&source=native",
      mode: "obs",
      source: "native",
      debug: null,
    },
    {
      search: "?mode=obs&source=native&debug=motion",
      mode: "obs",
      source: "native",
      debug: "motion",
    },
    {
      // Query ordering must not couple the helpers.
      search: "?debug=motion&source=dummy&mode=obs",
      mode: "obs",
      source: "dummy",
      debug: "motion",
    },
    {
      search: "?source=native",
      mode: "default",
      source: "native",
      debug: null,
    },
    {
      // Unknown values fall back to the safe defaults for every helper.
      search: "?mode=studio&source=remote&debug=all",
      mode: "default",
      source: "dummy",
      debug: null,
    },
    {
      // A valid debug value stays recognized even when mode/source are invalid.
      search: "?mode=unknown&source=unknown&debug=motion",
      mode: "default",
      source: "dummy",
      debug: "motion",
    },
  ];

  for (const testCase of routeMatrix) {
    const actualMode = getPreviewModeFromSearch(testCase.search);
    const actualSource = getPreviewSourceFromSearch(testCase.search);
    const actualDebug = getPreviewDebugModeFromSearch(testCase.search);
    const label = testCase.search === "" ? "(empty search)" : testCase.search;
    assert(
      actualMode === testCase.mode,
      `route "${label}": expected mode ${testCase.mode}, received ${actualMode}`,
    );
    assert(
      actualSource === testCase.source,
      `route "${label}": expected source ${testCase.source}, received ${actualSource}`,
    );
    assert(
      actualDebug === testCase.debug,
      `route "${label}": expected debug ${String(testCase.debug)}, received ${String(actualDebug)}`,
    );
  }

  // The standard OBS route has no debug overlay; only the explicit route enables
  // it. This confirms mode=obs never implies debug=motion.
  assert(
    getPreviewDebugModeFromSearch("?mode=obs&source=dummy") === null,
    "standard OBS route must not enable the motion debug overlay",
  );
  assert(
    getPreviewDebugModeFromSearch("?mode=obs&source=dummy&debug=motion") ===
      "motion",
    "explicit OBS diagnostic route must enable the motion debug overlay",
  );

  // Both OBS source routes remain valid and independent.
  assert(
    getPreviewModeFromSearch("?mode=obs&source=dummy") === "obs" &&
      getPreviewSourceFromSearch("?mode=obs&source=dummy") === "dummy",
    "?mode=obs&source=dummy must select OBS + dummy",
  );
  assert(
    getPreviewModeFromSearch("?mode=obs&source=native") === "obs" &&
      getPreviewSourceFromSearch("?mode=obs&source=native") === "native",
    "?mode=obs&source=native must select OBS + native",
  );

  // --- 2. App route wiring --------------------------------------------------
  const appSource = await readFile(APP_SOURCE_URL, "utf8");

  for (const helperCall of [
    "getPreviewModeFromSearch(window.location.search)",
    "getPreviewSourceFromSearch(window.location.search)",
    "getPreviewDebugModeFromSearch(",
  ]) {
    assert(
      appSource.includes(helperCall),
      `App must read the route from window.location.search via ${helperCall}`,
    );
  }
  // getPreviewDebugModeFromSearch wraps across lines in the current source.
  assert(
    /getPreviewDebugModeFromSearch\(\s*window\.location\.search,?\s*\)/.test(
      appSource,
    ),
    "App must pass window.location.search to getPreviewDebugModeFromSearch",
  );

  for (const propWiring of [
    "mode={previewMode}",
    "source={previewSource}",
    "debugMode={previewDebugMode}",
  ]) {
    assert(
      appSource.includes(propWiring),
      `App must forward the route value to AvatarPreview via ${propWiring}`,
    );
  }

  assert(
    appSource.includes(
      "document.documentElement.dataset.previewMode = previewMode",
    ),
    "App must assign document.documentElement.dataset.previewMode from previewMode",
  );
  assert(
    /delete document\.documentElement\.dataset\.previewMode/.test(appSource),
    "App must remove the previewMode dataset during effect cleanup",
  );

  // --- 3. AvatarPreview OBS control exclusion + debug opt-in -----------------
  const avatarSource = await readFile(AVATAR_PREVIEW_SOURCE_URL, "utf8");

  assert(
    avatarSource.includes('const isObsMode = mode === "obs";'),
    'AvatarPreview must derive isObsMode from mode === "obs"',
  );

  // Bound the standard-controls block: from the !isObsMode gate up to the
  // separate debug overlay render. The gated area must contain the source-status
  // and calibration panels; the debug overlay must live outside it.
  const obsGate = sliceBetween(
    avatarSource,
    "{!isObsMode && (",
    '{debugMode === "motion" && (',
  );
  for (const gatedControl of [
    "preview-source-badge",
    "preview-source-panel",
    "preview-calibration-panel",
  ]) {
    assert(
      obsGate.slice.includes(gatedControl),
      `standard control "${gatedControl}" must be gated behind !isObsMode`,
    );
  }
  assert(
    !obsGate.slice.includes("<MotionDebugOverlay"),
    "the motion debug overlay must not render inside the !isObsMode block",
  );
  assert(
    !obsGate.slice.includes("<AvatarScene"),
    "AvatarScene must not render inside the !isObsMode block",
  );

  // The debug overlay is a separate diagnostic component, rendered only under
  // debugMode === "motion", after (outside) the standard-controls block. Bound
  // its render to the explicit debug gate so the source-prop assertion below
  // cannot accidentally match a different component (e.g. AvatarScene).
  const debugGate = sliceBetween(
    avatarSource,
    '{debugMode === "motion" && (',
    "<section className={panelClassName}",
  );
  assert(
    debugGate.slice.includes("<MotionDebugOverlay"),
    'MotionDebugOverlay must render under the debugMode === "motion" gate',
  );
  assert(
    !debugGate.slice.includes("<AvatarScene"),
    "AvatarScene must not render inside the explicit debug overlay gate",
  );
  // Prove the debug overlay itself is source-aware: the source prop must appear
  // on the MotionDebugOverlay invocation, not merely somewhere after the gate.
  assert(
    /<MotionDebugOverlay[\s\S]*?source=\{source\}[\s\S]*?\/>/.test(
      debugGate.slice,
    ),
    "MotionDebugOverlay must receive source={source} inside the explicit debug gate",
  );
  assert(
    avatarSource.includes("function MotionDebugOverlay("),
    "MotionDebugOverlay must exist as a separate diagnostic component",
  );

  // The bounded !isObsMode JSX gate above is the contract: standard controls are
  // not rendered in OBS mode rather than being conditionally styled inside the
  // rendered OBS tree. (An earlier assertion scanned the TSX source for a
  // `display: none` declaration, which proved nothing about CSS; it is removed.)

  // --- 4. Transparent OBS rendering path ------------------------------------
  assert(
    avatarSource.includes("gl={{ alpha: isObsMode }}"),
    "Canvas must enable alpha for OBS mode via gl={{ alpha: isObsMode }}",
  );

  const appCss = await readFile(APP_CSS_SOURCE_URL, "utf8");
  const normalizedCss = appCss.replace(/\s+/g, " ");

  // Grouped transparent rule for the OBS document/body/root.
  assert(
    /:root\[data-preview-mode="obs"\], :root\[data-preview-mode="obs"\] body, :root\[data-preview-mode="obs"\] #root \{ background: transparent; \}/.test(
      normalizedCss,
    ),
    "OBS document/body/#root must set background: transparent",
  );
  assert(
    /\.preview-shell--obs \{ background: transparent; \}/.test(normalizedCss),
    ".preview-shell--obs must set background: transparent",
  );
  assert(
    /\.preview-panel--obs canvas \{ background: transparent; \}/.test(
      normalizedCss,
    ),
    ".preview-panel--obs canvas must set background: transparent",
  );

  // A small helper to assert a declaration exists inside a specific rule block.
  const assertDeclarationInRule = (selector, declaration) => {
    const escapedSelector = selector.replace(/[.#[\]"*+?^${}()|\\]/g, "\\$&");
    const rulePattern = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m");
    const match = appCss.match(rulePattern);
    assert(match !== null, `expected CSS rule for selector: ${selector}`);
    const normalizedDeclaration = declaration.replace(/\s+/g, " ").trim();
    const normalizedBody = match[1].replace(/\s+/g, " ");
    assert(
      normalizedBody.includes(normalizedDeclaration),
      `CSS rule "${selector}" must declare "${declaration}"`,
    );
  };

  // --- 5. Full-viewport OBS sizing ------------------------------------------
  assertDeclarationInRule("#root", "width: 100vw");
  assertDeclarationInRule("#root", "height: 100svh");
  assertDeclarationInRule("#root", "min-height: 100svh");
  assertDeclarationInRule(".preview-shell", "width: 100vw");
  assertDeclarationInRule(".preview-shell", "height: 100svh");
  assertDeclarationInRule(".preview-panel--obs", "width: 100vw");
  assertDeclarationInRule(".preview-panel--obs", "height: 100svh");

  // --- 6. Mode-specific class wiring links route to the CSS OBS contract -----
  assert(
    avatarSource.includes(
      "const shellClassName = `preview-shell preview-shell--${mode}`;",
    ),
    "AvatarPreview must construct the mode-specific shell class",
  );
  assert(
    avatarSource.includes(
      "const panelClassName = `preview-panel preview-panel--${mode}`;",
    ),
    "AvatarPreview must construct the mode-specific panel class",
  );
  assert(
    /<main className=\{shellClassName\}>/.test(avatarSource),
    "the main element must use the shell class",
  );
  assert(
    /<section className=\{panelClassName\}/.test(avatarSource),
    "the avatar section must use the panel class",
  );

  // --- 7. Renderer calibration still applied in OBS mode --------------------
  assert(
    avatarSource.includes(
      "useState<RendererCalibrationState>(loadRendererCalibrationState)",
    ),
    "rendererCalibrationState must initialize with loadRendererCalibrationState",
  );
  assert(
    avatarSource.includes(
      "const selectedPreset = getFaceFollowingPresetById(",
    ) && avatarSource.includes("rendererCalibrationState.presetId,"),
    "selectedPreset must be derived from rendererCalibrationState.presetId",
  );
  assert(
    avatarSource.includes("resolveRendererFaceFollowingCalibration("),
    "effectiveCalibration must be produced via resolveRendererFaceFollowingCalibration",
  );

  // Bound the AvatarScene invocation (up to its self-closing terminator) and tie
  // each required prop to that exact component. This proves the rendered avatar —
  // not some other element — receives the calibration data path and the
  // independent source. sliceBetween excludes the end marker, so the slice still
  // holds every prop before the `/>` terminator.
  const avatarSceneBlock = sliceBetween(avatarSource, "<AvatarScene", "/>");
  for (const expectedProp of [
    "key={calibrationRevision}",
    "calibration={effectiveCalibration}",
    "localAvatarScene={localGlbAvatar.asset?.scene ?? null}",
    "nativeFrame={nativeFrame}",
    "smoothing={selectedPreset.smoothing}",
    "source={source}",
  ]) {
    assert(
      avatarSceneBlock.slice.includes(expectedProp),
      `AvatarScene invocation must include ${expectedProp}`,
    );
  }

  // AvatarScene must render outside the !isObsMode control block so calibration
  // continues to affect avatar output even when the controls are hidden. This
  // positional check protects a different requirement than the bounded block
  // above: the rendered avatar stays available in OBS mode.
  assert(
    avatarSceneBlock.startIndex > obsGate.endIndex,
    "AvatarScene must render outside the !isObsMode control block",
  );
  const avatarSceneComponent = sliceBetween(
    avatarSource,
    "function AvatarScene(",
    "export function AvatarPreview",
  ).slice;
  assert(
    avatarSceneComponent.includes("localAvatarScene === null ?") &&
      avatarSceneComponent.includes("<DummyAvatar") &&
      avatarSceneComponent.includes("<LoadedGlbAvatar"),
    "AvatarScene must keep the primitive fallback renderable before/without a valid durable GLB",
  );
  assert(
    avatarSceneComponent.includes("computeLostTrackingFallbackMotion({") &&
      avatarSceneComponent.includes('mappedMotion.trackingStatus === "lost"'),
    "AvatarScene must keep the tracking-lost fallback path active for OBS and standard rendering",
  );

  // --- 8. Source independence in the renderer -------------------------------
  // source drives native input selection; the independent source prop on the
  // MotionDebugOverlay and AvatarScene invocations is asserted in their bounded
  // component blocks above.
  assert(
    avatarSource.includes('useNativeMotionFrame(source === "native")'),
    'source must drive useNativeMotionFrame(source === "native")',
  );

  // --- 9. Local avatar workspace access mode --------------------------------
  // OBS uses restore-only access (hydrate the durable GLB + framing, no writes);
  // the standard Preview uses interactive read/write access. Both share the same
  // controller, so OBS restoration is never disabled.
  assert(
    avatarSource.includes(
      'accessMode: isObsMode ? "restore-only" : "interactive"',
    ),
    "AvatarPreview must select restore-only workspace access in OBS and interactive access in the standard Preview",
  );
  assert(
    !avatarSource.includes("workspaceEnabled"),
    "OBS workspace restoration must not be disabled through a workspaceEnabled flag",
  );

  // The local avatar controls stay gated behind !isObsMode, so the file input,
  // status/storage/framing text, framing ranges, reset, and clear never render
  // in the OBS tree even though the durable workspace still restores.
  for (const gatedControl of [
    "preview-local-avatar-panel",
    'type="file"',
    "handleResetLocalAvatarFraming",
    "handleClearLocalAvatar",
    "localAvatarFramingStatusText",
  ]) {
    assert(
      obsGate.slice.includes(gatedControl),
      `local avatar control "${gatedControl}" must be gated behind !isObsMode`,
    );
  }

  // AvatarScene receives controller-owned framing (not independent React state),
  // so OBS renders the same restored framing as the standard Preview.
  for (const framingDerivation of [
    "const localAvatarScale = localGlbAvatar.framing.uniformScale;",
    "const localAvatarVerticalOffset = localGlbAvatar.framing.verticalOffset;",
    "const localAvatarYawDegrees = localGlbAvatar.framing.yawDegrees;",
  ]) {
    assert(
      avatarSource.includes(framingDerivation),
      `AvatarScene framing must come from the workspace controller: missing ${framingDerivation}`,
    );
  }
  for (const framingProp of [
    "localAvatarScale={localAvatarScale}",
    "localAvatarVerticalOffset={localAvatarVerticalOffset}",
    "localAvatarYawDegrees={localAvatarYawDegrees}",
  ]) {
    assert(
      avatarSceneBlock.slice.includes(framingProp),
      `AvatarScene invocation must pass controller-owned framing: ${framingProp}`,
    );
  }

  // No live cross-window synchronization primitive may be introduced.
  assert(
    !avatarSource.includes("BroadcastChannel") &&
      !avatarSource.includes('addEventListener("storage"') &&
      !avatarSource.includes("postMessage("),
    "OBS restoration must not add any live cross-window synchronization primitive",
  );

  console.log(
    [
      "Web Preview OBS route contract check passed.",
      "  - mode/source/debug route helpers remain independent (order-insensitive, unknown-safe)",
      "  - OBS document/body/#root, shell, and canvas transparency contracts are present",
      "  - OBS preview panel is full viewport (100vw x 100svh)",
      "  - standard source-status and calibration controls are excluded from OBS output",
      "  - debug=motion remains an explicit, independent opt-in overlay",
      "  - persisted renderer calibration still flows into AvatarScene",
      "  - both dummy and native source routes remain supported and independent",
      "  - OBS uses restore-only workspace access (no writes) and the standard Preview uses interactive access; controller-owned framing flows into AvatarScene",
      "  - no live cross-window synchronization primitive is introduced",
      "  NOTE: source/behavior checker evidence only; NOT real OBS Browser Source validation.",
    ].join("\n"),
  );
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
