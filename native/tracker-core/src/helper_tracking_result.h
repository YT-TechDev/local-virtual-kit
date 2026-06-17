#pragma once

#include "tracker.h"

namespace lvk::tracker {

// Native Core-internal helper result types (H1b).
//
// These mirror the synthetic helper's internal stdout contract validated in
// PR #125 (see docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md). They are
// strongly typed C++ values used only inside Native Core; they are NOT
// MotionFrame, are NOT part of packages/motion-protocol, and must never leak
// helper-only fields into MotionFrame.
//
// This PR proves only the Native Core-side mapping boundary. It does not spawn
// the helper, parse live helper stdout, or wire lvk-synthetic-helper into the
// tracker runtime.

enum class HelperTrackingStatus {
  NotStarted,
  Tracking,
  Lost,
};

struct HelperFaceRotation {
  double pitch = 0.0;
  double yaw = 0.0;
  double roll = 0.0;
};

struct HelperEyeState {
  double leftOpen = 1.0;
  double rightOpen = 1.0;
};

struct HelperMouthState {
  double open = 0.0;
  double smile = 0.0;
};

struct HelperTrackingResult {
  long long timestampMs = 0;
  HelperTrackingStatus status = HelperTrackingStatus::NotStarted;
  double confidence = 0.0;
  HelperFaceRotation faceRotation;
  HelperEyeState eyes;
  HelperMouthState mouth;
  double inferenceMs = 0.0;
};

// Maps a Native Core-internal helper result into the existing TrackingSample
// shape. The mapping is explicit, clamped, and safe:
//   - confidence and eye/mouth values are clamped to [0.0, 1.0]
//   - non-finite (NaN/infinity) inputs fall back to neutral/zero values
//   - face position and gaze remain neutral for now
//   - the helper-only inferenceMs field is intentionally dropped
// No MotionFrame schema change is involved.
TrackingSample createTrackingSampleFromHelperResult(
    const HelperTrackingResult& result);

}  // namespace lvk::tracker
