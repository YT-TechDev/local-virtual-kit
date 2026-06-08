#include "face_detector.h"

namespace lvk::tracker {

FaceDetectionResult NoopFaceDetector::detect(const PreprocessedFrame& frame) {
  (void)frame;

  return FaceDetectionResult{
      false,
      0.0,
      FaceBounds{
          0,
          0,
          0,
          0,
      },
  };
}

}  // namespace lvk::tracker
