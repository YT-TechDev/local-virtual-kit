#include "face_tracking_pipeline.h"

#include "tracking_sample_factory.h"

#include <utility>

namespace lvk::tracker {

FaceTrackingPipeline::FaceTrackingPipeline(
    FaceDetector& faceDetector,
    MotionTracker& fallbackTracker,
    std::string detectorName)
    : faceDetector_(faceDetector),
      fallbackTracker_(fallbackTracker),
      detectorName_(std::move(detectorName)),
      latestDiagnostics_{
          detectorName_,
          false,
          0.0,
          FaceBounds{0, 0, 0, 0},
          false,
      } {}

TrackingSample FaceTrackingPipeline::track(const PreprocessedFrame& frame) {
  const auto faceDetection = faceDetector_.detect(frame);
  const bool shouldUseFallbackTracking =
      detectorName_ == "noop" && !faceDetection.hasFace;
  latestDiagnostics_ = FaceDetectionDiagnostics{
      detectorName_,
      faceDetection.hasFace,
      faceDetection.confidence,
      faceDetection.bounds,
      shouldUseFallbackTracking,
  };

  if (faceDetection.hasFace) {
    return createTrackingSampleFromFaceDetection(frame, faceDetection);
  }

  if (shouldUseFallbackTracking) {
    return fallbackTracker_.track(frame);
  }

  return createLostTrackingSample(frame);
}

const FaceDetectionDiagnostics&
FaceTrackingPipeline::lastDetectionDiagnostics() const {
  return latestDiagnostics_;
}

}  // namespace lvk::tracker
