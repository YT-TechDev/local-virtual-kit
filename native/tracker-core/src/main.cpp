#include "camera_source.h"
#include "tracker.h"

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>

namespace {

constexpr int kDefaultFrameCount = 120;
constexpr int kMaxFrameCount = 100000;

volatile std::sig_atomic_t gShouldStop = 0;

struct TrackerOptions {
  int frameCount = kDefaultFrameCount;
  bool continuous = false;
  bool realtime = false;
  bool logCameraStatus = false;
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

void printUsage(std::ostream &output) {
  output << "Usage: lvk-tracker-core [--frames N] [--continuous] [--realtime] "
            "[--log-camera-status]\n";
  output << "N must be an integer between 0 and " << kMaxFrameCount << ".\n";
  output << "--continuous emits frames until the process is stopped.\n";
  output << "--realtime emits frames at the dummy camera nominal FPS.\n";
  output << "--log-camera-status writes local dummy camera diagnostics to "
            "stderr.\n";
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

  lvk::tracker::DummyCameraSource cameraSource;
  lvk::tracker::DummyMotionTracker motionTracker;
  if (!cameraSource.start()) {
    std::cerr << "Failed to start local dummy camera source.\n";
    return 1;
  }

  if (options.logCameraStatus) {
    writeCameraStatus(std::cerr, "startup", cameraSource.diagnostics());
  }

  auto nextFrameTime = std::chrono::steady_clock::now();
  const auto startedAt = std::chrono::steady_clock::now();

  for (long long frameIndex = 0;
       gShouldStop == 0 &&
       (options.continuous || frameIndex < options.frameCount);
       ++frameIndex) {
    lvk::tracker::CameraFrame cameraFrame{};
    if (!cameraSource.nextFrame(cameraFrame)) {
      std::cerr << "Local dummy camera source stopped before all frames were "
                   "emitted.\n";
      cameraSource.stop();
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
  cameraSource.stop();

  if (options.logCameraStatus) {
    const auto diagnostics = cameraSource.diagnostics();
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
