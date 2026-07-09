import { lerpTuple3, type AvatarMotionState } from "./mapMotionFrameToAvatar";

// --- Native tracking motion smoothing ---------------------------------------
//
// The native OpenCV face-following path updates `face.position` in discrete
// steps (roughly camera/detector cadence), and the detected position can jump
// slightly between frames. Applying each mapped target straight to the avatar
// root made the movement read as angular/blocky stepping.
//
// This helper eases the rendered root position and head rotation toward each
// freshly mapped native target using frame-rate-independent exponential
// smoothing, so face-following glides instead of stepping while staying
// responsive enough to feel live.
//
// It intentionally smooths only the position/rotation channels. The eye, gaze,
// and mouth channels come from the renderer-side idle approximation, which is
// already continuous; smoothing them again would dampen the deliberate blink
// dip, so those channels pass through from the target untouched.
//
// This is renderer-only visual behavior. It does not change MotionFrame, Native
// Core, the protocol, or represent any real eye/mouth/expression/landmark
// tracking. Because it interpolates between two already-clamped motion states
// with an amount in [0, 1], its outputs stay within the same safe ranges.

// Exponential smoothing time constants in seconds. They set how quickly the
// rendered pose eases toward each mapped native target: smaller = snappier and
// more responsive, larger = smoother and more damped. Root position is the main
// source of visible angular/blocky movement, so it carries the primary tuning
// knob; head rotation uses the same constant for consistent easing.
export const TRACKING_POSITION_SMOOTHING_TAU_SECONDS = 0.12;
export const TRACKING_ROTATION_SMOOTHING_TAU_SECONDS = 0.12;

export type TrackingSmoothingOptions = {
  positionTauSeconds: number;
  rotationTauSeconds: number;
};

export const DEFAULT_TRACKING_SMOOTHING_OPTIONS: TrackingSmoothingOptions = {
  positionTauSeconds: TRACKING_POSITION_SMOOTHING_TAU_SECONDS,
  rotationTauSeconds: TRACKING_ROTATION_SMOOTHING_TAU_SECONDS,
};

/**
 * Frame-rate-independent exponential smoothing factor for a given frame delta
 * and time constant, returned as a lerp amount in [0, 1].
 *
 * Uses `1 - exp(-dt / tau)`, so a fixed real-time response is preserved
 * regardless of render frame rate. Degenerate inputs fall back to `1` (snap
 * directly to the target): a non-positive delta (first frame, paused clock) or
 * a non-positive time constant means "no smoothing this frame". A very large
 * delta (for example after a background tab resumes) naturally yields an alpha
 * near 1, so the pose catches up rather than drifting slowly.
 */
export const computeExponentialSmoothingAlpha = (
  deltaSeconds: number,
  tauSeconds: number,
): number => {
  if (!(deltaSeconds > 0) || !(tauSeconds > 0)) {
    return 1;
  }

  return 1 - Math.exp(-deltaSeconds / tauSeconds);
};

/**
 * Ease a rendered tracking pose toward a freshly mapped native target.
 *
 * Deterministic for a given (previous, target, deltaSeconds): it reads no real
 * time and can be tested with fixed inputs. Only `rootPosition` and
 * `headRotation` are smoothed; every other field (status, confidence, eyes,
 * gaze, mouth) is taken from the target so idle blink/gaze/mouth motion stays
 * crisp. Pass the previous rendered tracking pose as `previous`; on the first
 * tracking frame pass the target itself so the result snaps to it.
 */
export const smoothTrackingMotion = (
  previous: AvatarMotionState,
  target: AvatarMotionState,
  deltaSeconds: number,
  options: TrackingSmoothingOptions = DEFAULT_TRACKING_SMOOTHING_OPTIONS,
): AvatarMotionState => {
  const positionAlpha = computeExponentialSmoothingAlpha(
    deltaSeconds,
    options.positionTauSeconds,
  );
  const rotationAlpha = computeExponentialSmoothingAlpha(
    deltaSeconds,
    options.rotationTauSeconds,
  );

  return {
    ...target,
    rootPosition: lerpTuple3(
      previous.rootPosition,
      target.rootPosition,
      positionAlpha,
    ),
    headRotation: lerpTuple3(
      previous.headRotation,
      target.headRotation,
      rotationAlpha,
    ),
  };
};
