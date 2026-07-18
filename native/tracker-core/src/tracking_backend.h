#pragma once

#include "face_detector.h"
#include "face_tracking_pipeline.h"
#include "frame_preprocessor.h"
#include "helper_process_session.h"
#include "tracker.h"

#include <cstddef>
#include <memory>
#include <string>

#ifndef LVK_HAS_OPENCV_CAMERA
#define LVK_HAS_OPENCV_CAMERA 0
#endif

namespace lvk::tracker {

// Native Core-owned seam for tracking backend execution. main.cpp depends on
// this interface instead of owning FaceTrackingPipeline/FaceDetector/
// MotionTracker wiring directly, so future local backend implementations can
// sit behind this boundary without changing CLI behavior or MotionFrame
// output.
class TrackingBackend {
 public:
  virtual ~TrackingBackend() = default;

  // Optional explicit lifecycle. The default backend keeps this trivial; a
  // backend that owns a fallible external resource (e.g. a helper child process)
  // overrides start() so main can fail before opening the camera, and stop() so
  // shutdown is explicit on every exit path. Default backends need no override.
  virtual bool start() { return true; }
  virtual void stop() {}

  virtual TrackingSample track(const PreprocessedFrame& frame) = 0;
  virtual const FaceDetectionDiagnostics& lastDetectionDiagnostics() const = 0;
};

// v0.13.0 (#587): per-session disposition of the helper-session
// terminal-failure diagnostic, owned by each helper backend at the existing
// tracking_backend.cpp diagnostic boundary.
//
// Category alone cannot establish origin: HelperProcessSession::start() sets
// MalformedMessage for an unsupported ready source, an unsupported stderr
// policy, an invalid invocation configuration, or a malformed ready line, and
// its ready handshake can also fail with ChildExit. Both categories are
// equally reachable from the track() path, so state() == Failed plus
// lastDiagnostic() cannot tell a start/ready failure apart from a track()
// failure. The backend, however, already knows the one fact that does
// distinguish them: whether start() ever succeeded. Recording that here
// excludes every start/ready failure by construction instead of by category,
// without touching HelperProcessSession or adding a second lifecycle
// mechanism.
enum class HelperTerminalDiagnosticDisposition {
  // start() has not succeeded for this session (a fresh backend's initial
  // state, and the permanent state of a backend whose start() failed).
  // Reporting is disarmed: any Failed state observable here originated at or
  // before the ready handshake, which is outside this track()-path-only
  // contract -- main.cpp already reports a generic startup error for it -- so
  // it stays intentionally suppressed, including when a caller defensively
  // calls track() after a failed start().
  SuppressedUntilStarted,
  // start() succeeded, so any later terminal failure can only have come from
  // the track() path. The first one reports.
  ArmedAfterSuccessfulStart,
  // The single allowed line has been emitted for this session; never again.
  Reported,
};

// Current default backend: wraps the existing FaceTrackingPipeline (which in
// turn wraps the selected FaceDetector and the DummyMotionTracker fallback).
class FaceTrackingPipelineBackend final : public TrackingBackend {
 public:
  FaceTrackingPipelineBackend(
      FaceDetector& faceDetector,
      MotionTracker& fallbackTracker,
      std::string detectorName);

  TrackingSample track(const PreprocessedFrame& frame) override;
  const FaceDetectionDiagnostics& lastDetectionDiagnostics() const override;

 private:
  FaceTrackingPipeline pipeline_;
};

// v0.13.0 opt-in synthetic helper backend (#533). Development-only: drives the
// reusable Native Core-owned helper session (one request/result exchange per
// track()) and maps the compact helper result into a TrackingSample via the
// existing createTrackingSampleFromHelperResult boundary. On any helper failure
// it returns a safe lost sample and never reuses stale tracking. It sends no
// camera frame pixels to the helper (that is #534). Not the default backend.
class SyntheticHelperTrackingBackend final : public TrackingBackend {
 public:
  explicit SyntheticHelperTrackingBackend(HelperSessionConfig config);

  bool start() override;
  void stop() override;
  TrackingSample track(const PreprocessedFrame& frame) override;
  const FaceDetectionDiagnostics& lastDetectionDiagnostics() const override;

 private:
  HelperProcessSession session_;
  FaceDetectionDiagnostics diagnostics_;
  // Per-session disposition of the #587 terminal-failure diagnostic: armed
  // only by a successful start(), then latched to Reported by the first
  // terminal track()-path failure, so at most one
  // "[helper-session] session failed (category=<label>)" line is ever emitted
  // for this backend/session. A fresh backend starts disarmed and never
  // inherits a prior session's disposition.
  HelperTerminalDiagnosticDisposition terminalDiagnostic_ =
      HelperTerminalDiagnosticDisposition::SuppressedUntilStarted;
};

#if LVK_HAS_OPENCV_CAMERA
// Bound on a code-owned frame-helper backend/diagnostic label (#569). Callers
// never supply arbitrary CLI/child/model/script text here; the only accepted
// input is a fixed code-owned string literal, passed by an explicitly
// trusted friend wrapper (see FrameHelperTrackingBackend below).
constexpr std::size_t kMaxFrameHelperBackendLabelBytes = 64;

// v0.13.0 (#569) generalized frame-helper tracking backend. Owns the reusable
// mechanics originally introduced for the opt-in synthetic frame-transport
// helper backend (#534): normalizes the incoming OpenCV frame into a bounded
// contiguous BGR24 payload (via normalizeBgr24Rows in helper_frame_packet.h --
// the same function pure smoke tests use) and sends it to the helper over the
// private frame pipe, correlated by the existing requestId. Development-only:
// requires --camera-source opencv and is compiled only when
// LVK_HAS_OPENCV_CAMERA=1; never available otherwise. On any normalization or
// transport failure it returns a safe lost sample and never reuses stale
// tracking. Not the default backend.
//
// The backend/diagnostic label has no public constructor: this class cannot
// be constructed with a label from outside this translation unit's trust
// boundary. Construction is private, and only explicitly trusted wrapper
// classes -- named via `friend` below -- may invoke it. This keeps
// MediaPipe/Python/CLI/child-controlled text out of the generic backend's
// identity by construction access, not by parameter typing (a const
// char-array-reference parameter would still accept a runtime-populated
// fixed-size array, so that shape alone cannot enforce a literal origin).
// An internally invalid label (wrong charset, empty, or over
// kMaxFrameHelperBackendLabelBytes) fails closed to the fixed "frame-helper"
// diagnostic label without throwing or printing the rejected bytes.
class FrameHelperTrackingBackend final : public TrackingBackend {
 public:
  bool start() override;
  void stop() override;
  TrackingSample track(const PreprocessedFrame& frame) override;
  const FaceDetectionDiagnostics& lastDetectionDiagnostics() const override;

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-target-only owner-boundary observability. Compiled ONLY when
  // LVK_HELPER_LIFECYCLE_TEST_SEAM is defined (the bounded-recovery smoke
  // target sets it; lvk-tracker-core never does), so production binaries carry
  // none of this surface. It forwards the owned session's existing
  // cross-platform child-ownership observability -- adding no new
  // HelperProcessSession seam -- so the smoke can assert generation cleanup at
  // this boundary. Exposes no raw pid/HANDLE/path/frame bytes: only a bool and
  // the remaining lifetime recovery budget.
  bool testOnlyDirectlyOwnsChild() const {
    return session_ && session_->testOnlyDirectlyOwnsChild();
  }
  bool testOnlyHasSession() const { return static_cast<bool>(session_); }
  int testOnlyRemainingRecoveryBudget() const { return recoveryBudget_; }
#endif

 private:
  // Only these explicitly trusted wrappers may construct this backend. Any
  // future caller must be added here explicitly; there is no public
  // construction path.
  friend class SyntheticFrameHelperTrackingBackend;
  friend class MediaPipeFaceLandmarkerHelperTrackingBackend;

  // v0.13.0 (#589): closed, code-owned recovery policy for this shared owner
  // boundary. FrameHelperTrackingBackend is shared by the MediaPipe and
  // synthetic frame-helper wrappers, so recovery must not be unconditional.
  // This is not user-configurable and is never derived from backendLabel, CLI
  // text, child/model paths, or any runtime string; it is not part of
  // HelperSessionConfig, the helper protocol, MotionFrame, or any public API.
  // Only the two trusted wrappers below select it: the MediaPipe route opts
  // into exactly one lifetime attempt (SingleAttempt); the synthetic
  // frame-helper route stays Disabled and retains its current behavior.
  enum class RecoveryPolicy {
    Disabled,
    SingleAttempt,
  };

  FrameHelperTrackingBackend(
      HelperSessionConfig config,
      const char* backendLabel,
      std::size_t backendLabelBytes,
      RecoveryPolicy recoveryPolicy);

  // v0.13.0 (#589): evaluated at the very beginning of track(), after the
  // previous frame already returned LOST and emitted its #587 terminal line.
  // Spends at most the single lifetime attempt to destroy a Failed
  // ResultTimeout generation and construct a fresh one from retainedConfig_.
  // See tracking_backend.cpp for the exact trigger and fail-closed teardown.
  void maybeRecoverAfterResultTimeout();

  // v0.13.0 (#589): retained copy of the exact HelperSessionConfig this backend
  // was constructed with, used only to reconstruct a fresh HelperProcessSession
  // for the single approved recovery attempt. Declared before session_ so it is
  // fully initialized before the initial session is constructed from the
  // moved-from constructor argument. Never logged or exposed; may hold a
  // private interpreter/helper/model path.
  HelperSessionConfig retainedConfig_;
  // v0.13.0 (#589): owned helper session held by unique_ptr (not a value
  // member) so the single approved recovery attempt can destroy the failed
  // generation through the existing ~HelperProcessSession() -- bounded stop()
  // plus its allocation-free, noexcept emergency child-ownership resolution --
  // and construct a fresh generation from retainedConfig_. May be null only
  // transiently if a replacement allocation fails; every entry point is
  // null-safe and fails closed.
  std::unique_ptr<HelperProcessSession> session_;
  FaceDetectionDiagnostics diagnostics_;
  // v0.13.0 (#589): the closed recovery policy selected by the constructing
  // wrapper. Only SingleAttempt ever recovers.
  const RecoveryPolicy recoveryPolicy_;
  // v0.13.0 (#589): remaining lifetime recovery attempts. SingleAttempt starts
  // at 1, Disabled at 0. Decremented once when an attempt is spent, and never
  // replenished by success, elapsed time, frame count, session duration, or any
  // other event.
  int recoveryBudget_;

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // v0.13.0 (#589 recovery-outcome observability smoke): fixed, closed enum
  // selecting deterministic REPLACEMENT-generation-only behavior for the
  // bounded-recovery-outcome smoke's four replacement-failure cases. Applied
  // (temporarily, then restored) only to the copy of retainedConfig_ used for
  // the single approved replacement construction inside
  // maybeRecoverAfterResultTimeout() -- it never affects the initial
  // generation, is never derived from a runtime/config/CLI value, and is
  // compiled out of lvk-tracker-core.
  enum class RecoveryTestOverride {
    None,
    ForceLaunchFailure,
    ForceReadyTimeout,
    ForceMalformedReady,
    ForceConstructThrow,
  };
  void setRecoveryTestOverride(RecoveryTestOverride override) {
    recoveryTestOverride_ = override;
  }
  RecoveryTestOverride recoveryTestOverride_ = RecoveryTestOverride::None;
#endif

  // Per-session disposition of the #587 terminal-failure diagnostic: armed
  // only by a successful start(), then latched to Reported by the first
  // terminal track()-path failure, so at most one
  // "[helper-session] session failed (category=<label>)" line is ever emitted
  // per successfully-started session generation. A fresh backend starts
  // disarmed; the #589 recovery attempt explicitly resets this to
  // SuppressedUntilStarted for the replacement generation and re-arms it only
  // on a successful replacement start().
  HelperTerminalDiagnosticDisposition terminalDiagnostic_ =
      HelperTerminalDiagnosticDisposition::SuppressedUntilStarted;
};

// v0.13.0 (#569) thin compatibility wrapper preserving the existing
// SyntheticFrameHelperTrackingBackend identity and one-argument constructor.
// All mechanics (frame validation, normalization, session exchange, mapping,
// fallback, diagnostics, start/stop) live only in FrameHelperTrackingBackend;
// this wrapper is delegation only, via composition (not inheritance), so both
// remain explicit TrackingBackend implementations.
class SyntheticFrameHelperTrackingBackend final : public TrackingBackend {
 public:
  explicit SyntheticFrameHelperTrackingBackend(HelperSessionConfig config);

  bool start() override;
  void stop() override;
  TrackingSample track(const PreprocessedFrame& frame) override;
  const FaceDetectionDiagnostics& lastDetectionDiagnostics() const override;

 private:
  FrameHelperTrackingBackend backend_;
};

// v0.13.0 (#572) thin trusted wrapper composing the merged MediaPipe Face
// Landmarker Python helper route (#568 exact invocation, #569 generic
// frame-helper mechanics, #570 route configuration factory, #571 deterministic
// frame bridge) into a TrackingBackend. All mechanics (frame validation,
// normalization, session exchange, mapping, fallback, diagnostics,
// start/stop) live only in FrameHelperTrackingBackend; this wrapper is
// delegation only, via composition (not inheritance), and owns no
// HelperProcessSession directly. Uses only the fixed code-owned label
// "mediapipe-face-landmarker"; main.cpp never supplies a CLI/child-controlled
// label here. Development-only route; not the default backend.
class MediaPipeFaceLandmarkerHelperTrackingBackend final : public TrackingBackend {
 public:
  explicit MediaPipeFaceLandmarkerHelperTrackingBackend(HelperSessionConfig config);

  bool start() override;
  void stop() override;
  TrackingSample track(const PreprocessedFrame& frame) override;
  const FaceDetectionDiagnostics& lastDetectionDiagnostics() const override;

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-target-only forwarders to the owned FrameHelperTrackingBackend's
  // #589 owner-boundary observability. Compiled out of production
  // lvk-tracker-core; expose no raw pid/HANDLE/path/frame bytes.
  bool testOnlyDirectlyOwnsChild() const {
    return backend_.testOnlyDirectlyOwnsChild();
  }
  int testOnlyRemainingRecoveryBudget() const {
    return backend_.testOnlyRemainingRecoveryBudget();
  }

  // Test-target-only fixed enum + forwarder selecting deterministic
  // REPLACEMENT-generation-only behavior for the #589 recovery-outcome smoke.
  // decltype(backend_) names the owned type without spelling it, so this
  // stays a plain forward of one of five fixed cases -- never a runtime,
  // config, or CLI-derived value. Compiled out of production lvk-tracker-core.
  enum class RecoveryTestOverride {
    None,
    ForceLaunchFailure,
    ForceReadyTimeout,
    ForceMalformedReady,
    ForceConstructThrow,
  };
  void testOnlySetRecoveryOverride(RecoveryTestOverride override) {
    backend_.setRecoveryTestOverride(
        static_cast<decltype(backend_)::RecoveryTestOverride>(override));
  }
#endif

 private:
  FrameHelperTrackingBackend backend_;
};
#endif

}  // namespace lvk::tracker
