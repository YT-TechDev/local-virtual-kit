#pragma once

#include "face_detector.h"
#include "face_tracking_pipeline.h"
#include "frame_preprocessor.h"
#include "tracker.h"

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

}  // namespace lvk::tracker
