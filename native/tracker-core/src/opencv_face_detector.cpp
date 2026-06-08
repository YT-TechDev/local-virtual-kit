#include "opencv_face_detector.h"

#include <algorithm>
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

#include <vector>

namespace lvk::tracker {
namespace {

FaceDetectionResult noFaceResult() {
  return FaceDetectionResult{
      false,
      0.0,
      FaceBounds{0, 0, 0, 0},
  };
}

int faceArea(const cv::Rect& face) {
  return face.width * face.height;
}

bool isBetterFace(const cv::Rect& candidate, const cv::Rect& currentBest) {
  const int candidateArea = faceArea(candidate);
  const int currentBestArea = faceArea(currentBest);

  if (candidateArea != currentBestArea) {
    return candidateArea > currentBestArea;
  }

  if (candidate.y != currentBest.y) {
    return candidate.y < currentBest.y;
  }

  return candidate.x < currentBest.x;
}

}  // namespace

OpenCvFaceDetector::OpenCvFaceDetector(const std::string& cascadePath) {
  if (cascadePath.empty()) {
    return;
  }

  isReady_ = classifier_.load(cascadePath);
}

bool OpenCvFaceDetector::isReady() const {
  return isReady_;
}

FaceDetectionResult OpenCvFaceDetector::detect(const PreprocessedFrame& frame) {
  if (!isReady_ || frame.image.empty()) {
    return noFaceResult();
  }

  cv::Mat grayscale;
  if (frame.image.channels() == 1) {
    grayscale = frame.image;
  } else if (frame.image.channels() == 3) {
    cv::cvtColor(frame.image, grayscale, cv::COLOR_BGR2GRAY);
  } else if (frame.image.channels() == 4) {
    cv::cvtColor(frame.image, grayscale, cv::COLOR_BGRA2GRAY);
  } else {
    return noFaceResult();
  }

  std::vector<cv::Rect> faces;
  classifier_.detectMultiScale(grayscale, faces);

  if (faces.empty()) {
    return noFaceResult();
  }

  const auto selectedFace = *std::max_element(
      faces.begin(), faces.end(), [](const cv::Rect& left, const cv::Rect& right) {
        return isBetterFace(right, left);
      });

  return FaceDetectionResult{
      true,
      1.0,
      FaceBounds{
          selectedFace.x,
          selectedFace.y,
          selectedFace.width,
          selectedFace.height,
      },
  };
}

}  // namespace lvk::tracker
