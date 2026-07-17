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

// v0.13.0 (#587): the sole categories a helper-track()-path terminal failure
// may report. LaunchFailure/ReadyTimeout are start()-only and already
// surfaced by main.cpp's generic startup error; ShutdownTimeout is stop()-only
// and already surfaced by the existing shutdown-incomplete diagnostic below.
// None means no failure. This closed whitelist is the explicit start/ready
// exclusion guard even if track() is ever called after a failed start().
// File-static (rather than an anonymous namespace, which the existing
// FrameHelperTrackingBackend label-validation block below already owns) so
// this internal-linkage helper doesn't disturb that block's identity.
static bool isTerminalFailureTrackCategory(HelperDiagnosticCategory category) {
  switch (category) {
  case HelperDiagnosticCategory::ResultTimeout:
  case HelperDiagnosticCategory::MalformedMessage:
  case HelperDiagnosticCategory::ChildExit:
  case HelperDiagnosticCategory::FrameWriteTimeout:
  case HelperDiagnosticCategory::FrameAckMismatch:
    return true;
  case HelperDiagnosticCategory::None:
  case HelperDiagnosticCategory::LaunchFailure:
  case HelperDiagnosticCategory::ReadyTimeout:
  case HelperDiagnosticCategory::ShutdownTimeout:
    return false;
  }
  return false;
}

// v0.13.0 (#587): shared internal reporter at the existing helper-session
// public-diagnostic ownership boundary (the same boundary that already emits
// the shutdown-incomplete line below). Both SyntheticHelperTrackingBackend and
// FrameHelperTrackingBackend call this from their track() path, after the
// session exchange for this frame has completed. Emits at most one
// "[helper-session] session failed (category=<label>)" stderr line per
// backend/session: `reported` is the caller's own per-session latch, so a
// fresh backend/session always starts clean. Only fires the first time
// session.state() == Failed is observed with an authorized track-path
// category; never triggers on HelperTrackOutcome::ok == false alone (a
// legitimate no-face result keeps the session Running and never reaches
// here). Reads only the existing lastDiagnostic() accessor and prints only
// its fixed helperDiagnosticCategoryLabel() -- never raw child/exception
// text -- and never mutates session state, return values, or control flow.
static void reportHelperSessionTerminalFailure(
    const HelperProcessSession& session, bool& reported) {
  if (reported || session.state() != HelperSessionState::Failed) {
    return;
  }
  const HelperDiagnosticCategory category = session.lastDiagnostic();
  if (!isTerminalFailureTrackCategory(category)) {
    return;
  }
  reported = true;
  std::cerr << "[helper-session] session failed (category="
            << helperDiagnosticCategoryLabel(category) << ")\n";
}

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
  reportHelperSessionTerminalFailure(session_, terminalFailureReported_);
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
namespace {

// Safe bytes only: non-empty, bounded, lowercase ASCII letters/digits/hyphen.
// This is internal-misuse protection only -- the public constructor accepts
// nothing but a code-owned string literal -- so a rejected label never
// reaches here in practice, and its bytes are never printed.
bool isValidFrameHelperBackendLabel(const char* data, std::size_t len) {
  if (data == nullptr || len == 0 || len > kMaxFrameHelperBackendLabelBytes) {
    return false;
  }
  for (std::size_t i = 0; i < len; ++i) {
    const char c = data[i];
    const bool lowerAlpha = c >= 'a' && c <= 'z';
    const bool digit = c >= '0' && c <= '9';
    const bool hyphen = c == '-';
    if (!lowerAlpha && !digit && !hyphen) {
      return false;
    }
  }
  return true;
}

constexpr char kFrameHelperFallbackLabel[] = "frame-helper";

}  // namespace

FrameHelperTrackingBackend::FrameHelperTrackingBackend(
    HelperSessionConfig config,
    const char* backendLabel,
    std::size_t backendLabelBytes)
    : session_(std::move(config)),
      diagnostics_(FaceDetectionDiagnostics{
          isValidFrameHelperBackendLabel(backendLabel, backendLabelBytes)
              ? std::string(backendLabel, backendLabelBytes)
              : std::string(kFrameHelperFallbackLabel),
          false,
          0.0,
          FaceBounds{0, 0, 0, 0},
          0.0,
          false,
          FaceDetectionResultSource::None,
      }) {}

bool FrameHelperTrackingBackend::start() {
  return session_.start();
}

void FrameHelperTrackingBackend::stop() {
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

TrackingSample FrameHelperTrackingBackend::track(
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

  reportHelperSessionTerminalFailure(session_, terminalFailureReported_);
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
FrameHelperTrackingBackend::lastDetectionDiagnostics() const {
  return diagnostics_;
}

SyntheticFrameHelperTrackingBackend::SyntheticFrameHelperTrackingBackend(
    HelperSessionConfig config)
    : backend_(
          std::move(config),
          "synthetic-frame-helper",
          sizeof("synthetic-frame-helper") - 1) {}

bool SyntheticFrameHelperTrackingBackend::start() {
  return backend_.start();
}

void SyntheticFrameHelperTrackingBackend::stop() {
  backend_.stop();
}

TrackingSample SyntheticFrameHelperTrackingBackend::track(
    const PreprocessedFrame& frame) {
  return backend_.track(frame);
}

const FaceDetectionDiagnostics&
SyntheticFrameHelperTrackingBackend::lastDetectionDiagnostics() const {
  return backend_.lastDetectionDiagnostics();
}

MediaPipeFaceLandmarkerHelperTrackingBackend::MediaPipeFaceLandmarkerHelperTrackingBackend(
    HelperSessionConfig config)
    : backend_(
          std::move(config),
          "mediapipe-face-landmarker",
          sizeof("mediapipe-face-landmarker") - 1) {}

bool MediaPipeFaceLandmarkerHelperTrackingBackend::start() {
  return backend_.start();
}

void MediaPipeFaceLandmarkerHelperTrackingBackend::stop() {
  backend_.stop();
}

TrackingSample MediaPipeFaceLandmarkerHelperTrackingBackend::track(
    const PreprocessedFrame& frame) {
  return backend_.track(frame);
}

const FaceDetectionDiagnostics&
MediaPipeFaceLandmarkerHelperTrackingBackend::lastDetectionDiagnostics()
    const {
  return backend_.lastDetectionDiagnostics();
}
#endif  // LVK_HAS_OPENCV_CAMERA

}  // namespace lvk::tracker
