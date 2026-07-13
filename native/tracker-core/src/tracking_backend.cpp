#include "tracking_backend.h"

#include "helper_tracking_result.h"

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

SyntheticHelperTrackingBackend::SyntheticHelperTrackingBackend(
    HelperSessionConfig config)
    : session_(std::move(config)),
      diagnostics_(FaceDetectionDiagnostics{
          "synthetic-helper",
          false,
          0.0,
          FaceBounds{0, 0, 0, 0},
          0.0,
          false,
          FaceDetectionResultSource::None,
      }) {}

bool SyntheticHelperTrackingBackend::start() {
  return session_.start();
}

void SyntheticHelperTrackingBackend::stop() {
  session_.stop();
}

TrackingSample SyntheticHelperTrackingBackend::track(
    const PreprocessedFrame& frame) {
  const long long frameTimestampMs = frame.cameraFrame.timestampMs;
  const HelperTrackOutcome outcome = session_.track(frameTimestampMs);
  if (!outcome.ok) {
    // Safe fallback: a neutral lost sample for this frame. No stale helper
    // tracking is ever reused after a failure.
    HelperTrackingResult lost;
    lost.timestampMs = frameTimestampMs;
    lost.status = HelperTrackingStatus::Lost;
    return createTrackingSampleFromHelperResult(lost);
  }
  return createTrackingSampleFromHelperResult(outcome.result);
}

const FaceDetectionDiagnostics&
SyntheticHelperTrackingBackend::lastDetectionDiagnostics() const {
  return diagnostics_;
}

}  // namespace lvk::tracker
