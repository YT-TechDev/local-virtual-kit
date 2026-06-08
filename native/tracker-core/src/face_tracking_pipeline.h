#pragma once

#include "face_detector.h"
#include "tracker.h"

namespace lvk::tracker {

class FaceTrackingPipeline {
 public:
  FaceTrackingPipeline(
      FaceDetector& faceDetector,
      MotionTracker& fallbackTracker);

  TrackingSample track(const PreprocessedFrame& frame);

 private:
  FaceDetector& faceDetector_;
  MotionTracker& fallbackTracker_;
};

}  // namespace lvk::tracker
