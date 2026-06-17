#include "helper_tracking_result.h"

#include <algorithm>
#include <cmath>

namespace lvk::tracker {
namespace {

// Clamp a normalized value to [0.0, 1.0]. Non-finite inputs (NaN/infinity) fall
// back to the provided neutral value so they never leak into MotionFrame.
double clampNormalized(double value, double neutralFallback) {
  if (!std::isfinite(value)) {
    return neutralFallback;
  }

  return std::clamp(value, 0.0, 1.0);
}

double clampConfidence(double value) {
  if (!std::isfinite(value)) {
    return 0.0;
  }

  return std::clamp(value, 0.0, 1.0);
}

double sanitizeFinite(double value) {
  return std::isfinite(value) ? value : 0.0;
}

// Safe, neutral non-tracking output shape, consistent with
// createLostTrackingSample in tracking_sample_factory.cpp: neutral pose, neutral
// gaze, eyes open, mouth closed, and zero confidence.
TrackingSample createNeutralSample(long long timestampMs, TrackingStatus status) {
  return TrackingSample{
      timestampMs,
      status,
      0.0,
      Vector3{0.0, 0.0, 0.0},
      EulerRotation{0.0, 0.0, 0.0},
      1.0,
      1.0,
      Vector2{0.0, 0.0},
      0.0,
      0.0,
  };
}

}  // namespace

TrackingSample createTrackingSampleFromHelperResult(
    const HelperTrackingResult& result) {
  switch (result.status) {
  case HelperTrackingStatus::Tracking:
    // Map and clamp the helper's tracking values. Face position and gaze remain
    // neutral for now; the helper-only inferenceMs field is intentionally not
    // carried into MotionFrame.
    return TrackingSample{
        result.timestampMs,
        TrackingStatus::Tracking,
        clampConfidence(result.confidence),
        Vector3{0.0, 0.0, 0.0},
        EulerRotation{
            sanitizeFinite(result.faceRotation.pitch),
            sanitizeFinite(result.faceRotation.yaw),
            sanitizeFinite(result.faceRotation.roll),
        },
        clampNormalized(result.eyes.leftOpen, 1.0),
        clampNormalized(result.eyes.rightOpen, 1.0),
        Vector2{0.0, 0.0},
        clampNormalized(result.mouth.open, 0.0),
        clampNormalized(result.mouth.smile, 0.0),
    };
  case HelperTrackingStatus::Lost:
    return createNeutralSample(result.timestampMs, TrackingStatus::Lost);
  case HelperTrackingStatus::NotStarted:
    return createNeutralSample(result.timestampMs, TrackingStatus::NotStarted);
  }

  // Defensive default for an unexpected enum value: safest non-tracking shape.
  return createNeutralSample(result.timestampMs, TrackingStatus::Lost);
}

}  // namespace lvk::tracker
