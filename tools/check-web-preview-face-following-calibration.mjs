#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB_PREVIEW_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
  import.meta.url,
);
const CALIBRATION_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/faceFollowingCalibration.ts",
  import.meta.url,
);
const PRESETS_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/faceFollowingPresets.ts",
  import.meta.url,
);
const AVATAR_PREVIEW_SOURCE_URL = new URL(
  "../apps/web-preview/src/components/AvatarPreview.tsx",
  import.meta.url,
);
const STORAGE_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/rendererCalibrationStorage.ts",
  import.meta.url,
);
const NEUTRAL_POSE_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/rendererNeutralPose.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview face-following calibration check failed: ${message}`,
  );
};

const assertClose = (actual, expected, label, tolerance = 1e-9) => {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
    fail(`${label}: expected ~${expected}, received ${actual}`);
  }
};

const assertTupleClose = (actual, expected, label, tolerance = 1e-9) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    fail(`${label}: expected tuple ${JSON.stringify(expected)}`);
  }
  expected.forEach((value, index) => {
    assertClose(actual[index], value, `${label}[${index}]`, tolerance);
  });
};

const loadModule = async (
  sourceUrl,
  fileName,
  rewriteSource = (source) => source,
) => {
  const source = rewriteSource(await readFile(sourceUrl, "utf8"));

  // Strip the `@lvk/motion-protocol` type-only import; it carries no runtime
  // value and is not resolvable from a standalone transpiled module.
  const runtimeSource = source.replace(
    /^import type \{[^}]*\} from "@lvk\/motion-protocol";\s*$/m,
    "",
  );

  const output = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-face-calibration-"));
  const tempModulePath = join(tempDir, fileName.replace(/\.ts$/, ".mjs"));
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const createMemoryStorage = (initialValue = null) => {
  let storedValue = initialValue;

  return {
    getItemCalls: 0,
    setItemCalls: 0,
    setValue(value) {
      storedValue = value;
    },
    getWrittenValue() {
      return storedValue;
    },
    getItem(key) {
      this.getItemCalls += 1;
      if (key !== "lvk.webPreview.rendererCalibration") {
        fail(`unexpected storage read key: ${key}`);
      }
      return storedValue;
    },
    setItem(key, value) {
      this.setItemCalls += 1;
      if (key !== "lvk.webPreview.rendererCalibration") {
        fail(`unexpected storage write key: ${key}`);
      }
      storedValue = value;
    },
  };
};

const runCheck = async () => {
  const {
    DEFAULT_FACE_FOLLOWING_CALIBRATION,
    FACE_FOLLOWING_MAX_DEADZONE,
    FACE_FOLLOWING_MAX_SENSITIVITY,
    applyFaceFollowingCalibration,
    clampFaceFollowingCalibration,
    createDefaultFaceFollowingCalibration,
    createFaceFollowingCalibrationFromCenter,
  } = await loadModule(CALIBRATION_SOURCE_URL, "faceFollowingCalibration.ts");

  // Default calibration reproduces the previous hard-coded mapping exactly.
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 0.5, y: -0.5, z: 1 }),
    [0.5 * 3.2, -0.5 * 2.4, 1 * 0.9],
    "default calibration scales by the original per-axis sensitivity",
  );

  // Out-of-range position is clamped into the input domain before scaling.
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 2, y: -2, z: 0.75 }),
    [3.2, -2.4, 0.675],
    "default calibration clamps out-of-range face.position before scaling",
  );

  // Center offset recenters the mapping: a position equal to the center maps to
  // the origin regardless of sensitivity.
  const centered = createFaceFollowingCalibrationFromCenter({
    x: 0.4,
    y: -0.3,
    z: 0.2,
  });
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 0.4, y: -0.3, z: 0.2 }, centered),
    [0, 0, 0],
    "capturing a resting position maps that position to the avatar origin",
  );
  assertClose(
    centered.center.x,
    0.4,
    "createFaceFollowingCalibrationFromCenter stores the captured center",
  );
  assertClose(
    centered.sensitivity.x,
    DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity.x,
    "createFaceFollowingCalibrationFromCenter keeps the base sensitivity",
  );

  // Centered movement above the resting point scales by sensitivity, still
  // clamped into the input domain.
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 0.9, y: -0.3, z: 0.2 }, centered),
    [(0.9 - 0.4) * 3.2, 0, 0],
    "centered movement scales the offset from the resting position",
  );

  // Sensitivity and deadzone are clamped to safe bounds; wild values cannot fling the avatar.
  const clampedHigh = clampFaceFollowingCalibration({
    center: { x: 0, y: 0, z: 0 },
    sensitivity: { x: 1000, y: -5, z: 2 },
    deadzone: { x: 99, y: -1, z: 0.2 },
  });
  assertClose(
    clampedHigh.sensitivity.x,
    FACE_FOLLOWING_MAX_SENSITIVITY,
    "sensitivity is clamped to the maximum",
  );
  assertClose(
    clampedHigh.sensitivity.y,
    0,
    "negative sensitivity is clamped to zero",
  );
  assertClose(
    clampedHigh.deadzone.x,
    FACE_FOLLOWING_MAX_DEADZONE,
    "deadzone is clamped to the maximum",
  );
  assertClose(
    clampedHigh.deadzone.y,
    0,
    "negative deadzone is clamped to zero",
  );

  assertTupleClose(
    applyFaceFollowingCalibration(
      { x: 0.04, y: -0.06, z: 0.2 },
      {
        center: { x: 0, y: 0, z: 0 },
        sensitivity: { x: 3, y: 2, z: 1 },
        deadzone: { x: 0.05, y: 0.05, z: 0.05 },
      },
    ),
    [0, -0.02, 0.15000000000000002],
    "deadzone suppresses tiny centered movement before scaling",
  );

  // Non-finite / missing values fall back to defaults instead of producing NaN.
  const clampedBad = clampFaceFollowingCalibration({
    center: { x: Number.NaN, y: 5, z: 0 },
    sensitivity: { x: Number.POSITIVE_INFINITY, y: 2.4, z: 0.9 },
    deadzone: { x: Number.NaN, y: 0, z: 0 },
  });
  assertClose(
    clampedBad.center.x,
    0,
    "non-finite center falls back to the default center",
  );
  assertClose(clampedBad.center.y, 1, "out-of-range center is clamped");
  assertClose(
    clampedBad.sensitivity.x,
    DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity.x,
    "non-finite sensitivity falls back to the default sensitivity",
  );

  // Reset-to-default returns a fresh, independent copy of the baseline.
  const reset = createDefaultFaceFollowingCalibration();
  reset.sensitivity.x = 99;
  reset.center.y = 1;
  reset.deadzone.z = 1;
  assertClose(
    DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity.x,
    3.2,
    "createDefaultFaceFollowingCalibration does not mutate the shared default",
  );
  assertClose(
    DEFAULT_FACE_FOLLOWING_CALIBRATION.center.y,
    0,
    "createDefaultFaceFollowingCalibration center is independent of the default",
  );
  assertClose(
    DEFAULT_FACE_FOLLOWING_CALIBRATION.deadzone.z,
    0,
    "createDefaultFaceFollowingCalibration deadzone is independent of the default",
  );

  const {
    RENDERER_CALIBRATION_STORAGE_KEY,
    loadRendererCalibrationState,
    loadRendererCalibrationPresetId,
    saveRendererCalibrationState,
    saveRendererCalibrationPresetId,
  } = await loadModule(
    STORAGE_SOURCE_URL,
    "rendererCalibrationStorage.ts",
    (source) =>
      source
        .replace(
          new RegExp(
            String.raw`import \{[\s\S]*?\} from "\.\/faceFollowingCalibration";\s*`,
            "m",
          ),
          `const FACE_FOLLOWING_MIN_CENTER = -1;
const FACE_FOLLOWING_MAX_CENTER = 1;
`,
        )
        .replace(
          new RegExp(
            String.raw`import \{[\s\S]*?\} from "\.\/faceFollowingPresets";\s*`,
            "m",
          ),
          `const DEFAULT_FACE_FOLLOWING_PRESET_ID = "balanced";
const FACE_FOLLOWING_PRESETS = [{ id: "balanced" }, { id: "steady" }, { id: "responsive" }];
`,
        ),
  );

  if (
    RENDERER_CALIBRATION_STORAGE_KEY !== "lvk.webPreview.rendererCalibration"
  ) {
    fail("renderer calibration storage key changed unexpectedly");
  }

  if (
    loadRendererCalibrationPresetId(createMemoryStorage(null)) !== "balanced"
  ) {
    fail("missing persisted calibration must fall back to balanced");
  }
  if (
    loadRendererCalibrationPresetId(
      createMemoryStorage(
        JSON.stringify({ version: 1, presetId: "responsive" }),
      ),
    ) !== "responsive"
  ) {
    fail("valid persisted calibration must restore its preset ID");
  }
  if (
    loadRendererCalibrationPresetId(createMemoryStorage("not json")) !==
    "balanced"
  ) {
    fail("invalid persisted JSON must fall back to balanced");
  }
  const restoredV1 = loadRendererCalibrationState(
    createMemoryStorage(JSON.stringify({ version: 1, presetId: "responsive" })),
  );
  if (
    restoredV1.presetId !== "responsive" ||
    restoredV1.neutralCenter !== null
  ) {
    fail("valid version 1 data must restore its preset with no custom center");
  }
  const restoredV2 = loadRendererCalibrationState(
    createMemoryStorage(
      JSON.stringify({
        version: 2,
        presetId: "steady",
        neutralCenter: { x: 0.2, y: -0.1, z: 0.3 },
      }),
    ),
  );
  if (
    restoredV2.presetId !== "steady" ||
    restoredV2.neutralCenter?.x !== 0.2 ||
    restoredV2.neutralCenter?.y !== -0.1 ||
    restoredV2.neutralCenter?.z !== 0.3
  ) {
    fail("valid version 2 data must restore preset and neutral center");
  }
  if (
    loadRendererCalibrationPresetId(
      createMemoryStorage(JSON.stringify({ version: 99, presetId: "steady" })),
    ) !== "balanced"
  ) {
    fail(
      "unsupported persisted calibration version must fall back to balanced",
    );
  }
  if (
    loadRendererCalibrationPresetId(
      createMemoryStorage(JSON.stringify({ version: 1, presetId: "turbo" })),
    ) !== "balanced"
  ) {
    fail("unknown persisted calibration preset ID must fall back to balanced");
  }
  if (
    loadRendererCalibrationPresetId({
      getItem() {
        throw new Error("storage read denied");
      },
      setItem() {},
    }) !== "balanced"
  ) {
    fail("storage read exceptions must fall back to balanced");
  }

  const writeStorage = createMemoryStorage(null);
  saveRendererCalibrationPresetId("steady", writeStorage);
  if (
    writeStorage.getWrittenValue() !==
    JSON.stringify({ version: 2, presetId: "steady", neutralCenter: null })
  ) {
    fail("saving a valid calibration preset must write the versioned shape");
  }
  const writeCenterStorage = createMemoryStorage(null);
  saveRendererCalibrationState(
    { presetId: "responsive", neutralCenter: { x: 0.1, y: 0.2, z: -0.3 } },
    writeCenterStorage,
  );
  if (
    writeCenterStorage.getWrittenValue() !==
    JSON.stringify({
      version: 2,
      presetId: "responsive",
      neutralCenter: { x: 0.1, y: 0.2, z: -0.3 },
    })
  ) {
    fail("saving calibration state must write preset and neutral center");
  }
  saveRendererCalibrationPresetId("responsive", {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("storage write denied");
    },
  });

  for (const badCenter of [
    7,
    { x: 0, y: 0 },
    { x: Number.NaN, y: 0, z: 0 },
    { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
    { x: "0", y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ]) {
    const restored = loadRendererCalibrationState(
      createMemoryStorage(
        JSON.stringify({
          version: 2,
          presetId: "steady",
          neutralCenter: badCenter,
        }),
      ),
    );
    if (restored.presetId !== "steady" || restored.neutralCenter !== null) {
      fail(
        "invalid neutral-center data must be dropped while preserving valid preset",
      );
    }
  }

  const {
    canCaptureNativeNeutralPose,
    resolveRendererFaceFollowingCalibration,
  } = await loadModule(
    NEUTRAL_POSE_SOURCE_URL,
    "rendererNeutralPose.ts",
    (source) =>
      source
        .replace(
          /^import type \{ MotionFrame \} from "@lvk\/motion-protocol";\s*$/m,
          "",
        )
        .replace(
          /^import type \{ NativeMotionConnectionStatus \} from "\.\/nativeMotionFrameLifecycle";\s*$/m,
          "",
        )
        .replace(
          /import \{[\s\S]*?\} from "\.\/faceFollowingCalibration";\s*/m,
          `const createFaceFollowingCalibrationFromCenter = (restingPosition, baseCalibration) => ({
            center: { x: restingPosition.x, y: restingPosition.y, z: restingPosition.z },
            sensitivity: baseCalibration.sensitivity,
            deadzone: baseCalibration.deadzone,
          });
`,
        )
        .replace(
          /^import type \{ FaceFollowingPreset \} from "\.\/faceFollowingPresets";\s*$/m,
          "",
        )
        .replace(
          /^import type \{ RendererCalibrationState \} from "\.\/rendererCalibrationStorage";\s*$/m,
          "",
        )
        .replace(
          /^import type \{ PreviewSource \} from "\.\.\/preview\/previewSource";\s*$/m,
          "",
        ),
  );

  const trackingFrame = {
    face: { position: { x: 0.25, y: -0.2, z: 0.1 } },
    tracking: { status: "tracking" },
  };
  if (
    !canCaptureNativeNeutralPose({
      source: "native",
      nativeStatus: "connected",
      nativeFrame: trackingFrame,
    })
  ) {
    fail("valid native tracking frame must be eligible for neutral capture");
  }
  for (const blocked of [
    { source: "dummy", nativeStatus: "disabled", nativeFrame: trackingFrame },
    {
      source: "native",
      nativeStatus: "connected_waiting_for_frame",
      nativeFrame: null,
    },
    {
      source: "native",
      nativeStatus: "reconnecting",
      nativeFrame: trackingFrame,
    },
    { source: "native", nativeStatus: "fallback", nativeFrame: trackingFrame },
    {
      source: "native",
      nativeStatus: "connected",
      nativeFrame: { ...trackingFrame, tracking: { status: "lost" } },
    },
    { source: "native", nativeStatus: "connected", nativeFrame: null },
  ]) {
    if (canCaptureNativeNeutralPose(blocked)) {
      fail(
        `blocked capture state was incorrectly eligible: ${JSON.stringify(blocked)}`,
      );
    }
  }

  const responsivePreset = {
    calibration: {
      center: { x: 0, y: 0, z: 0 },
      sensitivity: { x: 3.776, y: 2.832, z: 1.062 },
      deadzone: { x: 0.015, y: 0.015, z: 0.0075 },
    },
    smoothing: { positionTauSeconds: 0.08, rotationTauSeconds: 0.08 },
  };
  const captured = createFaceFollowingCalibrationFromCenter(
    trackingFrame.face.position,
    responsivePreset.calibration,
  );
  assertTupleClose(
    applyFaceFollowingCalibration(trackingFrame.face.position, captured),
    [0, 0, 0],
    "capturing a position with active preset maps that position to origin",
  );
  assertClose(
    captured.sensitivity.x,
    responsivePreset.calibration.sensitivity.x,
    "capture preserves active preset sensitivity",
  );
  assertClose(
    captured.deadzone.x,
    responsivePreset.calibration.deadzone.x,
    "capture preserves active preset deadzone",
  );
  if (responsivePreset.smoothing.positionTauSeconds !== 0.08) {
    fail("capture must not mutate active preset smoothing");
  }
  const resetCalibration = resolveRendererFaceFollowingCalibration(
    responsivePreset,
    {
      presetId: "responsive",
      neutralCenter: null,
    },
  );
  assertClose(
    resetCalibration.center.x,
    0,
    "reset restores active preset default center",
  );
  const switchedCalibration = resolveRendererFaceFollowingCalibration(
    responsivePreset,
    {
      presetId: "responsive",
      neutralCenter: captured.center,
    },
  );
  assertClose(
    switchedCalibration.center.x,
    captured.center.x,
    "preset change preserves captured neutral center",
  );
  assertClose(
    switchedCalibration.sensitivity.x,
    responsivePreset.calibration.sensitivity.x,
    "preset change applies new preset sensitivity",
  );

  const presetsSource = await readFile(PRESETS_SOURCE_URL, "utf8");
  const avatarPreviewSource = await readFile(AVATAR_PREVIEW_SOURCE_URL, "utf8");
  for (const label of ["Balanced", "Steady", "Responsive"]) {
    if (!presetsSource.includes(`label: "${label}"`)) {
      fail(`missing calibration preset label: ${label}`);
    }
  }
  if (!avatarPreviewSource.includes("Renderer-side calibration preset")) {
    fail("UI copy must say renderer-side calibration");
  }
  if (!avatarPreviewSource.includes("loadRendererCalibrationState")) {
    fail(
      "AvatarPreview must load the persisted renderer calibration state during initialization",
    );
  }
  if (
    !avatarPreviewSource.includes("saveRendererCalibrationState(nextState)")
  ) {
    fail("changing renderer calibration must invoke state persistence");
  }
  if (!avatarPreviewSource.includes("Set current pose as neutral")) {
    fail("UI must include the neutral-pose capture control");
  }
  if (!avatarPreviewSource.includes("Reset neutral pose")) {
    fail("UI must include the neutral-pose reset control");
  }
  if (!avatarPreviewSource.includes("!isObsMode &&")) {
    fail("calibration controls must remain excluded from OBS mode");
  }

  for (const expectedCopy of [
    "preview-source-panel",
    "preview-calibration-panel",
    "Renderer calibration",
    "Active preset",
    "Neutral center",
    "Custom",
    "Preset default",
    `role="status"`,
    "CALIBRATION_FEEDBACK_CLEAR_DELAY_MS",
    "getNeutralPoseCaptureGuidance",
    "Switch to the native source to capture a neutral pose.",
    "Opening the localhost MotionFrame connection.",
    "Reconnecting to the localhost MotionFrame connection.",
    "Waiting for the first valid native MotionFrame.",
    "Native frames are stale; waiting for a fresh tracking frame.",
    "Connected, but no current native MotionFrame is available.",
    "Native tracking has not started yet.",
    "Tracking is currently lost.",
    "Ready to capture the current native tracking pose.",
    "Neutral pose captured and saved locally.",
    "the custom neutral pose was preserved",
    "using the preset default center",
  ]) {
    if (!avatarPreviewSource.includes(expectedCopy)) {
      fail(
        `AvatarPreview is missing calibration panel coverage copy: ${expectedCopy}`,
      );
    }
  }
  if (avatarPreviewSource.includes('aria-atomic="true"')) {
    fail(
      "interactive controls must not be wrapped in a broad atomic live region",
    );
  }
  if (!avatarPreviewSource.includes("disabled={resetNeutralPoseDisabled}")) {
    fail("reset must be disabled when no custom neutral center exists");
  }
  if (!avatarPreviewSource.includes("disabled={!canCaptureNeutralPose}")) {
    fail("capture button must remain connected to canCaptureNativeNeutralPose");
  }
  if (
    !avatarPreviewSource.includes("aria-describedby={CALIBRATION_GUIDANCE_ID}")
  ) {
    fail("disabled capture must reference nearby availability guidance");
  }
  if (
    !/type\s+CalibrationFeedbackState\s*=\s*\{[\s\S]*?revision:\s*number;[\s\S]*?message:\s*string;[\s\S]*?\}\s*\|\s*null;/.test(
      avatarPreviewSource,
    )
  ) {
    fail("calibration feedback state must include both revision and message");
  }
  if (
    !avatarPreviewSource.includes("calibrationFeedbackRevisionRef = useRef(0)")
  ) {
    fail("calibration feedback revisions must be generated from a local ref");
  }
  if (
    !avatarPreviewSource.includes(
      "const showCalibrationFeedback = (message: string)",
    )
  ) {
    fail("calibration feedback must use a dedicated publishing helper");
  }
  if (
    !avatarPreviewSource.includes(
      "calibrationFeedbackRevisionRef.current += 1",
    ) ||
    !avatarPreviewSource.includes(
      "revision: calibrationFeedbackRevisionRef.current",
    ) ||
    !avatarPreviewSource.includes("message,")
  ) {
    fail(
      "feedback publishing helper must create a new revisioned feedback event",
    );
  }
  for (const feedbackCall of [
    "showCalibrationFeedback(\n      rendererCalibrationState.neutralCenter === null",
    'showCalibrationFeedback("Neutral pose captured and saved locally.")',
    "showCalibrationFeedback(\n      `Neutral pose reset to the ${selectedPreset.label} preset default.`",
  ]) {
    if (!avatarPreviewSource.includes(feedbackCall)) {
      fail(`calibration feedback path must use helper: ${feedbackCall}`);
    }
  }
  if (
    !avatarPreviewSource.includes(
      "<span key={calibrationFeedback.revision}>",
    ) ||
    !avatarPreviewSource.includes("{calibrationFeedback.message}")
  ) {
    fail("rendered feedback message must be keyed by the feedback revision");
  }
  if (!avatarPreviewSource.includes("setCalibrationFeedback(null)")) {
    fail("calibration action feedback must be transient and clear locally");
  }

  if (!avatarPreviewSource.includes("Uses current MotionFrame fields only")) {
    fail("UI copy must say presets use current MotionFrame fields only");
  }
  if (
    !/no\s+real\s+eye, mouth, expression, landmark, blendshape, or ML tracking/.test(
      avatarPreviewSource,
    )
  ) {
    fail("UI copy must avoid real tracking claims");
  }

  console.log("Web Preview face-following calibration check passed.");
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
