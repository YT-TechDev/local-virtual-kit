#pragma once

#include "face_detector.h"
#include "tracker.h"

namespace lvk::tracker {

TrackingSample createLostTrackingSample(const PreprocessedFrame& frame);
TrackingSample createTrackingSampleFromFaceDetection(
    const PreprocessedFrame& frame,
    const FaceDetectionResult& detection);
double clampTrackingConfidence(double confidence);

}  // namespace lvk::tracker
