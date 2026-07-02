#pragma once

#include "face_detector.h"

#include <opencv2/objdetect.hpp>

#include <string>

namespace lvk::tracker {

class OpenCvFaceDetector final : public FaceDetector {
 public:
  explicit OpenCvFaceDetector(const std::string& cascadePath);

  bool isReady() const;
  FaceDetectionResult detect(const PreprocessedFrame& frame) override;

 private:
  cv::CascadeClassifier classifier_;
  bool isReady_ = false;

  // Bounded short-hold stabilization state. When OpenCV misses only a very
  // small number of consecutive frames within a short time window, the last
  // accepted face bounds are briefly reused with reduced confidence so that a
  // single missed detection does not immediately become a lost result. This is
  // not real tracking: the hold is strictly bounded so genuine loss still
  // resolves to no face.
  bool hasHeldFace_ = false;
  cv::Rect lastAcceptedFace_{0, 0, 0, 0};
  long long lastAcceptedTimestampMs_ = 0;
  int consecutiveMissCount_ = 0;
};

}  // namespace lvk::tracker
