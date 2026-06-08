#include "motion_frame_writer.h"

#include <algorithm>
#include <cmath>
#include <iomanip>

namespace lvk::tracker {
namespace {

const char *trackingStatusToString(TrackingStatus status) {
  switch (status) {
  case TrackingStatus::NotStarted:
    return "not_started";
  case TrackingStatus::Tracking:
    return "tracking";
  case TrackingStatus::Lost:
    return "lost";
  }

  return "lost";
}

double clampConfidence(double confidence) {
  if (!std::isfinite(confidence)) {
    return 0.0;
  }

  return std::clamp(confidence, 0.0, 1.0);
}

} // namespace

void writeMotionFrameJson(std::ostream &output, const TrackingSample &sample) {
  const double confidence = clampConfidence(sample.confidence);

  output << std::fixed << std::setprecision(6);
  output << "{"
         << "\"schemaVersion\":1,"
         << "\"timestampMs\":" << sample.timestampMs << ","
         << "\"source\":\"native\","
         << "\"tracking\":{\"status\":\""
         << trackingStatusToString(sample.status) << "\",\"confidence\":"
         << confidence << "},"
         << "\"face\":{"
         << "\"position\":{"
         << "\"x\":" << sample.facePosition.x << ","
         << "\"y\":" << sample.facePosition.y << ","
         << "\"z\":" << sample.facePosition.z << "},"
         << "\"rotation\":{"
         << "\"pitch\":" << sample.faceRotation.pitch << ","
         << "\"yaw\":" << sample.faceRotation.yaw << ","
         << "\"roll\":" << sample.faceRotation.roll << "}},"
         << "\"eyes\":{"
         << "\"leftOpen\":" << sample.leftEyeOpen << ","
         << "\"rightOpen\":" << sample.rightEyeOpen << ","
         << "\"gaze\":{"
         << "\"x\":" << sample.gaze.x << ","
         << "\"y\":" << sample.gaze.y << "}},"
         << "\"mouth\":{"
         << "\"open\":" << sample.mouthOpen << ","
         << "\"smile\":" << sample.mouthSmile << "}}\n";
}

} // namespace lvk::tracker
