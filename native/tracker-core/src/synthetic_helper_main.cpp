// Synthetic helper contract smoke (H1a).
//
// This is a tiny, synthetic-only helper executable used to exercise the
// internal Native Core <-> helper JSON contract described in
// docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md. It is NOT wired into Native
// Core process supervision, it is NOT a tracking backend, and its stdout is an
// internal helper contract that is intentionally distinct from MotionFrame.
//
// Hard constraints (see docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md):
//   - synthetic only: no camera, no files, no models, no sockets, no temp files
//   - never touches raw frames, pixels, or tensors
//   - never emits MotionFrame (no face.position, no public tracking object,
//     no source=native)
//   - stdout: newline-delimited internal helper JSON
//   - stderr: safe diagnostics only (no raw pixels/images/paths/secrets)

#include <chrono>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>

namespace {

constexpr int kDefaultFrameCount = 5;
constexpr int kMaxFrameCount = 100000;
constexpr int kDefaultIntervalMs = 0;
constexpr int kMaxIntervalMs = 600000;
constexpr int kDefaultDelayReadyMs = 0;
constexpr int kMaxDelayReadyMs = 600000;
constexpr int kFailAfterDisabled = -1;
constexpr int kHelperSchemaVersion = 1;
constexpr long long kSyntheticTimestampStepMs = 33; // ~30 synthetic fps

struct HelperOptions {
  int frameCount = kDefaultFrameCount;
  int intervalMs = kDefaultIntervalMs;
  int delayReadyMs = kDefaultDelayReadyMs;
  int failAfter = kFailAfterDisabled;
};

bool parseIntInRange(
    const std::string &value,
    int minValue,
    int maxValue,
    int &parsedValue) {
  char *end = nullptr;
  const long parsed = std::strtol(value.c_str(), &end, 10);

  if (end == value.c_str() || *end != '\0') {
    return false;
  }

  if (parsed < minValue || parsed > maxValue) {
    return false;
  }

  parsedValue = static_cast<int>(parsed);
  return true;
}

void printUsage(std::ostream &output) {
  output << "Usage: lvk-synthetic-helper [--frames N] [--interval-ms N] "
            "[--delay-ready-ms N] [--fail-after N]\n";
  output << "--frames N must be an integer between 0 and " << kMaxFrameCount
         << " (default " << kDefaultFrameCount << ").\n";
  output << "--interval-ms N must be an integer between 0 and " << kMaxIntervalMs
         << " (default " << kDefaultIntervalMs
         << "); it paces synthetic result frames for manual smoke.\n";
  output << "--delay-ready-ms N must be an integer between 0 and "
         << kMaxDelayReadyMs << " (default " << kDefaultDelayReadyMs
         << "); it is a test-only mode that sleeps before emitting the ready "
            "line so a bounded startup timeout can be exercised.\n";
  output << "--fail-after N is a test-only mode that simulates a helper failure "
            "after emitting N synthetic result frames. N must be between 0 and "
         << kMaxFrameCount << ".\n";
  output << "This helper is synthetic only: it does not access a camera, files, "
            "models, sockets, or raw frames, and it does not emit MotionFrame.\n";
}

bool parseHelperOptions(int argc, char *argv[], HelperOptions &options) {
  for (int argIndex = 1; argIndex < argc; ++argIndex) {
    const std::string argument = argv[argIndex];

    if (argument == "--frames") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --frames.\n";
        printUsage(std::cerr);
        return false;
      }

      int frameCount = 0;
      if (!parseIntInRange(argv[argIndex + 1], 0, kMaxFrameCount, frameCount)) {
        std::cerr << "Invalid value for --frames: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.frameCount = frameCount;
      ++argIndex;
      continue;
    }

    if (argument == "--interval-ms") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --interval-ms.\n";
        printUsage(std::cerr);
        return false;
      }

      int intervalMs = 0;
      if (!parseIntInRange(argv[argIndex + 1], 0, kMaxIntervalMs, intervalMs)) {
        std::cerr << "Invalid value for --interval-ms: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.intervalMs = intervalMs;
      ++argIndex;
      continue;
    }

    if (argument == "--delay-ready-ms") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --delay-ready-ms.\n";
        printUsage(std::cerr);
        return false;
      }

      int delayReadyMs = 0;
      if (!parseIntInRange(
              argv[argIndex + 1], 0, kMaxDelayReadyMs, delayReadyMs)) {
        std::cerr << "Invalid value for --delay-ready-ms: "
                  << argv[argIndex + 1] << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.delayReadyMs = delayReadyMs;
      ++argIndex;
      continue;
    }

    if (argument == "--fail-after") {
      if (argIndex + 1 >= argc) {
        std::cerr << "Missing value for --fail-after.\n";
        printUsage(std::cerr);
        return false;
      }

      int failAfter = 0;
      if (!parseIntInRange(argv[argIndex + 1], 0, kMaxFrameCount, failAfter)) {
        std::cerr << "Invalid value for --fail-after: " << argv[argIndex + 1]
                  << "\n";
        printUsage(std::cerr);
        return false;
      }

      options.failAfter = failAfter;
      ++argIndex;
      continue;
    }

    std::cerr << "Unknown argument: " << argument << "\n";
    printUsage(std::cerr);
    return false;
  }

  return true;
}

void writeReadyLine(std::ostream &output) {
  output << "{"
         << "\"type\":\"ready\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"source\":\"synthetic-helper\"}\n";
}

// Emits a synthetic internal helper result line. This is intentionally NOT a
// MotionFrame: there is no face.position, no public tracking object, and no
// source=native. Native Core would map this internal shape to MotionFrame in a
// future supervised integration; that mapping is out of scope for H1a.
void writeResultLine(std::ostream &output, long long timestampMs) {
  output << std::fixed << std::setprecision(6);
  output << "{"
         << "\"type\":\"result\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"timestampMs\":" << timestampMs << ","
         << "\"status\":\"tracking\","
         << "\"confidence\":" << 1.0 << ","
         << "\"faceRotation\":{"
         << "\"pitch\":" << 0.0 << ","
         << "\"yaw\":" << 0.0 << ","
         << "\"roll\":" << 0.0 << "},"
         << "\"eyes\":{"
         << "\"leftOpen\":" << 1.0 << ","
         << "\"rightOpen\":" << 1.0 << "},"
         << "\"mouth\":{"
         << "\"open\":" << 0.0 << ","
         << "\"smile\":" << 0.0 << "},"
         << "\"diag\":{\"inferenceMs\":" << 0.0 << "}}\n";
}

void writeStoppedLine(std::ostream &output, const std::string &reason) {
  output << "{"
         << "\"type\":\"stopped\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"reason\":\"" << reason << "\"}\n";
}

} // namespace

int main(int argc, char *argv[]) {
  if (argc == 2 &&
      (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) {
    printUsage(std::cout);
    return 0;
  }

  HelperOptions options;
  if (!parseHelperOptions(argc, argv, options)) {
    return 1;
  }

  std::cerr << "[helper] startup: source=synthetic-helper\n";

  // Test-only: delay the ready line so a bounded startup timeout can be
  // exercised. With the default of 0 the helper announces readiness
  // immediately, preserving existing behavior. The sleep is placed before the
  // ready line so a supervisor that terminates the child during the delay
  // observes no ready marker on the helper's stdout.
  if (options.delayReadyMs > 0) {
    std::cerr << "[helper] startup: delaying ready emission by "
              << options.delayReadyMs << " ms (reason=synthetic-delay-ready)\n";
    std::this_thread::sleep_for(
        std::chrono::milliseconds(options.delayReadyMs));
  }

  writeReadyLine(std::cout);

  long long emittedResultCount = 0;
  for (int frameIndex = 0; frameIndex < options.frameCount; ++frameIndex) {
    if (options.failAfter != kFailAfterDisabled &&
        emittedResultCount >= options.failAfter) {
      std::cerr << "[helper] error: simulated failure after "
                << emittedResultCount
                << " result frames (reason=simulated-fail-after)\n";
      return 1;
    }

    const long long timestampMs =
        static_cast<long long>(frameIndex) * kSyntheticTimestampStepMs;
    writeResultLine(std::cout, timestampMs);
    ++emittedResultCount;

    if (options.intervalMs > 0) {
      std::cout.flush();
      std::this_thread::sleep_for(std::chrono::milliseconds(options.intervalMs));
    }
  }

  // Honor --fail-after even when it equals the emitted frame count, so a
  // failure can be simulated at the boundary before the stopped line.
  if (options.failAfter != kFailAfterDisabled &&
      emittedResultCount >= options.failAfter) {
    std::cerr << "[helper] error: simulated failure after " << emittedResultCount
              << " result frames (reason=simulated-fail-after)\n";
    return 1;
  }

  writeStoppedLine(std::cout, "completed");
  std::cerr << "[helper] shutdown: reason=completed, emittedResultCount="
            << emittedResultCount << "\n";

  return 0;
}
