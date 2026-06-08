#include "face_tracking_pipeline.h"

#include "tracking_sample_factory.h"

namespace lvk::tracker {

FaceTrackingPipeline::FaceTrackingPipeline(
    FaceDetector& faceDetector,
    MotionTracker& fallbackTracker)
    : faceDetector_(faceDetector), fallbackTracker_(fallbackTracker) {}

TrackingSample FaceTrackingPipeline::track(const PreprocessedFrame& frame) {
  const auto faceDetection = faceDetector_.detect(frame);

  if (faceDetection.hasFace) {
    return createTrackingSampleFromFaceDetection(frame, faceDetection);
  }

  // No-face policy is intentionally deferred; keep the current no-op detector
  // path on deterministic dummy MotionFrame output through the fallback tracker.
  return fallbackTracker_.track(frame);
}

}  // namespace lvk::tracker
