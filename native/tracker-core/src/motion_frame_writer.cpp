#include "motion_frame_writer.h"

#include <iomanip>

namespace lvk::tracker {

void writeMotionFrameJson(std::ostream &output, const TrackingSample &sample) {
  output << std::fixed << std::setprecision(6);
  output << "{"
         << "\"schemaVersion\":1,"
         << "\"timestampMs\":" << sample.timestampMs << ","
         << "\"source\":\"native\","
         << "\"tracking\":{\"status\":\"tracking\",\"confidence\":1},"
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
