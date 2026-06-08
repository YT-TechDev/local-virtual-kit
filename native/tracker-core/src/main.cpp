#include "camera_source.h"
#include "tracker.h"

#include <chrono>
#include <csignal>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>

namespace {

constexpr int kDefaultFrameCount = 120;
constexpr int kMaxFrameCount = 100000;
constexpr int kMaxCameraWidth = 7680;
constexpr int kMaxCameraHeight = 4320;
constexpr double kMaxCameraFps = 240.0;

volatile std::sig_atomic_t gShouldStop = 0;

struct TrackerOptions {
  int frameCount = kDefaultFrameCount;
  bool continuous = false;
  bool realtime = false;
  bool logCameraStatus = false;
  lvk::tracker::CameraSourceOptions camera;
};

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

bool parsePositiveIntegerInRange(
    const std::string &value,
    int maxValue,
    int &parsedValue) {
  char *end = nullptr;
  const long parsed = std::strtol(value.c_str(), &end, 10);

  if (end == value.c_str() || *end != '\0') {
    return false;
  }

  if (parsed < 1 || parsed > maxValue) {
    return false;
  }

  parsedValue = static_cast<int>(parsed);
  return true;
}

bool parsePositiveDoubleInRange(
    const std::string &value,
    double maxValue,
    double &parsedValue) {
  char *end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);

  if (end == value.c_str() || *end != '\0') {
    return false;
  }

  if (!std::isfinite(parsed) || parsed <= 0.0 || parsed > maxValue) {
    return false;
  }

  parsedValue = parsed;
  return true;
}

void printUsage(std::ostream &output) {
  output << "Usage: lvk-tracker-core [--frames N] [--continuous] [--realtime] "
            "[--log-camera-status] [--camera-source dummy] "
            "[--camera-width N] [--camera-height N] [--camera-fps N]\n";
  output << "--frames N must be an integer between 0 and " << kMaxFrameCount
         << ".\n";
  output << "--continuous emits frames until the process is stopped.\n";
  output << "--realtime emits frames at the configured camera nominal FPS.\n";
  output << "--log-camera-status writes local camera diagnostics to stderr.\n";
  output << "--camera-source selects the camera source; only 'dummy' is "
            "supported for now.\n";
  output << "--camera-width N must be an integer between 1 and "
         << kMaxCameraWidth << ".\n";
  output << "--camera-height N must be an integer between 1 and "
         << kMaxCameraHeight << ".\n";
  output << "--camera-fps N must be greater than 0 and up to " << kMaxCameraFps
         << ".\n";
}

void handleStopSignal(int) {
  gShouldStop = 1;
}

void writeCameraStatus(
    std::ostream &output,
    const std::string &label,
    const lvk::tracker::CameraSourceDiagnostics &diagnostics,
    double effectiveFps = 0.0) {
  output << "[camera] " << label << ": "
         << "sourceName=" << diagnostics.sourceName << ", "
         << "isRunning=" << (diagnostics.isRunning ? "true" : "false")
         << ", "
         << "width=" << diagnostics.width << ", "
         << "height=" << diagnostics.height << ", "
         << "nominalFps=" << diagnostics.nominalFps << ", "
         << "emittedFrameCount=" << diagnostics.emittedFrameCount;

  if (effectiveFps > 0.0) {
    output << ", effectiveFps=" << effectiveFps;
  }

  output << "\n";
}

bool parseTrackerOptions(int argc, char *argv[], TrackerOptions &options) {
  for (int argIndex = 1; argIndex < argc; ++argIndex) {
    const std::string argument = argv[argIndex];

    if (argument == "--realtime") {
      options.realtime = true;
      continue;
    }

    if (argument == "--continuous") {
      options.continuous = true;
      continue;
    }

    if (argument == "--log-camera-status") {
      options.logCameraStatus = true;
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

    if (argument == "--camera-source") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --camera-source.\n";
        printUsage(std::cerr);
        return false;
      }

      options.camera.sourceName = argv[argIndex + 1];
      ++argIndex;
      continue;
    }

    if (argument == "--camera-width") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --camera-width.\n";
        printUsage(std::cerr);
        return false;
      }

      int width = 0;
      if (!parsePositiveIntegerInRange(
              argv[argIndex + 1], kMaxCameraWidth, width)) {
        std::cerr << "Invalid value for --camera-width: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.camera.width = width;
      ++argIndex;
      continue;
    }

    if (argument == "--camera-height") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --camera-height.\n";
        printUsage(std::cerr);
        return false;
      }

      int height = 0;
      if (!parsePositiveIntegerInRange(
              argv[argIndex + 1], kMaxCameraHeight, height)) {
        std::cerr << "Invalid value for --camera-height: "
                  << argv[argIndex + 1] << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.camera.height = height;
      ++argIndex;
      continue;
    }

    if (argument == "--camera-fps") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --camera-fps.\n";
        printUsage(std::cerr);
        return false;
      }

      double nominalFps = 0.0;
      if (!parsePositiveDoubleInRange(
              argv[argIndex + 1], kMaxCameraFps, nominalFps)) {
        std::cerr << "Invalid value for --camera-fps: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.camera.nominalFps = nominalFps;
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

void writeMotionFrameJson(std::ostream &output,
                          const lvk::tracker::TrackingSample &sample) {
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
  std::signal(SIGINT, handleStopSignal);
  std::signal(SIGTERM, handleStopSignal);

  if (argc == 2 &&
      (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) {
    printUsage(std::cout);
    return 0;
  }

  TrackerOptions options;
  if (!parseTrackerOptions(argc, argv, options)) {
    return 1;
  }

  auto cameraSource = lvk::tracker::createCameraSource(options.camera);
  if (!cameraSource) {
    std::cerr << "Unsupported camera source: " << options.camera.sourceName
              << ". Only 'dummy' is supported for now.\n";
    return 1;
  }

  lvk::tracker::DummyMotionTracker motionTracker;
  if (!cameraSource->start()) {
    std::cerr << "Failed to start local camera source: "
              << options.camera.sourceName << ".\n";
    return 1;
  }

  if (options.logCameraStatus) {
    writeCameraStatus(std::cerr, "startup", cameraSource->diagnostics());
  }

  auto nextFrameTime = std::chrono::steady_clock::now();
  const auto startedAt = std::chrono::steady_clock::now();

  for (long long frameIndex = 0;
       gShouldStop == 0 &&
       (options.continuous || frameIndex < options.frameCount);
       ++frameIndex) {
    lvk::tracker::CameraFrame cameraFrame{};
    if (!cameraSource->nextFrame(cameraFrame)) {
      std::cerr << "Local camera source stopped before all frames were "
                   "emitted.\n";
      cameraSource->stop();
      return 1;
    }

    writeMotionFrameJson(std::cout, motionTracker.track(cameraFrame));

    if (options.realtime) {
      std::cout.flush();

      if (options.continuous || frameIndex + 1 < options.frameCount) {
        paceNextFrame(nextFrameTime, cameraFrame);
      }
    }
  }

  const auto stoppedAt = std::chrono::steady_clock::now();
  cameraSource->stop();

  if (options.logCameraStatus) {
    const auto diagnostics = cameraSource->diagnostics();
    const double elapsedSeconds =
        std::chrono::duration<double>(stoppedAt - startedAt).count();
    const double effectiveFps = elapsedSeconds > 0.0
                                    ? static_cast<double>(
                                          diagnostics.emittedFrameCount) /
                                          elapsedSeconds
                                    : 0.0;
    writeCameraStatus(std::cerr, "shutdown", diagnostics, effectiveFps);
  }

  return 0;
}
