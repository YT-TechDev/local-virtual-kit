#include "camera_source.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>

namespace {

constexpr int kDefaultFrameCount = 120;
constexpr int kMaxFrameCount = 100000;

struct Vector2 {
  double x;
  double y;
};

struct Vector3 {
  double x;
  double y;
  double z;
};

struct EulerRotation {
  double pitch;
  double yaw;
  double roll;
};

struct MotionFrameSample {
  long long timestampMs;
  Vector3 facePosition;
  EulerRotation faceRotation;
  double leftEyeOpen;
  double rightEyeOpen;
  Vector2 gaze;
  double mouthOpen;
  double mouthSmile;
};

double clamp(double value, double minValue, double maxValue) {
  return std::max(minValue, std::min(value, maxValue));
}

double wave(
    double base,
    double amplitude,
    double speed,
    double seconds,
    double phase = 0.0) {
  return base + std::sin((seconds * speed) + phase) * amplitude;
}

bool parseFrameCount(const std::string& value, int& frameCount) {
  char* end = nullptr;
  const long parsed = std::strtol(value.c_str(), &end, 10);

  if (end == value.c_str() || *end != '\0') {
    return false;
  }

  if (parsed < 0 || parsed > kMaxFrameCount) {
    return false;
  }

  frameCount = static_cast<int>(parsed);
  return true;
}

int resolveFrameCount(int argc, char* argv[]) {
  if (argc == 1) {
    return kDefaultFrameCount;
  }

  if (argc == 3 && std::string(argv[1]) == "--frames") {
    int frameCount = 0;
    if (parseFrameCount(argv[2], frameCount)) {
      return frameCount;
    }
  }

  std::cerr << "Usage: lvk-tracker-core [--frames N]\n";
  std::cerr << "N must be an integer between 0 and " << kMaxFrameCount << ".\n";
  return -1;
}

MotionFrameSample createDummySample(
    const lvk::tracker::CameraFrame& cameraFrame) {
  const auto timestampMs = cameraFrame.timestampMs;
  const double seconds = static_cast<double>(timestampMs) / 1000.0;

  return MotionFrameSample{
      timestampMs,
      Vector3{
          wave(0.0, 0.05, 0.8, seconds),
          wave(0.0, 0.04, 0.6, seconds),
          0.0,
      },
      EulerRotation{
          wave(0.0, 0.12, 0.7, seconds),
          wave(0.0, 0.18, 0.9, seconds),
          wave(0.0, 0.08, 0.5, seconds),
      },
      clamp(wave(0.85, 0.15, 3.0, seconds), 0.0, 1.0),
      clamp(wave(0.85, 0.15, 3.0, seconds, 0.2), 0.0, 1.0),
      Vector2{
          wave(0.0, 0.25, 0.9, seconds),
          wave(0.0, 0.15, 0.7, seconds),
      },
      clamp(wave(0.25, 0.20, 4.0, seconds), 0.0, 1.0),
      clamp(wave(0.35, 0.15, 0.8, seconds), 0.0, 1.0),
  };
}

void writeMotionFrameJson(std::ostream& output, const MotionFrameSample& sample) {
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

}  // namespace

int main(int argc, char* argv[]) {
  const int frameCount = resolveFrameCount(argc, argv);
  if (frameCount < 0) {
    return 1;
  }

  lvk::tracker::DummyCameraSource cameraSource;
  if (!cameraSource.start()) {
    std::cerr << "Failed to start local dummy camera source.\n";
    return 1;
  }

  for (int frameIndex = 0; frameIndex < frameCount; ++frameIndex) {
    lvk::tracker::CameraFrame cameraFrame{};
    if (!cameraSource.nextFrame(cameraFrame)) {
      std::cerr
          << "Local dummy camera source stopped before all frames were emitted.\n";
      cameraSource.stop();
      return 1;
    }

    writeMotionFrameJson(std::cout, createDummySample(cameraFrame));
  }

  cameraSource.stop();

  return 0;
}
