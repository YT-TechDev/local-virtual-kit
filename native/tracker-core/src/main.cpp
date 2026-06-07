#include "camera_source.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>

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

struct TrackerOptions {
  int frameCount = kDefaultFrameCount;
  bool realtime = false;
};

double clamp(double value, double minValue, double maxValue) {
  return std::max(minValue, std::min(value, maxValue));
}

double wave(double base, double amplitude, double speed, double seconds,
            double phase = 0.0) {
  return base + std::sin((seconds * speed) + phase) * amplitude;
}

bool parseFrameCount(const std::string &value, int &frameCount) {
  char *end = nullptr;
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

void printUsage(std::ostream &output) {
  output << "Usage: lvk-tracker-core [--frames N] [--realtime]\n";
  output << "N must be an integer between 0 and " << kMaxFrameCount << ".\n";
  output << "--realtime emits frames at the dummy camera nominal FPS.\n";
}

bool parseTrackerOptions(int argc, char *argv[], TrackerOptions &options) {
  for (int argIndex = 1; argIndex < argc; ++argIndex) {
    const std::string argument = argv[argIndex];

    if (argument == "--realtime") {
      options.realtime = true;
      continue;
    }

    if (argument == "--frames") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --frames.\n";
        printUsage(std::cerr);
        return false;
      }

      int frameCount = 0;
      if (!parseFrameCount(argv[argIndex + 1], frameCount)) {
        std::cerr << "Invalid value for --frames: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.frameCount = frameCount;
      ++argIndex;
      continue;
    }

    std::cerr << "Unknown argument: " << argument << "\n";
    printUsage(std::cerr);
    return false;
  }

  return true;
}

void paceNextFrame(std::chrono::steady_clock::time_point &nextFrameTime,
                   const lvk::tracker::CameraFrame &cameraFrame) {
  if (cameraFrame.nominalFps <= 0.0) {
    return;
  }

  nextFrameTime +=
      std::chrono::duration_cast<std::chrono::steady_clock::duration>(
          std::chrono::duration<double>(1.0 / cameraFrame.nominalFps));
  std::this_thread::sleep_until(nextFrameTime);
}

MotionFrameSample
createDummySample(const lvk::tracker::CameraFrame &cameraFrame) {
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

void writeMotionFrameJson(std::ostream &output,
                          const MotionFrameSample &sample) {
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

} // namespace

int main(int argc, char *argv[]) {
  if (argc == 2 &&
      (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) {
    printUsage(std::cout);
    return 0;
  }

  TrackerOptions options;
  if (!parseTrackerOptions(argc, argv, options)) {
    return 1;
  }

  lvk::tracker::DummyCameraSource cameraSource;
  if (!cameraSource.start()) {
    std::cerr << "Failed to start local dummy camera source.\n";
    return 1;
  }

  auto nextFrameTime = std::chrono::steady_clock::now();

  for (int frameIndex = 0; frameIndex < options.frameCount; ++frameIndex) {
    lvk::tracker::CameraFrame cameraFrame{};
    if (!cameraSource.nextFrame(cameraFrame)) {
      std::cerr << "Local dummy camera source stopped before all frames were "
                   "emitted.\n";
      cameraSource.stop();
      return 1;
    }

    writeMotionFrameJson(std::cout, createDummySample(cameraFrame));

    if (options.realtime) {
      std::cout.flush();

      if (frameIndex + 1 < options.frameCount) {
        paceNextFrame(nextFrameTime, cameraFrame);
      }
    }
  }

  cameraSource.stop();

  return 0;
}
