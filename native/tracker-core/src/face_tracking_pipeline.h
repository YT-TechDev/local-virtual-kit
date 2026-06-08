#pragma once

#include "face_detector.h"
#include "tracker.h"

#include <string>

namespace lvk::tracker {

class FaceTrackingPipeline {
 public:
  FaceTrackingPipeline(
      FaceDetector& faceDetector,
      MotionTracker& fallbackTracker,
      std::string detectorName);

  TrackingSample track(const PreprocessedFrame& frame);
  const FaceDetectionDiagnostics& lastDetectionDiagnostics() const;

 private:
  FaceDetector& faceDetector_;
  MotionTracker& fallbackTracker_;
  std::string detectorName_;
  FaceDetectionDiagnostics latestDiagnostics_;
};

}  // namespace lvk::tracker
