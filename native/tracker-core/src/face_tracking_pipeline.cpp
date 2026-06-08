#include "face_tracking_pipeline.h"

namespace lvk::tracker {

FaceTrackingPipeline::FaceTrackingPipeline(
    FaceDetector& faceDetector,
    MotionTracker& fallbackTracker)
    : faceDetector_(faceDetector), fallbackTracker_(fallbackTracker) {}

TrackingSample FaceTrackingPipeline::track(const PreprocessedFrame& frame) {
  const auto faceDetection = faceDetector_.detect(frame);
  (void)faceDetection;

  // Real face detector outputs will be mapped to TrackingSample values in a
  // later PR. For now, preserve the existing deterministic dummy MotionFrame
  // output through the fallback tracker.
  return fallbackTracker_.track(frame);
}

}  // namespace lvk::tracker
