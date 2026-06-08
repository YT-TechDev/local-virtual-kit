#pragma once

#include "frame_preprocessor.h"

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
