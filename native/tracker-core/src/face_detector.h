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

struct FaceDetectionResult {
  bool hasFace;
  double confidence;
  FaceBounds bounds;
};

struct FaceDetectionDiagnostics {
  std::string detectorName;
  bool hasFace;
  double confidence;
  FaceBounds bounds;
  double detectionDurationMs;
  bool usedFallbackTracking;
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
