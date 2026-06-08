#include "tracking_sample_factory.h"

#include <algorithm>
#include <cmath>

namespace lvk::tracker {
namespace {

Vector3 neutralFacePosition() {
  return Vector3{0.0, 0.0, 0.0};
}

EulerRotation neutralFaceRotation() {
  return EulerRotation{0.0, 0.0, 0.0};
}

Vector2 neutralGaze() {
  return Vector2{0.0, 0.0};
}

bool hasUsableFaceBounds(
    const PreprocessedFrame& frame,
    const FaceBounds& bounds) {
  return frame.width > 0 && frame.height > 0 && bounds.width > 0 &&
         bounds.height > 0;
}

Vector3 createFacePositionFromBounds(
    const PreprocessedFrame& frame,
    const FaceBounds& bounds) {
  if (!hasUsableFaceBounds(frame, bounds)) {
    return neutralFacePosition();
  }

  const double centerX = static_cast<double>(bounds.x) +
                         (static_cast<double>(bounds.width) / 2.0);
  const double centerY = static_cast<double>(bounds.y) +
                         (static_cast<double>(bounds.height) / 2.0);

  const double normalizedX =
      ((centerX / static_cast<double>(frame.width)) * 2.0) - 1.0;
  const double normalizedY =
      -(((centerY / static_cast<double>(frame.height)) * 2.0) - 1.0);

  return Vector3{
      std::clamp(normalizedX, -1.0, 1.0),
      std::clamp(normalizedY, -1.0, 1.0),
      0.0,
  };
}

}  // namespace

double clampTrackingConfidence(double confidence) {
  if (!std::isfinite(confidence)) {
    return 0.0;
  }

  return std::clamp(confidence, 0.0, 1.0);
}

TrackingSample createLostTrackingSample(const PreprocessedFrame& frame) {
  return TrackingSample{
      frame.cameraFrame.timestampMs,
      TrackingStatus::Lost,
      0.0,
      neutralFacePosition(),
      neutralFaceRotation(),
      1.0,
      1.0,
      neutralGaze(),
      0.0,
      0.0,
  };
}

TrackingSample createTrackingSampleFromFaceDetection(
    const PreprocessedFrame& frame,
    const FaceDetectionResult& detection) {
  if (!detection.hasFace) {
    return createLostTrackingSample(frame);
  }

  // Temporary metadata-only mapping until local landmark extraction exists.
  // Bounds can indicate coarse face position, but rotation, gaze, eyes, and
  // expression values remain neutral so they are not mistaken for real tracking.
  return TrackingSample{
      frame.cameraFrame.timestampMs,
      TrackingStatus::Tracking,
      clampTrackingConfidence(detection.confidence),
      createFacePositionFromBounds(frame, detection.bounds),
      neutralFaceRotation(),
      1.0,
      1.0,
      neutralGaze(),
      0.0,
      0.0,
  };
}

}  // namespace lvk::tracker
