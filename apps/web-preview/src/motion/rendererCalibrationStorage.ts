import {
  FACE_FOLLOWING_MAX_CENTER,
  FACE_FOLLOWING_MIN_CENTER,
  type FaceFollowingAxisCalibration,
} from "./faceFollowingCalibration";
import {
  DEFAULT_FACE_FOLLOWING_PRESET_ID,
  FACE_FOLLOWING_PRESETS,
  type FaceFollowingPresetId,
} from "./faceFollowingPresets";

export type RendererCalibrationState = {
  presetId: FaceFollowingPresetId;
  neutralCenter: FaceFollowingAxisCalibration | null;
};

type PersistedRendererCalibrationStateV1 = {
  version: 1;
  presetId: FaceFollowingPresetId;
};

type PersistedRendererCalibrationStateV2 = {
  version: 2;
  presetId: FaceFollowingPresetId;
  neutralCenter: FaceFollowingAxisCalibration | null;
};

export type PersistedRendererCalibrationState =
  | PersistedRendererCalibrationStateV1
  | PersistedRendererCalibrationStateV2;

type RendererCalibrationStorage = Pick<Storage, "getItem" | "setItem">;

export const RENDERER_CALIBRATION_STORAGE_KEY =
  "lvk.webPreview.rendererCalibration";

const RENDERER_CALIBRATION_STORAGE_VERSION = 2;

export const DEFAULT_RENDERER_CALIBRATION_STATE: RendererCalibrationState = {
  presetId: DEFAULT_FACE_FOLLOWING_PRESET_ID,
  neutralCenter: null,
};

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

const isFiniteNormalizedCenterCoordinate = (
  value: unknown,
): value is number => {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= FACE_FOLLOWING_MIN_CENTER &&
    value <= FACE_FOLLOWING_MAX_CENTER
  );
};

const parseNeutralCenter = (
  value: unknown,
): FaceFollowingAxisCalibration | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Partial<FaceFollowingAxisCalibration>;

  if (
    !isFiniteNormalizedCenterCoordinate(candidate.x) ||
    !isFiniteNormalizedCenterCoordinate(candidate.y) ||
    !isFiniteNormalizedCenterCoordinate(candidate.z)
  ) {
    return undefined;
  }

  return { x: candidate.x, y: candidate.y, z: candidate.z };
};

export const parsePersistedRendererCalibrationState = (
  serializedState: string | null,
): RendererCalibrationState | null => {
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

  if (!isSupportedPresetId(candidate.presetId)) {
    return null;
  }

  if (candidate.version === 1) {
    return { presetId: candidate.presetId, neutralCenter: null };
  }

  if (candidate.version !== RENDERER_CALIBRATION_STORAGE_VERSION) {
    return null;
  }

  const neutralCenter = parseNeutralCenter(candidate.neutralCenter);

  return {
    presetId: candidate.presetId,
    neutralCenter: neutralCenter ?? null,
  };
};

export const loadRendererCalibrationState = (
  storage: RendererCalibrationStorage | null = getBrowserStorage(),
): RendererCalibrationState => {
  if (storage === null) {
    return DEFAULT_RENDERER_CALIBRATION_STATE;
  }

  try {
    return (
      parsePersistedRendererCalibrationState(
        storage.getItem(RENDERER_CALIBRATION_STORAGE_KEY),
      ) ?? DEFAULT_RENDERER_CALIBRATION_STATE
    );
  } catch {
    return DEFAULT_RENDERER_CALIBRATION_STATE;
  }
};

export const loadRendererCalibrationPresetId = (
  storage: RendererCalibrationStorage | null = getBrowserStorage(),
): FaceFollowingPresetId => loadRendererCalibrationState(storage).presetId;

export const saveRendererCalibrationState = (
  state: RendererCalibrationState,
  storage: RendererCalibrationStorage | null = getBrowserStorage(),
) => {
  if (storage === null) {
    return;
  }

  const persistedState: PersistedRendererCalibrationStateV2 = {
    version: RENDERER_CALIBRATION_STORAGE_VERSION,
    presetId: state.presetId,
    neutralCenter: state.neutralCenter,
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

export const saveRendererCalibrationPresetId = (
  presetId: FaceFollowingPresetId,
  storage: RendererCalibrationStorage | null = getBrowserStorage(),
) => {
  saveRendererCalibrationState({ presetId, neutralCenter: null }, storage);
};
