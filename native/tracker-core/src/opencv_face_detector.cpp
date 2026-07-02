#include "opencv_face_detector.h"

#include <algorithm>
#include <cmath>
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

#include <vector>

namespace lvk::tracker {
namespace {

// Bounded visual stability tuning. These keep a very short OpenCV miss from
// immediately collapsing to a lost result, without hiding genuine loss.
constexpr int kMaxHeldMissFrames = 3;
constexpr long long kMaxHoldDurationMs = 200;

// Reduced confidence reported for held/stabilized detections. This is a bounded
// visual stability value, not a true detector score, so held frames never
// report the 1.0 confidence used for fresh detections.
constexpr double kHeldFaceConfidence = 0.45;

// Interpolation factor applied toward each new detection to lightly smooth
// bounding-box jitter across adjacent frames.
constexpr double kBoundsSmoothingTowardNew = 0.5;

FaceDetectionResult noFaceResult() {
  return FaceDetectionResult{
      false,
      0.0,
      FaceBounds{0, 0, 0, 0},
      FaceDetectionResultSource::None,
  };
}

FaceBounds toFaceBounds(const cv::Rect& face) {
  return FaceBounds{face.x, face.y, face.width, face.height};
}

cv::Rect smoothTowards(
    const cv::Rect& previous,
    const cv::Rect& target,
    double factor) {
  const auto blend = [factor](int from, int to) {
    return static_cast<int>(std::lround(
        static_cast<double>(from) +
        (static_cast<double>(to) - static_cast<double>(from)) * factor));
  };

  return cv::Rect{
      blend(previous.x, target.x),
      blend(previous.y, target.y),
      blend(previous.width, target.width),
      blend(previous.height, target.height),
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
    // Briefly hold the last accepted face across a very small number of missed
    // detections so short flicker does not immediately become a lost result.
    // The hold is bounded by both a miss count and an elapsed-time window so
    // genuine loss still resolves to no face.
    if (hasHeldFace_) {
      consecutiveMissCount_ += 1;
      const long long elapsedMs =
          frame.cameraFrame.timestampMs - lastAcceptedTimestampMs_;
      const bool withinHoldWindow = consecutiveMissCount_ <= kMaxHeldMissFrames &&
                                    elapsedMs >= 0 &&
                                    elapsedMs <= kMaxHoldDurationMs;

      if (withinHoldWindow) {
        return FaceDetectionResult{
            true,
            kHeldFaceConfidence,
            toFaceBounds(lastAcceptedFace_),
            FaceDetectionResultSource::Held,
        };
      }
    }

    hasHeldFace_ = false;
    consecutiveMissCount_ = 0;
    return noFaceResult();
  }

  cv::Rect selectedFace = *std::max_element(
      faces.begin(), faces.end(), [](const cv::Rect& left, const cv::Rect& right) {
        return isBetterFace(right, left);
      });

  // Lightly smooth toward the new detection to reduce bounding-box jitter
  // without over-amplifying Web Preview root movement.
  if (hasHeldFace_) {
    selectedFace =
        smoothTowards(lastAcceptedFace_, selectedFace, kBoundsSmoothingTowardNew);
  }

  lastAcceptedFace_ = selectedFace;
  lastAcceptedTimestampMs_ = frame.cameraFrame.timestampMs;
  hasHeldFace_ = true;
  consecutiveMissCount_ = 0;

  return FaceDetectionResult{
      true,
      1.0,
      toFaceBounds(selectedFace),
      FaceDetectionResultSource::Fresh,
  };
}

}  // namespace lvk::tracker
