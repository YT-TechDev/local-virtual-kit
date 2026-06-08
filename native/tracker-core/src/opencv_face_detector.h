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
};

}  // namespace lvk::tracker
