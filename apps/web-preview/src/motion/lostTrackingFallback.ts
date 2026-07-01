import {
  createNeutralAvatarMotionState,
  lerpAvatarMotionState,
  lerpTuple3,
  type AvatarMotionState,
} from "./mapMotionFrameToAvatar";

// --- Native lost-pose fallback stabilization --------------------------------
//
// The native OpenCV path can briefly flicker between "tracking" and "lost"
// (for example during wide mouth movement). Without smoothing, a short lost
// flicker snapped the avatar root position back to neutral center, making the
// avatar visibly jump.
//
// This helper separates feature fallback from root-position fallback:
//
// - Root position is held at the last valid tracking pose during a short hold
//   window, so transient lost flicker does not snap the avatar to center.
// - Head rotation, eye openness, gaze, and mouth relax toward neutral faster,
//   so the avatar visually settles without the root jumping.
// - Once lost persists past the hold window, the root position returns toward
//   neutral gradually (a small per-frame step), never instantly.
//
// This is renderer-only visual stabilization. It does not change MotionFrame,
// Native Core, the protocol, or represent any real eye/mouth/expression/
// landmark tracking.

// How long, after the last valid tracking frame, the root position is held at
// the last tracked pose during a lost flicker before it starts returning to
// neutral.
export const LOST_TRACKING_ROOT_HOLD_MS = 1000;

// Per-frame fraction the root position moves toward neutral once the hold
// window has expired. Small so the return is gradual rather than a snap.
export const LOST_TRACKING_ROOT_RETURN_AMOUNT = 0.06;

// Per-frame fraction the non-root feature channels (head rotation, eye
// openness, gaze, mouth, confidence) relax toward neutral while lost. Larger
// than the root return amount so features settle faster than the root moves.
export const LOST_TRACKING_FEATURE_RESET_AMOUNT = 0.35;

export type LostTrackingFallbackInput = {
  lastTrackingMotion: AvatarMotionState | null;
  lastTrackingTimestampMs: number | null;
  previousLostFallbackMotion: AvatarMotionState | null;
  currentTimestampMs: number;
};

/**
 * Compute the rendered avatar motion for a native "lost" frame.
 *
 * Deterministic for a given input: it depends only on the last valid tracking
 * motion/timestamp, the previous lost-fallback motion, and the current
 * timestamp. It never reads real time, so it can be tested with fixed
 * timestamps and fixed previous state.
 *
 * Behavior:
 * - Feature channels always relax toward neutral by
 *   `LOST_TRACKING_FEATURE_RESET_AMOUNT`, decaying smoothly across frames.
 * - Root position is held at the last valid tracking pose while the current
 *   timestamp is within `LOST_TRACKING_ROOT_HOLD_MS` of the last tracking
 *   frame; after that it lerps toward neutral by
 *   `LOST_TRACKING_ROOT_RETURN_AMOUNT` per frame.
 */
export const computeLostTrackingFallbackMotion = ({
  lastTrackingMotion,
  lastTrackingTimestampMs,
  previousLostFallbackMotion,
  currentTimestampMs,
}: LostTrackingFallbackInput): AvatarMotionState => {
  const neutralLostMotion = createNeutralAvatarMotionState("lost");

  // Relax the feature channels toward neutral. Start from the previous lost
  // fallback so repeated lost frames decay smoothly; on the first lost frame
  // that is the last tracking pose.
  const featureSource =
    previousLostFallbackMotion ?? lastTrackingMotion ?? neutralLostMotion;
  const relaxedMotion = lerpAvatarMotionState(
    featureSource,
    neutralLostMotion,
    LOST_TRACKING_FEATURE_RESET_AMOUNT,
  );

  const withinRootHold =
    lastTrackingMotion !== null &&
    lastTrackingTimestampMs !== null &&
    currentTimestampMs - lastTrackingTimestampMs <= LOST_TRACKING_ROOT_HOLD_MS;

  if (withinRootHold && lastTrackingMotion !== null) {
    // Hold the root exactly at the last valid tracking pose so short flicker
    // does not move the avatar off its detected position.
    return {
      ...relaxedMotion,
      rootPosition: [...lastTrackingMotion.rootPosition],
    };
  }

  // Past the hold window: return the root toward neutral gradually, continuing
  // from wherever the previous lost fallback left it.
  const previousRootPosition =
    previousLostFallbackMotion?.rootPosition ??
    lastTrackingMotion?.rootPosition ??
    neutralLostMotion.rootPosition;

  return {
    ...relaxedMotion,
    rootPosition: lerpTuple3(
      previousRootPosition,
      neutralLostMotion.rootPosition,
      LOST_TRACKING_ROOT_RETURN_AMOUNT,
    ),
  };
};
