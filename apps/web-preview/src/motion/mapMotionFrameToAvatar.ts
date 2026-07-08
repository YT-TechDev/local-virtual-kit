import type { MotionFrame, TrackingStatus } from "@lvk/motion-protocol";
import {
  applyFaceFollowingCalibration,
  DEFAULT_FACE_FOLLOWING_CALIBRATION,
  type FaceFollowingCalibration,
} from "./faceFollowingCalibration";

export type AvatarMotionState = {
  trackingStatus: TrackingStatus;
  confidence: number;
  rootPosition: [number, number, number];
  headRotation: [number, number, number];
  eyeOpen: {
    left: number;
    right: number;
  };
  gaze: [number, number];
  mouth: {
    open: number;
    smile: number;
  };
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const clamp01 = (value: number): number => clamp(value, 0, 1);

export const createNeutralAvatarMotionState = (
  status: TrackingStatus = "not_started",
): AvatarMotionState => {
  return {
    trackingStatus: status,
    confidence: 0,
    rootPosition: [0, 0, 0],
    headRotation: [0, 0, 0],
    eyeOpen: {
      left: 1,
      right: 1,
    },
    gaze: [0, 0],
    mouth: {
      open: 0,
      smile: 0,
    },
  };
};

export const lerpNumber = (
  from: number,
  to: number,
  amount: number,
): number => {
  return from + (to - from) * clamp01(amount);
};

export const lerpTuple3 = (
  from: [number, number, number],
  to: [number, number, number],
  amount: number,
): [number, number, number] => {
  return [
    lerpNumber(from[0], to[0], amount),
    lerpNumber(from[1], to[1], amount),
    lerpNumber(from[2], to[2], amount),
  ];
};

export const lerpTuple2 = (
  from: [number, number],
  to: [number, number],
  amount: number,
): [number, number] => {
  return [
    lerpNumber(from[0], to[0], amount),
    lerpNumber(from[1], to[1], amount),
  ];
};

export const lerpAvatarMotionState = (
  from: AvatarMotionState,
  to: AvatarMotionState,
  amount: number,
): AvatarMotionState => {
  return {
    trackingStatus: to.trackingStatus,
    confidence: lerpNumber(from.confidence, to.confidence, amount),
    rootPosition: lerpTuple3(from.rootPosition, to.rootPosition, amount),
    headRotation: lerpTuple3(from.headRotation, to.headRotation, amount),
    eyeOpen: {
      left: lerpNumber(from.eyeOpen.left, to.eyeOpen.left, amount),
      right: lerpNumber(from.eyeOpen.right, to.eyeOpen.right, amount),
    },
    gaze: lerpTuple2(from.gaze, to.gaze, amount),
    mouth: {
      open: lerpNumber(from.mouth.open, to.mouth.open, amount),
      smile: lerpNumber(from.mouth.smile, to.mouth.smile, amount),
    },
  };
};

// --- Renderer-side idle approximation ---------------------------------------
//
// Cosmetic, renderer-only idle animation. This does NOT represent real eye,
// gaze, mouth, or expression tracking. The native OpenCV path currently emits
// neutral/static values for these channels (only face.position varies per
// frame), so this adds subtle liveliness while true tracking remains future
// work. It never changes MotionFrame, Native Core, or the protocol schema, and
// it never overrides non-neutral values: if a channel ever arrives with real
// (non-neutral) data, that channel is preserved untouched.

const IDLE_NEUTRAL_EPSILON = 1e-3;

const NEUTRAL_EYE_OPEN = 1;
const NEUTRAL_GAZE = 0;
const NEUTRAL_MOUTH = 0;

// Blink: a short, deterministic dip in eye openness on a slow repeating cycle.
const IDLE_BLINK_INTERVAL_MS = 4200;
const IDLE_BLINK_DURATION_MS = 160;
const IDLE_BLINK_DEPTH = 0.85;

// Gaze: a slow, small-amplitude sinusoidal drift on each axis.
const IDLE_GAZE_DRIFT_AMPLITUDE = 0.12;
const IDLE_GAZE_DRIFT_SPEED_X = 0.00042;
const IDLE_GAZE_DRIFT_SPEED_Y = 0.00027;
const IDLE_GAZE_DRIFT_PHASE_Y = Math.PI / 2;

// Mouth: a very subtle breathing-like idle opening. Intentionally tiny so it is
// never mistaken for real mouth/viseme tracking.
const IDLE_MOUTH_OPEN_AMPLITUDE = 0.035;
const IDLE_MOUTH_OPEN_SPEED = 0.0016;

const isNearNeutral = (value: number, neutral: number): boolean => {
  return Math.abs(value - neutral) <= IDLE_NEUTRAL_EPSILON;
};

const computeIdleBlinkOpenness = (timestampMs: number): number => {
  const phaseMs =
    ((timestampMs % IDLE_BLINK_INTERVAL_MS) + IDLE_BLINK_INTERVAL_MS) %
    IDLE_BLINK_INTERVAL_MS;

  if (phaseMs >= IDLE_BLINK_DURATION_MS) {
    return NEUTRAL_EYE_OPEN;
  }

  const blinkProgress = phaseMs / IDLE_BLINK_DURATION_MS;
  const closedAmount = Math.sin(blinkProgress * Math.PI) * IDLE_BLINK_DEPTH;

  return clamp01(NEUTRAL_EYE_OPEN - closedAmount);
};

const computeIdleEyeOpen = (
  timestampMs: number,
): { left: number; right: number } => {
  const openness = computeIdleBlinkOpenness(timestampMs);

  return { left: openness, right: openness };
};

const computeIdleGazeDrift = (timestampMs: number): [number, number] => {
  const x =
    Math.sin(timestampMs * IDLE_GAZE_DRIFT_SPEED_X) * IDLE_GAZE_DRIFT_AMPLITUDE;
  const y =
    Math.sin(timestampMs * IDLE_GAZE_DRIFT_SPEED_Y + IDLE_GAZE_DRIFT_PHASE_Y) *
    IDLE_GAZE_DRIFT_AMPLITUDE;

  return [clamp(x, -1, 1), clamp(y, -1, 1)];
};

const computeIdleMouthOpen = (timestampMs: number): number => {
  const oscillation = (Math.sin(timestampMs * IDLE_MOUTH_OPEN_SPEED) + 1) / 2;

  return clamp01(oscillation * IDLE_MOUTH_OPEN_AMPLITUDE);
};

/**
 * Renderer-side cosmetic idle approximation. Given a mapped AvatarMotionState
 * and a timestamp, it adds subtle blink / gaze drift / mouth idle motion for
 * channels that are still neutral, so the avatar feels less static.
 *
 * This is deterministic for a given timestamp, applies only while
 * `trackingStatus` is "tracking", never touches `rootPosition`, `headRotation`,
 * or `confidence`, and preserves any non-neutral (real) eye/gaze/mouth values
 * instead of overriding them. It is an approximation, not real eye/mouth/
 * expression tracking, and does not change MotionFrame or the protocol.
 */
export const applyRendererIdleApproximation = (
  motion: AvatarMotionState,
  timestampMs: number,
): AvatarMotionState => {
  if (motion.trackingStatus !== "tracking") {
    return motion;
  }

  const eyesAreNeutral =
    isNearNeutral(motion.eyeOpen.left, NEUTRAL_EYE_OPEN) &&
    isNearNeutral(motion.eyeOpen.right, NEUTRAL_EYE_OPEN);
  const gazeIsNeutral =
    isNearNeutral(motion.gaze[0], NEUTRAL_GAZE) &&
    isNearNeutral(motion.gaze[1], NEUTRAL_GAZE);
  const mouthIsNeutral =
    isNearNeutral(motion.mouth.open, NEUTRAL_MOUTH) &&
    isNearNeutral(motion.mouth.smile, NEUTRAL_MOUTH);

  const eyeOpen = eyesAreNeutral
    ? computeIdleEyeOpen(timestampMs)
    : motion.eyeOpen;
  const gaze: [number, number] = gazeIsNeutral
    ? computeIdleGazeDrift(timestampMs)
    : motion.gaze;
  const mouth = mouthIsNeutral
    ? { open: computeIdleMouthOpen(timestampMs), smile: motion.mouth.smile }
    : motion.mouth;

  return {
    ...motion,
    eyeOpen,
    gaze,
    mouth,
  };
};

/**
 * Map a MotionFrame onto avatar motion. The optional `calibration` tunes the
 * local face-following mapping of `face.position` onto the avatar root offset
 * (per-axis center + sensitivity). It defaults to the baseline calibration,
 * which reproduces the previous hard-coded mapping exactly, so dummy and native
 * behavior is unchanged unless a caller passes a different calibration.
 */
export const mapMotionFrameToAvatar = (
  frame: MotionFrame,
  calibration: FaceFollowingCalibration = DEFAULT_FACE_FOLLOWING_CALIBRATION,
): AvatarMotionState => {
  return {
    trackingStatus: frame.tracking.status,
    confidence: clamp01(frame.tracking.confidence),
    rootPosition: applyFaceFollowingCalibration(
      frame.face.position,
      calibration,
    ),
    headRotation: [
      clamp(frame.face.rotation.pitch, -1, 1),
      clamp(frame.face.rotation.yaw, -1, 1),
      clamp(frame.face.rotation.roll, -1, 1),
    ],
    eyeOpen: {
      left: clamp01(frame.eyes.leftOpen),
      right: clamp01(frame.eyes.rightOpen),
    },
    gaze: [clamp(frame.eyes.gaze.x, -1, 1), clamp(frame.eyes.gaze.y, -1, 1)],
    mouth: {
      open: clamp01(frame.mouth.open),
      smile: clamp01(frame.mouth.smile),
    },
  };
};
