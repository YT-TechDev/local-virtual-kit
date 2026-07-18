#include "tracking_backend.h"

#include "helper_tracking_result.h"

#include <iostream>
#include <memory>
#include <utility>

#if LVK_HAS_OPENCV_CAMERA
#include "helper_frame_packet.h"

#include <cstdint>
#include <opencv2/core.hpp>
#include <stdexcept>
#include <vector>
#endif

namespace lvk::tracker {

// v0.13.0 (#587): the sole categories a helper-track()-path terminal failure
// may report. LaunchFailure/ReadyTimeout are start()-only and already
// surfaced by main.cpp's generic startup error; ShutdownTimeout is stop()-only
// and already surfaced by the existing shutdown-incomplete diagnostic below.
// None means no failure.
//
// This whitelist is necessary but NOT sufficient for the start/ready
// exclusion: MalformedMessage and ChildExit stay authorized here because a
// genuine track()-path failure legitimately reports them, yet start() can also
// end Failed with either one. Origin is enforced separately, by arming only
// after a successful start() -- see armHelperSessionTerminalDiagnostic below.
//
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

// v0.13.0 (#587): arms the terminal-failure diagnostic for this session, and
// only ever on a successful start(). Both helper backends call this from their
// own start(), passing their own per-session disposition; no other transition
// into ArmedAfterSuccessfulStart exists.
//
// This is the start/ready exclusion that the category whitelist above cannot
// provide on its own: MalformedMessage and ChildExit are reachable from
// start() (config validation, ready handshake) as well as from track(), so a
// failed start() leaves the session Failed with a category the whitelist
// authorizes. Staying disarmed in that case suppresses it by origin, which is
// the fact the backend already knows, rather than by category.
//
// It cannot hide a genuine track()-path failure: while disarmed, start() has
// never succeeded, so the session never reached Ready, and trackInternal()
// returns immediately on a non-Running state without ever touching the child.
// There is no track()-path failure to observe in that state.
//
// Guarding on SuppressedUntilStarted makes repeated start() calls safe in both
// directions: after a failed start() the session stays Failed and start()
// keeps returning false, so the backend stays disarmed; after a successful
// start() a redundant start() returns true from the Ready/Running early exit,
// which must not re-arm an already Reported session and re-open the one-line
// bound.
static void armHelperSessionTerminalDiagnostic(
    bool startSucceeded, HelperTerminalDiagnosticDisposition& disposition) {
  if (startSucceeded &&
      disposition ==
          HelperTerminalDiagnosticDisposition::SuppressedUntilStarted) {
    disposition =
        HelperTerminalDiagnosticDisposition::ArmedAfterSuccessfulStart;
  }
}

// v0.13.0 (#587): shared internal reporter at the existing helper-session
// public-diagnostic ownership boundary (the same boundary that already emits
// the shutdown-incomplete line below). Both SyntheticHelperTrackingBackend and
// FrameHelperTrackingBackend call this from their track() path, after the
// session exchange for this frame has completed. Emits at most one
// "[helper-session] session failed (category=<label>)" stderr line per
// backend/session: `disposition` is the caller's own per-session state, so a
// fresh backend/session always starts clean and never inherits a prior
// session's reported-or-suppressed disposition. Fires only when the session
// was armed by a successful start() (see above) and state() == Failed is
// first observed with an authorized track-path category; never triggers on
// HelperTrackOutcome::ok == false alone (a legitimate no-face result keeps the
// session Running and never reaches here). Reads only the existing
// lastDiagnostic() accessor and prints only its fixed
// helperDiagnosticCategoryLabel() -- never raw child/exception text -- and
// never mutates session state, return values, or control flow.
static void reportHelperSessionTerminalFailure(
    const HelperProcessSession& session,
    HelperTerminalDiagnosticDisposition& disposition) {
  if (disposition !=
          HelperTerminalDiagnosticDisposition::ArmedAfterSuccessfulStart ||
      session.state() != HelperSessionState::Failed) {
    return;
  }
  const HelperDiagnosticCategory category = session.lastDiagnostic();
  if (!isTerminalFailureTrackCategory(category)) {
    return;
  }
  disposition = HelperTerminalDiagnosticDisposition::Reported;
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
  const bool started = session_.start();
  armHelperSessionTerminalDiagnostic(started, terminalDiagnostic_);
  return started;
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
  reportHelperSessionTerminalFailure(session_, terminalDiagnostic_);
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
    std::size_t backendLabelBytes,
    RecoveryPolicy recoveryPolicy)
    // retainedConfig_ is declared before session_, so it copies the config
    // (for exact #589 reconstruction) while `config` is still intact, before
    // session_ moves from it.
    : retainedConfig_(config),
      session_(std::make_unique<HelperProcessSession>(std::move(config))),
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
      }),
      recoveryPolicy_(recoveryPolicy),
      recoveryBudget_(
          recoveryPolicy == RecoveryPolicy::SingleAttempt ? 1 : 0) {}

bool FrameHelperTrackingBackend::start() {
  // Null-safe: a backend can only reach here with a constructed session, but
  // fail closed rather than dereference if a replacement ever left it null.
  if (!session_) {
    return false;
  }
  const bool started = session_->start();
  armHelperSessionTerminalDiagnostic(started, terminalDiagnostic_);
  return started;
}

void FrameHelperTrackingBackend::stop() {
  if (!session_) {
    return;
  }
  session_->stop();
  // Surface only a generic, path-free category if a healthy session did not shut
  // down cleanly (no valid stopped line and/or a forced termination). Never
  // forwards raw child output.
  const HelperDiagnosticCategory category = session_->shutdownDiagnostic();
  if (category != HelperDiagnosticCategory::None) {
    std::cerr << "[helper-session] shutdown incomplete (category="
              << helperDiagnosticCategoryLabel(category) << ")\n";
  }
}

// v0.13.0 (#589): the single, bounded, MediaPipe-route-only recovery. Evaluated
// at the beginning of the next track() entry, AFTER the timeout-triggering
// frame already returned LOST and emitted its #587 terminal line. It destroys
// the Failed ResultTimeout generation through the existing
// ~HelperProcessSession() and constructs a fresh generation from
// retainedConfig_. The synthetic frame-helper route is Disabled and returns
// here unchanged; other terminal categories, non-terminal failures, canonical
// LOST, and legitimate no-face never reach the reconstruction below.
void FrameHelperTrackingBackend::maybeRecoverAfterResultTimeout() {
  // Closed, code-owned policy: only the MediaPipe route opts in.
  if (recoveryPolicy_ != RecoveryPolicy::SingleAttempt) {
    return;
  }
  // Lifetime budget: at most one attempt, never replenished.
  if (recoveryBudget_ <= 0) {
    return;
  }
  // Fail closed on a missing session; never dereference null.
  if (!session_) {
    return;
  }
  // Exact trigger. Every condition must hold for the current owned session:
  //  - the #587 line was already reported for this generation, proving it
  //    started successfully and its terminal track-path failure was reported
  //    (Reported is unreachable without a prior successful start());
  //  - the session is terminally Failed;
  //  - the terminal category is exactly ResultTimeout (not MalformedMessage,
  //    ChildExit, FrameWriteTimeout, FrameAckMismatch, or any start/ready/stop
  //    category).
  if (terminalDiagnostic_ != HelperTerminalDiagnosticDisposition::Reported) {
    return;
  }
  if (session_->state() != HelperSessionState::Failed) {
    return;
  }
  if (session_->lastDiagnostic() != HelperDiagnosticCategory::ResultTimeout) {
    return;
  }

  // Spend the single lifetime attempt now, before the replacement's start
  // result is known, so a failed replacement can never be retried and the
  // budget stays consumed even if allocation/start below fails.
  --recoveryBudget_;

  // v0.13.0 (#592): resolve how the failed generation's directly owned child
  // was released or transferred, through the single shared cleanup entry
  // point, before gen1 is destroyed below. NotApplicable (the pre-resolution
  // enum default) is normalized to Unknown here at the reporting boundary --
  // it must never be emitted for a valid recovery attempt.
  HelperChildCleanupDisposition gen1CleanupDisposition =
      session_->resolveChildCleanup();
  if (gen1CleanupDisposition == HelperChildCleanupDisposition::NotApplicable) {
    gen1CleanupDisposition = HelperChildCleanupDisposition::Unknown;
  }

  // Destroy the failed generation through the existing ~HelperProcessSession()
  // -- bounded stop() plus the allocation-free, noexcept emergency
  // child-ownership resolution it already runs if stop() throws. Old-generation
  // destruction completes here, before any replacement becomes authoritative or
  // exchanges a frame; no stale pipe/request/result id can cross generations.
  // resolveChildCleanup() was already called above, so this destruction is
  // inert through the existing cleaned_ guard -- stop() is never retried.
  session_.reset();

  // v0.13.0 (#592): exactly one fixed gen1-cleanup disposition line for this
  // actual recovery attempt, emitted before gen2 construction/start and
  // therefore before the existing #591 recovery-outcome line below. Contains
  // only this fixed literal text and one fixed enum label -- never raw
  // exception text, paths, pids, timing, or frame/session data.
  std::cerr << "[helper-session] recovery gen1-cleanup (disposition="
            << helperChildCleanupDispositionLabel(gen1CleanupDisposition)
            << ")\n";

  // Reset the #587 disposition for the new generation. The failed generation
  // latched Reported, which armHelperSessionTerminalDiagnostic() intentionally
  // will not re-arm; the replacement must start clean so its own first terminal
  // track-path failure can still report exactly one line.
  terminalDiagnostic_ =
      HelperTerminalDiagnosticDisposition::SuppressedUntilStarted;

  // Construct and start a fresh generation from the retained config. Any
  // failure here fails closed: session_ is left null and, because the budget is
  // already spent, no further attempt ever occurs. Local exception containment
  // exposes no raw exception text or private path and leaves child ownership
  // resolved (a partially-started replacement is destroyed through its own
  // destructor by reset()).
  //
  // v0.13.0 (#589 recovery-outcome observability): replacementDiagnostic is
  // captured here, before any catch cleanup could ever run, and defaults to
  // None so both the exception path and a null replacement map to the fixed
  // "none" label below -- never raw exception text.
  bool replacementStarted = false;
  HelperDiagnosticCategory replacementDiagnostic = HelperDiagnosticCategory::None;
  try {
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    // Deterministic test-only exception path for the recovery-outcome smoke's
    // "none" case. Never reachable outside a test-seam build; recoveryTestOverride_
    // defaults to None, which never throws here.
    if (recoveryTestOverride_ == RecoveryTestOverride::ForceConstructThrow) {
      throw std::runtime_error(
          "lvk-589-recovery-test: forced replacement construction failure");
    }
    // Temporarily apply a fixed, closed replacement-only override to the
    // retained config for the smoke's three replacement-start-failure cases,
    // then restore it immediately after construction -- the construction call
    // below stays the exact approved `retainedConfig_` form in every build.
    const HelperSessionConfig savedRetainedConfigForTest = retainedConfig_;
    if (recoveryTestOverride_ == RecoveryTestOverride::ForceLaunchFailure) {
      retainedConfig_.executablePath += "-lvk-589-recovery-test-missing";
    } else if (
        recoveryTestOverride_ == RecoveryTestOverride::ForceReadyTimeout) {
      // A zero-budget ready wait times out on its very first check, before
      // ever polling the child, regardless of how quickly it would have
      // responded -- deterministic, not a race.
      retainedConfig_.readyTimeoutMs = 0;
    } else if (
        recoveryTestOverride_ == RecoveryTestOverride::ForceMalformedReady) {
      retainedConfig_.expectedReadySource =
          "lvk-589-recovery-test-invalid-ready-source";
    }
#endif
    session_ = std::make_unique<HelperProcessSession>(retainedConfig_);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    retainedConfig_ = savedRetainedConfigForTest;
#endif
    replacementStarted = session_->start();
    if (!replacementStarted) {
      replacementDiagnostic = session_->lastDiagnostic();
    }
  } catch (...) {
    session_.reset();
    replacementStarted = false;
  }

  // Arm the replacement generation only on a successful start; a failed
  // start/ready stays suppressed and emits no #587 track-path line for it.
  armHelperSessionTerminalDiagnostic(replacementStarted, terminalDiagnostic_);

  // v0.13.0 (#589 recovery-outcome observability): exactly one fixed
  // recovery-outcome stderr line for this actual recovery attempt (this
  // point is only reached after the exact trigger matched and the single
  // lifetime budget was spent above). Contains only this fixed literal text
  // and, on failure, an existing helperDiagnosticCategoryLabel() result --
  // never raw exception text, paths, pids, or frame/session data.
  if (replacementStarted) {
    std::cerr << "[helper-session] recovery succeeded\n";
  } else {
    std::cerr << "[helper-session] recovery failed (category="
              << helperDiagnosticCategoryLabel(replacementDiagnostic) << ")\n";
  }
}

TrackingSample FrameHelperTrackingBackend::track(
    const PreprocessedFrame& frame) {
  const long long frameTimestampMs = frame.cameraFrame.timestampMs;

  // v0.13.0 (#589): evaluate the single, bounded, MediaPipe-route-only recovery
  // at the very beginning of the call -- after the previous frame already
  // returned LOST and emitted its #587 terminal line. The timeout-triggering
  // frame itself never recovers; recovery begins here, on the following
  // track() entry.
  maybeRecoverAfterResultTimeout();

  // Fail closed if no session is available (e.g. a replacement allocation/start
  // could not complete). Never dereference a null session.
  if (!session_) {
    HelperTrackingResult lost;
    lost.timestampMs = frameTimestampMs;
    lost.status = HelperTrackingStatus::Lost;
    return createTrackingSampleFromHelperResult(lost);
  }

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
      outcome = session_->trackWithFrame(frameTimestampMs, pixelView);
    }
  }

  reportHelperSessionTerminalFailure(*session_, terminalDiagnostic_);
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
    // Synthetic frame-helper route: recovery Disabled (#589). This route
    // retains its current fail-closed-to-LOST behavior on every terminal
    // category, including ResultTimeout.
    : backend_(
          std::move(config),
          "synthetic-frame-helper",
          sizeof("synthetic-frame-helper") - 1,
          FrameHelperTrackingBackend::RecoveryPolicy::Disabled) {}

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
    // MediaPipe Face Landmarker route: the single approved opt-in to exactly
    // one lifetime ResultTimeout recovery attempt (#589).
    : backend_(
          std::move(config),
          "mediapipe-face-landmarker",
          sizeof("mediapipe-face-landmarker") - 1,
          FrameHelperTrackingBackend::RecoveryPolicy::SingleAttempt) {}

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
