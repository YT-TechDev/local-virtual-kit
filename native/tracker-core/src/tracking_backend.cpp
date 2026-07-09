#include "tracking_backend.h"

#include <utility>

namespace lvk::tracker {

FaceTrackingPipelineBackend::FaceTrackingPipelineBackend(
    FaceDetector& faceDetector,
    MotionTracker& fallbackTracker,
    std::string detectorName)
    : pipeline_(faceDetector, fallbackTracker, std::move(detectorName)) {}

TrackingSample FaceTrackingPipelineBackend::track(
    const PreprocessedFrame& frame) {
  return pipeline_.track(frame);
}

const FaceDetectionDiagnostics&
FaceTrackingPipelineBackend::lastDetectionDiagnostics() const {
  return pipeline_.lastDetectionDiagnostics();
}

}  // namespace lvk::tracker
