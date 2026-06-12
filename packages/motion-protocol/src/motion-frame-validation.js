const TRACKING_STATUSES = new Set(["not_started", "tracking", "lost"]);
const MOTION_FRAME_SOURCES = new Set(["dummy", "native"]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/**
 * @param {unknown} value
 * @returns {value is number}
 */
const isFiniteNumber = (value) => {
  return typeof value === "number" && Number.isFinite(value);
};

/**
 * @param {unknown} value
 * @returns {value is import("./motion-frame").MotionFrameSource}
 */
const isMotionFrameSource = (value) => {
  return typeof value === "string" && MOTION_FRAME_SOURCES.has(value);
};

/**
 * @param {unknown} value
 * @returns {value is import("./motion-frame").TrackingStatus}
 */
const isTrackingStatus = (value) => {
  return typeof value === "string" && TRACKING_STATUSES.has(value);
};

/**
 * @param {unknown} value
 * @returns {value is import("./motion-frame").Vector2}
 */
const isVector2 = (value) => {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
};

/**
 * @param {unknown} value
 * @returns {value is import("./motion-frame").Vector3}
 */
const isVector3 = (value) => {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
};

/**
 * @param {unknown} value
 * @returns {value is import("./motion-frame").EulerRotation}
 */
const isEulerRotation = (value) => {
  return (
    isRecord(value) &&
    isFiniteNumber(value.pitch) &&
    isFiniteNumber(value.yaw) &&
    isFiniteNumber(value.roll)
  );
};

/**
 * Validates the v0.1 MotionFrame shape without depending on renderer,
 * desktop, native, or platform runtime APIs.
 *
 * @param {unknown} value
 * @returns {value is import("./motion-frame").MotionFrame}
 */
export const isMotionFrame = (value) => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.schemaVersion !== 1 ||
    !isMotionFrameSource(value.source) ||
    !isFiniteNumber(value.timestampMs)
  ) {
    return false;
  }

  if (!isRecord(value.tracking) || !isTrackingStatus(value.tracking.status)) {
    return false;
  }

  if (!isFiniteNumber(value.tracking.confidence)) {
    return false;
  }

  if (
    !isRecord(value.face) ||
    !isVector3(value.face.position) ||
    !isEulerRotation(value.face.rotation)
  ) {
    return false;
  }

  if (
    !isRecord(value.eyes) ||
    !isFiniteNumber(value.eyes.leftOpen) ||
    !isFiniteNumber(value.eyes.rightOpen)
  ) {
    return false;
  }

  if (!isVector2(value.eyes.gaze)) {
    return false;
  }

  if (
    !isRecord(value.mouth) ||
    !isFiniteNumber(value.mouth.open) ||
    !isFiniteNumber(value.mouth.smile)
  ) {
    return false;
  }

  return true;
};

/**
 * Validates native bridge MotionFrame input. Native bridge frames must use
 * the v0.1 MotionFrame schema and `source: "native"`.
 *
 * @param {unknown} value
 * @returns {value is import("./motion-frame").MotionFrame & { source: "native" }}
 */
export const isNativeMotionFrame = (value) => {
  return isMotionFrame(value) && value.source === "native";
};

/**
 * @param {unknown} data
 * @returns {(import("./motion-frame").MotionFrame & { source: "native" }) | null}
 */
export const parseNativeMotionFrameJson = (data) => {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data);
    return isNativeMotionFrame(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
