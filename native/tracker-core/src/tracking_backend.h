#pragma once

#include "face_detector.h"
#include "face_tracking_pipeline.h"
#include "frame_preprocessor.h"
#include "helper_process_session.h"
#include "tracker.h"

#include <memory>
#include <string>

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

}  // namespace lvk::tracker
