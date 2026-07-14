#include "tracking_backend.h"

#include "helper_tracking_result.h"

#include <iostream>
#include <utility>

#if LVK_HAS_OPENCV_CAMERA
#include "helper_frame_packet.h"

#include <cstdint>
#include <opencv2/core.hpp>
#include <vector>
#endif

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
  // Surface only a generic, path-free category if a healthy session did not shut
  // down cleanly (no valid stopped line and/or a forced termination). Never
  // forwards raw child output.
  const HelperDiagnosticCategory category = session_.shutdownDiagnostic();
  if (category != HelperDiagnosticCategory::None) {
    std::cerr << "[helper-session] shutdown incomplete (category="
              << helperDiagnosticCategoryLabel(category) << ")\n";
  }
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

#if LVK_HAS_OPENCV_CAMERA
SyntheticFrameHelperTrackingBackend::SyntheticFrameHelperTrackingBackend(
    HelperSessionConfig config)
    : session_(std::move(config)),
      diagnostics_(FaceDetectionDiagnostics{
          "synthetic-frame-helper",
          false,
          0.0,
          FaceBounds{0, 0, 0, 0},
          0.0,
          false,
          FaceDetectionResultSource::None,
      }) {}

bool SyntheticFrameHelperTrackingBackend::start() {
  return session_.start();
}

void SyntheticFrameHelperTrackingBackend::stop() {
  session_.stop();
  // Surface only a generic, path-free category if a healthy session did not shut
  // down cleanly (no valid stopped line and/or a forced termination). Never
  // forwards raw child output.
  const HelperDiagnosticCategory category = session_.shutdownDiagnostic();
  if (category != HelperDiagnosticCategory::None) {
    std::cerr << "[helper-session] shutdown incomplete (category="
              << helperDiagnosticCategoryLabel(category) << ")\n";
  }
}

TrackingSample SyntheticFrameHelperTrackingBackend::track(
    const PreprocessedFrame& frame) {
  const long long frameTimestampMs = frame.cameraFrame.timestampMs;

  // Only a valid CV_8UC3 CPU image with dimensions matching the preprocessed
  // frame is eligible for transport; anything else fails closed to safe lost
  // tracking without ever touching the helper for this frame.
  const bool validImage = !frame.image.empty() &&
      frame.image.type() == CV_8UC3 && frame.image.rows == frame.height &&
      frame.image.cols == frame.width;

  HelperTrackOutcome outcome;
  if (validImage) {
    std::vector<std::uint8_t> payload;
    // Strips any source row padding (non-contiguous cv::Mat) into a bounded
    // contiguous BGR24 payload. This is the ONLY row-copy implementation
    // used anywhere in the codebase; the pure frame-transport smoke exercises
    // the exact same function against a deliberately strided buffer.
    const FrameNormalizeStatus normalizeStatus = normalizeBgr24Rows(
        frame.image.data, static_cast<std::uint32_t>(frame.width),
        static_cast<std::uint32_t>(frame.height),
        static_cast<std::uint32_t>(frame.image.step), payload);
    if (normalizeStatus == FrameNormalizeStatus::Ok) {
      FramePixelView pixelView{
          payload.data(), static_cast<std::uint32_t>(frame.width),
          static_cast<std::uint32_t>(frame.height)};
      outcome = session_.trackWithFrame(frameTimestampMs, pixelView);
    }
  }

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
SyntheticFrameHelperTrackingBackend::lastDetectionDiagnostics() const {
  return diagnostics_;
}
#endif  // LVK_HAS_OPENCV_CAMERA

}  // namespace lvk::tracker
