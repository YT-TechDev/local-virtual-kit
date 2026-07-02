#pragma once

#include "frame_preprocessor.h"

#include <string>

namespace lvk::tracker {

struct FaceBounds {
  int x;
  int y;
  int width;
  int height;
};

// Safe internal diagnostic classification for how a face detection result was
// produced. This is observability only: it never changes MotionFrame output.
// - None:  no face was reported.
// - Fresh: a face was reported directly from a fresh detector detection.
// - Held:  a face was reported from a bounded short-hold of the last accepted
//          bounds while the detector briefly missed. This is not real tracking.
enum class FaceDetectionResultSource {
  None,
  Fresh,
  Held,
};

// Renders a compact, safe log label ("none", "fresh", "held") for a result
// source. Used only in local diagnostic output.
const char* faceDetectionResultSourceLabel(FaceDetectionResultSource source);

struct FaceDetectionResult {
  bool hasFace;
  double confidence;
  FaceBounds bounds;
  FaceDetectionResultSource resultSource;
};

struct FaceDetectionDiagnostics {
  std::string detectorName;
  bool hasFace;
  double confidence;
  FaceBounds bounds;
  double detectionDurationMs;
  bool usedFallbackTracking;
  FaceDetectionResultSource resultSource;
};

class FaceDetector {
 public:
  virtual ~FaceDetector() = default;

  virtual FaceDetectionResult detect(const PreprocessedFrame& frame) = 0;
};

class NoopFaceDetector final : public FaceDetector {
 public:
  FaceDetectionResult detect(const PreprocessedFrame& frame) override;
};

}  // namespace lvk::tracker
