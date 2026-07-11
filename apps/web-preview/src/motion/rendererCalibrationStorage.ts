import {
  DEFAULT_FACE_FOLLOWING_PRESET_ID,
  FACE_FOLLOWING_PRESETS,
  type FaceFollowingPresetId,
} from "./faceFollowingPresets";

export type PersistedRendererCalibrationState = {
  version: 1;
  presetId: FaceFollowingPresetId;
};

type RendererCalibrationStorage = Pick<Storage, "getItem" | "setItem">;

export const RENDERER_CALIBRATION_STORAGE_KEY =
  "lvk.webPreview.rendererCalibration";

const RENDERER_CALIBRATION_STORAGE_VERSION = 1;

const isSupportedPresetId = (
  value: unknown,
): value is FaceFollowingPresetId => {
  return FACE_FOLLOWING_PRESETS.some((preset) => preset.id === value);
};

const getBrowserStorage = (): RendererCalibrationStorage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const parsePersistedRendererCalibrationState = (
  serializedState: string | null,
): PersistedRendererCalibrationState | null => {
  if (serializedState === null) {
    return null;
  }

  let parsedState: unknown;

  try {
    parsedState = JSON.parse(serializedState);
  } catch {
    return null;
  }

  if (typeof parsedState !== "object" || parsedState === null) {
    return null;
  }

  const candidate = parsedState as Partial<PersistedRendererCalibrationState>;

  if (candidate.version !== RENDERER_CALIBRATION_STORAGE_VERSION) {
    return null;
  }

  if (!isSupportedPresetId(candidate.presetId)) {
    return null;
  }

  return {
    version: RENDERER_CALIBRATION_STORAGE_VERSION,
    presetId: candidate.presetId,
  };
};

export const loadRendererCalibrationPresetId = (
  storage: RendererCalibrationStorage | null = getBrowserStorage(),
): FaceFollowingPresetId => {
  if (storage === null) {
    return DEFAULT_FACE_FOLLOWING_PRESET_ID;
  }

  try {
    return (
      parsePersistedRendererCalibrationState(
        storage.getItem(RENDERER_CALIBRATION_STORAGE_KEY),
      )?.presetId ?? DEFAULT_FACE_FOLLOWING_PRESET_ID
    );
  } catch {
    return DEFAULT_FACE_FOLLOWING_PRESET_ID;
  }
};

export const saveRendererCalibrationPresetId = (
  presetId: FaceFollowingPresetId,
  storage: RendererCalibrationStorage | null = getBrowserStorage(),
) => {
  if (storage === null) {
    return;
  }

  const persistedState: PersistedRendererCalibrationState = {
    version: RENDERER_CALIBRATION_STORAGE_VERSION,
    presetId,
  };

  try {
    storage.setItem(
      RENDERER_CALIBRATION_STORAGE_KEY,
      JSON.stringify(persistedState),
    );
  } catch {
    // Browser storage can be unavailable, quota-limited, or disabled. The
    // preview keeps the in-memory preset and simply skips persistence.
  }
};
