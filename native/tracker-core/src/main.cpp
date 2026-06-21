#include "camera_source.h"
#include "face_detector.h"
#include "face_tracking_pipeline.h"
#include "frame_preprocessor.h"
#include "helper_runtime_smoke.h"
#include "motion_frame_writer.h"
#include "tracker.h"

#if LVK_HAS_OPENCV_FACE_DETECTOR
#include "opencv_face_detector.h"
#endif

#include <chrono>
#include <csignal>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

#ifndef LVK_HAS_OPENCV_CAMERA
#define LVK_HAS_OPENCV_CAMERA 0
#endif

#ifndef LVK_HAS_OPENCV_FACE_DETECTOR
#define LVK_HAS_OPENCV_FACE_DETECTOR 0
#endif

namespace {

constexpr int kDefaultFrameCount = 120;
constexpr int kMaxFrameCount = 100000;
constexpr int kMaxCameraWidth = 7680;
constexpr int kMaxCameraHeight = 4320;
constexpr int kMaxCameraIndex = 16;
constexpr int kMaxCameraStatusInterval = 100000;
constexpr int kDefaultFaceStatusInterval = 60;
constexpr int kMaxFaceStatusInterval = 100000;
constexpr int kDefaultPipelineStatusInterval = 60;
constexpr int kMaxPipelineStatusInterval = 100000;
constexpr double kMinCameraFps = 1.0;
constexpr double kMaxCameraFps = 240.0;

volatile std::sig_atomic_t gShouldStop = 0;

struct TrackerOptions {
  int frameCount = kDefaultFrameCount;
  bool continuous = false;
  bool realtime = false;
  bool logCameraStatus = false;
  int cameraStatusInterval = 0;
  bool logFaceStatus = false;
  int faceStatusInterval = kDefaultFaceStatusInterval;
  bool logPipelineStatus = false;
  int pipelineStatusInterval = kDefaultPipelineStatusInterval;
  lvk::tracker::CameraSourceOptions camera;
  std::string faceDetectorName = "noop";
  std::string helperRuntimeSmokePath;
  lvk::tracker::HelperRuntimeSmokeCase helperRuntimeSmokeCase =
      lvk::tracker::HelperRuntimeSmokeCase::Normal;
  bool helperRuntimeSmokeCaseSet = false;
  std::string faceCascadePath;
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

bool parseNonNegativeIntegerInRange(
    const std::string &value,
    int maxValue,
    int &parsedValue) {
  char *end = nullptr;
  const long parsed = std::strtol(value.c_str(), &end, 10);

  if (end == value.c_str() || *end != '\0') {
    return false;
  }

  if (parsed < 0 || parsed > maxValue) {
    return false;
  }

  parsedValue = static_cast<int>(parsed);
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

bool parseDoubleInRange(
    const std::string &value,
    double minValue,
    double maxValue,
    double &parsedValue) {
  char *end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);

  if (end == value.c_str() || *end != '\0') {
    return false;
  }

  if (!std::isfinite(parsed) || parsed < minValue || parsed > maxValue) {
    return false;
  }

  parsedValue = parsed;
  return true;
}

void printUsage(std::ostream &output) {
  output << "Usage: lvk-tracker-core [--frames N] [--continuous] [--realtime] "
            "[--log-camera-status] [--camera-status-interval N] "
            "[--log-face-status] [--face-status-interval N] "
            "[--log-pipeline-status] [--pipeline-status-interval N] "
            "[--camera-source dummy|opencv] [--camera-index N] [--camera-width N] "
            "[--camera-height N] [--camera-fps N] "
            "[--face-detector noop|opencv] [--face-cascade PATH] "
            "[--helper-runtime-smoke PATH [--helper-runtime-smoke-case normal|launch-failure|nonzero-exit|timeout|unsafe-diagnostic|helper-lifecycle-handshake|helper-lifecycle-handshake-nonzero-exit|helper-lifecycle-handshake-timeout|helper-lifecycle-handshake-missing-ready|helper-lifecycle-handshake-missing-stopped]]\n";
  output << "--frames N must be an integer between 0 and " << kMaxFrameCount
         << ".\n";
  output << "--continuous emits frames until the process is stopped.\n";
  output << "--realtime emits frames at the configured camera nominal FPS.\n";
  output << "--log-camera-status writes local camera diagnostics to stderr.\n";
  output << "--camera-status-interval N writes periodic camera diagnostics every N "
         << "emitted frames when --log-camera-status is set. N must be between 1 "
         << "and " << kMaxCameraStatusInterval << ".\n";
  output << "--log-face-status writes safe face detection diagnostics to stderr.\n";
  output << "--face-status-interval N writes periodic face diagnostics every N "
         << "emitted frames when --log-face-status is set. N must be between 1 "
         << "and " << kMaxFaceStatusInterval << ".\n";
  output << "--log-pipeline-status writes safe pipeline timing diagnostics to stderr.\n";
  output << "--pipeline-status-interval N writes periodic pipeline diagnostics every N "
         << "emitted frames when --log-pipeline-status is set. N must be "
         << "between 1 and " << kMaxPipelineStatusInterval << ".\n";
  output << "--camera-source selects the camera source; supported values are 'dummy' and 'opencv'.\n";
  output << "--camera-index N must be an integer between 0 and "
         << kMaxCameraIndex << ".\n";
  output << "--camera-width N must be an integer between 1 and "
         << kMaxCameraWidth << ".\n";
  output << "--camera-height N must be an integer between 1 and "
         << kMaxCameraHeight << ".\n";
  output << "--camera-fps N must be between " << kMinCameraFps << " and "
         << kMaxCameraFps << ".\n";
  output << "--face-detector selects the face detector; supported values are 'noop' and 'opencv'.\n";
  output << "--face-cascade PATH provides the external OpenCV Haar cascade XML path required by --face-detector opencv.\n";
  output << "--helper-runtime-smoke PATH runs the explicit synthetic helper runtime integration smoke and keeps default tracking unchanged when omitted.\n";
  output << "--helper-runtime-smoke-case selects a smoke-only helper runtime case and is only valid when --helper-runtime-smoke PATH is provided; supported values are normal, launch-failure, nonzero-exit, timeout, unsafe-diagnostic, helper-lifecycle-handshake, helper-lifecycle-handshake-nonzero-exit, helper-lifecycle-handshake-timeout, helper-lifecycle-handshake-missing-ready, and helper-lifecycle-handshake-missing-stopped. Defaults to normal.\n";
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
         << "emittedFrameCount=" << diagnostics.emittedFrameCount << ", "
         << "cameraIndex=" << diagnostics.cameraIndex << ", "
         << "backendName=" << diagnostics.backendName << ", "
         << "failedReadCount=" << diagnostics.failedReadCount;

  if (effectiveFps > 0.0) {
    output << ", effectiveFps=" << effectiveFps;
  }

  output << "\n";
}

void writeFaceStatus(
    std::ostream &output,
    const std::string &label,
    const lvk::tracker::FaceDetectionDiagnostics &diagnostics) {
  output << "[face] " << label << ": "
         << "detectorName=" << diagnostics.detectorName << ", "
         << "hasFace=" << (diagnostics.hasFace ? "true" : "false") << ", "
         << "confidence=" << diagnostics.confidence << ", "
         << "bounds={"
         << "x=" << diagnostics.bounds.x << ", "
         << "y=" << diagnostics.bounds.y << ", "
         << "width=" << diagnostics.bounds.width << ", "
         << "height=" << diagnostics.bounds.height << "}, "
         << "detectionDurationMs=" << diagnostics.detectionDurationMs << ", "
         << "usedFallbackTracking="
         << (diagnostics.usedFallbackTracking ? "true" : "false") << "\n";
}

struct PipelineTimingDiagnostics {
  long long emittedFrameCount;
  double captureDurationMs;
  double preprocessDurationMs;
  double trackingDurationMs;
  double writeDurationMs;
  double totalFrameDurationMs;
};

double elapsedMilliseconds(
    const std::chrono::steady_clock::time_point &startedAt,
    const std::chrono::steady_clock::time_point &stoppedAt) {
  return std::chrono::duration<double, std::milli>(stoppedAt - startedAt)
      .count();
}

void writePipelineStatus(
    std::ostream &output,
    const std::string &label,
    const PipelineTimingDiagnostics &diagnostics) {
  output << "[pipeline] " << label << ": "
         << "emittedFrameCount=" << diagnostics.emittedFrameCount << ", "
         << "captureDurationMs=" << diagnostics.captureDurationMs << ", "
         << "preprocessDurationMs=" << diagnostics.preprocessDurationMs << ", "
         << "trackingDurationMs=" << diagnostics.trackingDurationMs << ", "
         << "writeDurationMs=" << diagnostics.writeDurationMs << ", "
         << "totalFrameDurationMs=" << diagnostics.totalFrameDurationMs << "\n";
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

    if (argument == "--log-face-status") {
      options.logFaceStatus = true;
      continue;
    }

    if (argument == "--log-pipeline-status") {
      options.logPipelineStatus = true;
      continue;
    }

    if (argument == "--pipeline-status-interval") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --pipeline-status-interval.\n";
        printUsage(std::cerr);
        return false;
      }

      int pipelineStatusInterval = 0;
      if (!parsePositiveIntegerInRange(
              argv[argIndex + 1],
              kMaxPipelineStatusInterval,
              pipelineStatusInterval)) {
        std::cerr << "Invalid value for --pipeline-status-interval: "
                  << argv[argIndex + 1] << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.pipelineStatusInterval = pipelineStatusInterval;
      ++argIndex;
      continue;
    }

    if (argument == "--face-status-interval") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --face-status-interval.\n";
        printUsage(std::cerr);
        return false;
      }

      int faceStatusInterval = 0;
      if (!parsePositiveIntegerInRange(
              argv[argIndex + 1],
              kMaxFaceStatusInterval,
              faceStatusInterval)) {
        std::cerr << "Invalid value for --face-status-interval: "
                  << argv[argIndex + 1] << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.faceStatusInterval = faceStatusInterval;
      ++argIndex;
      continue;
    }

    if (argument == "--camera-status-interval") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --camera-status-interval.\n";
        printUsage(std::cerr);
        return false;
      }

      int cameraStatusInterval = 0;
      if (!parsePositiveIntegerInRange(
              argv[argIndex + 1],
              kMaxCameraStatusInterval,
              cameraStatusInterval)) {
        std::cerr << "Invalid value for --camera-status-interval: "
                  << argv[argIndex + 1] << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.cameraStatusInterval = cameraStatusInterval;
      ++argIndex;
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

    if (argument == "--camera-index") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --camera-index.\n";
        printUsage(std::cerr);
        return false;
      }

      int cameraIndex = 0;
      if (!parseNonNegativeIntegerInRange(
              argv[argIndex + 1], kMaxCameraIndex, cameraIndex)) {
        std::cerr << "Invalid value for --camera-index: "
                  << argv[argIndex + 1] << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.camera.cameraIndex = cameraIndex;
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
      if (!parseDoubleInRange(
              argv[argIndex + 1], kMinCameraFps, kMaxCameraFps, nominalFps)) {
        std::cerr << "Invalid value for --camera-fps: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.camera.nominalFps = nominalFps;
      ++argIndex;
      continue;
    }

    if (argument == "--helper-runtime-smoke") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --helper-runtime-smoke.\n";
        printUsage(std::cerr);
        return false;
      }

      options.helperRuntimeSmokePath = argv[argIndex + 1];
      ++argIndex;
      continue;
    }

    if (argument == "--helper-runtime-smoke-case") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --helper-runtime-smoke-case.\n";
        printUsage(std::cerr);
        return false;
      }

      const std::string smokeCase = argv[argIndex + 1];
      if (smokeCase == "normal") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::Normal;
      } else if (smokeCase == "launch-failure") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::LaunchFailure;
      } else if (smokeCase == "nonzero-exit") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::NonzeroExit;
      } else if (smokeCase == "timeout") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::Timeout;
      } else if (smokeCase == "unsafe-diagnostic") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::UnsafeDiagnostic;
      } else if (smokeCase == "helper-lifecycle-handshake") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::HelperLifecycleHandshake;
      } else if (smokeCase == "helper-lifecycle-handshake-nonzero-exit") {
        options.helperRuntimeSmokeCase = lvk::tracker::HelperRuntimeSmokeCase::
            HelperLifecycleHandshakeNonzeroExit;
      } else if (smokeCase == "helper-lifecycle-handshake-timeout") {
        options.helperRuntimeSmokeCase =
            lvk::tracker::HelperRuntimeSmokeCase::HelperLifecycleHandshakeTimeout;
      } else if (smokeCase == "helper-lifecycle-handshake-missing-ready") {
        options.helperRuntimeSmokeCase = lvk::tracker::HelperRuntimeSmokeCase::
            HelperLifecycleHandshakeMissingReady;
      } else if (smokeCase == "helper-lifecycle-handshake-missing-stopped") {
        options.helperRuntimeSmokeCase = lvk::tracker::HelperRuntimeSmokeCase::
            HelperLifecycleHandshakeMissingStopped;
      } else {
        std::cerr << "Unsupported --helper-runtime-smoke-case: " << smokeCase
                  << ". Supported values are normal, launch-failure, "
                  << "nonzero-exit, timeout, unsafe-diagnostic, "
                  << "helper-lifecycle-handshake, "
                  << "helper-lifecycle-handshake-nonzero-exit, "
                  << "helper-lifecycle-handshake-timeout, "
                  << "helper-lifecycle-handshake-missing-ready, and "
                  << "helper-lifecycle-handshake-missing-stopped.\n";
        printUsage(std::cerr);
        return false;
      }

      options.helperRuntimeSmokeCaseSet = true;
      ++argIndex;
      continue;
    }

    if (argument == "--face-detector") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --face-detector.\n";
        printUsage(std::cerr);
        return false;
      }

      const std::string faceDetectorName = argv[argIndex + 1];
      if (faceDetectorName != "noop" && faceDetectorName != "opencv") {
        std::cerr << "Unsupported face detector: " << faceDetectorName
                  << ". Supported values are 'noop' and 'opencv'.\n";
        printUsage(std::cerr);
        return false;
      }

      options.faceDetectorName = faceDetectorName;
      ++argIndex;
      continue;
    }

    if (argument == "--face-cascade") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --face-cascade.\n";
        printUsage(std::cerr);
        return false;
      }

      options.faceCascadePath = argv[argIndex + 1];
      ++argIndex;
      continue;
    }

    std::cerr << "Unknown argument: " << argument << "\n";
    printUsage(std::cerr);
    return false;
  }

  // A helper runtime smoke case only has meaning when the explicit synthetic
  // helper runtime smoke is actually invoked via --helper-runtime-smoke PATH.
  // Selecting a case without the path used to be parsed and then silently
  // ignored as the run fell through to the default camera runtime. Make that
  // checker-only assumption explicit and fail closed instead of silently
  // discarding the requested helper runtime state.
  if (options.helperRuntimeSmokeCaseSet &&
      options.helperRuntimeSmokePath.empty()) {
    std::cerr << "--helper-runtime-smoke-case requires --helper-runtime-smoke "
                 "PATH.\n";
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

  if (!options.helperRuntimeSmokePath.empty()) {
    return lvk::tracker::runHelperRuntimeSmoke(
        lvk::tracker::HelperRuntimeSmokeOptions{
            options.helperRuntimeSmokePath,
            options.frameCount,
            options.helperRuntimeSmokeCase,
        },
        std::cout,
        std::cerr);
  }

  auto cameraSource = lvk::tracker::createCameraSource(options.camera);
  if (!cameraSource) {
    if (options.camera.sourceName == "opencv" && !LVK_HAS_OPENCV_CAMERA) {
      std::cerr << "OpenCV camera source is not enabled in this build. "
                   "Install OpenCV development packages and reconfigure.\n";
    } else {
      std::cerr << "Unsupported camera source: " << options.camera.sourceName
                << ". Supported values are 'dummy' and 'opencv'.\n";
    }
    return 1;
  }

  std::unique_ptr<lvk::tracker::FaceDetector> faceDetector;
  if (options.faceDetectorName == "noop") {
    faceDetector = std::make_unique<lvk::tracker::NoopFaceDetector>();
  } else if (options.faceDetectorName == "opencv") {
#if LVK_HAS_OPENCV_FACE_DETECTOR
    if (options.faceCascadePath.empty()) {
      std::cerr << "--face-detector opencv requires --face-cascade PATH.\n";
      return 1;
    }

    auto openCvFaceDetector =
        std::make_unique<lvk::tracker::OpenCvFaceDetector>(
            options.faceCascadePath);
    if (!openCvFaceDetector->isReady()) {
      std::cerr << "Failed to load OpenCV face cascade: "
                << options.faceCascadePath << "\n";
      return 1;
    }

    faceDetector = std::move(openCvFaceDetector);
#else
    std::cerr << "OpenCV face detector is not enabled in this build. "
                 "Install OpenCV development packages with imgproc/objdetect "
                 "support and reconfigure.\n";
    return 1;
#endif
  }

  lvk::tracker::NoopFramePreprocessor framePreprocessor;
  lvk::tracker::DummyMotionTracker motionTracker;
  lvk::tracker::FaceTrackingPipeline trackingPipeline(
      *faceDetector, motionTracker, options.faceDetectorName);
  if (!cameraSource->start()) {
    std::cerr << "Failed to start local camera source: "
              << options.camera.sourceName << ".\n";
    return 1;
  }

  if (options.logCameraStatus) {
    writeCameraStatus(std::cerr, "startup", cameraSource->diagnostics());
  }

  if (options.logFaceStatus) {
    writeFaceStatus(
        std::cerr, "startup", trackingPipeline.lastDetectionDiagnostics());
  }

  auto nextFrameTime = std::chrono::steady_clock::now();
  const auto startedAt = std::chrono::steady_clock::now();

  for (long long frameIndex = 0;
       gShouldStop == 0 &&
       (options.continuous || frameIndex < options.frameCount);
       ++frameIndex) {
    lvk::tracker::CameraFrame cameraFrame{};
    const auto captureStartedAt = std::chrono::steady_clock::now();
    if (!cameraSource->nextFrame(cameraFrame)) {
      std::cerr << "Local camera source stopped before all frames were "
                   "emitted.\n";
      if (options.logCameraStatus) {
        writeCameraStatus(
            std::cerr, "capture-failure", cameraSource->diagnostics());
      }
      cameraSource->stop();
      return 1;
    }
    const auto captureStoppedAt = std::chrono::steady_clock::now();

    const auto preprocessStartedAt = std::chrono::steady_clock::now();
    const auto preprocessedFrame = framePreprocessor.process(cameraFrame);
    const auto preprocessStoppedAt = std::chrono::steady_clock::now();

    const auto trackingStartedAt = std::chrono::steady_clock::now();
    const auto trackingSample = trackingPipeline.track(preprocessedFrame);
    const auto trackingStoppedAt = std::chrono::steady_clock::now();

    const auto writeStartedAt = std::chrono::steady_clock::now();
    lvk::tracker::writeMotionFrameJson(std::cout, trackingSample);
    if (options.realtime) {
      std::cout.flush();
    }
    const auto writeStoppedAt = std::chrono::steady_clock::now();

    const auto frameStoppedAt = writeStoppedAt;
    const auto cameraDiagnostics = cameraSource->diagnostics();
    const PipelineTimingDiagnostics pipelineDiagnostics{
        cameraDiagnostics.emittedFrameCount,
        elapsedMilliseconds(captureStartedAt, captureStoppedAt),
        elapsedMilliseconds(preprocessStartedAt, preprocessStoppedAt),
        elapsedMilliseconds(trackingStartedAt, trackingStoppedAt),
        elapsedMilliseconds(writeStartedAt, writeStoppedAt),
        elapsedMilliseconds(captureStartedAt, frameStoppedAt)};

    if (options.logPipelineStatus &&
        pipelineDiagnostics.emittedFrameCount %
                options.pipelineStatusInterval ==
            0) {
      writePipelineStatus(std::cerr, "periodic", pipelineDiagnostics);
    }

    if (options.logFaceStatus &&
        cameraDiagnostics.emittedFrameCount % options.faceStatusInterval == 0) {
      writeFaceStatus(
          std::cerr, "periodic",
          trackingPipeline.lastDetectionDiagnostics());
    }

    if (options.logCameraStatus && options.cameraStatusInterval > 0 &&
        cameraDiagnostics.emittedFrameCount % options.cameraStatusInterval ==
            0) {
      writeCameraStatus(
          std::cerr, "periodic", cameraDiagnostics);
    }

    if (options.realtime) {
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
