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

 private:
  // Only these explicitly trusted wrappers may construct this backend. Any
  // future caller must be added here explicitly; there is no public
  // construction path.
  friend class SyntheticFrameHelperTrackingBackend;
  friend class MediaPipeFaceLandmarkerHelperTrackingBackend;

  FrameHelperTrackingBackend(
      HelperSessionConfig config,
      const char* backendLabel,
      std::size_t backendLabelBytes);

  HelperProcessSession session_;
  FaceDetectionDiagnostics diagnostics_;
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

 private:
  FrameHelperTrackingBackend backend_;
};
#endif

}  // namespace lvk::tracker
