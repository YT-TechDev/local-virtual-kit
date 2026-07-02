#include "face_detector.h"

namespace lvk::tracker {

const char* faceDetectionResultSourceLabel(FaceDetectionResultSource source) {
  switch (source) {
    case FaceDetectionResultSource::Fresh:
      return "fresh";
    case FaceDetectionResultSource::Held:
      return "held";
    case FaceDetectionResultSource::None:
      break;
  }

  return "none";
}

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
      FaceDetectionResultSource::None,
  };
}

}  // namespace lvk::tracker
