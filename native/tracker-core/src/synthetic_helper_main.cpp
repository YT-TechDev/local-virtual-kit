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
// Filler size for the synthetic oversized-line test mode. Bounded to a few KB
// (not multi-MB) so the test stays deterministic and memory-safe.
constexpr int kSyntheticOversizedFillerBytes = 2048;

struct HelperOptions {
  int frameCount = kDefaultFrameCount;
  int intervalMs = kDefaultIntervalMs;
  int delayReadyMs = kDefaultDelayReadyMs;
  int failAfter = kFailAfterDisabled;
  bool emitUnknownType = false;
  bool emitMalformedLine = false;
  bool emitOversizedLine = false;
  bool emitGracefulShutdown = false;
  bool emitTimeoutForcedShutdown = false;
  bool emitUnsafeDiagnostic = false;
  bool skipReady = false;
  bool skipStopped = false;
  bool emitMalformedReady = false;
  bool emitMalformedResultSchema = false;
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
            "[--delay-ready-ms N] [--emit-unknown-type] [--emit-malformed-line] "
            "[--emit-oversized-line] [--emit-graceful-shutdown] "
            "[--emit-timeout-forced-shutdown] [--fail-after N] "
            "[--skip-ready] [--skip-stopped] [--emit-malformed-ready] "
            "[--emit-malformed-result-schema]\n";
  output << "--frames N must be an integer between 0 and " << kMaxFrameCount
         << " (default " << kDefaultFrameCount << ").\n";
  output << "--interval-ms N must be an integer between 0 and " << kMaxIntervalMs
         << " (default " << kDefaultIntervalMs
         << "); it paces synthetic result frames for manual smoke.\n";
  output << "--delay-ready-ms N must be an integer between 0 and "
         << kMaxDelayReadyMs << " (default " << kDefaultDelayReadyMs
         << "); it is a test-only mode that sleeps before emitting the ready "
            "line so a bounded startup timeout can be exercised.\n";
  output << "--emit-unknown-type is a test-only mode that emits one extra "
            "synthetic helper-style line carrying an unknown type after the "
            "ready line; the helper otherwise completes normally. It stays "
            "synthetic only and is not a MotionFrame.\n";
  output << "--emit-malformed-line is a test-only mode that emits one short, "
            "intentionally invalid helper-output line after the ready line; the "
            "helper otherwise completes normally. It stays synthetic only and is "
            "not a MotionFrame.\n";
  output << "--emit-oversized-line is a test-only mode that emits one bounded "
            "oversized helper-output line (a marker plus safe filler, a few KB) "
            "after the ready line; the helper otherwise completes normally. It "
            "stays synthetic only and is not a MotionFrame.\n";
  output << "--emit-graceful-shutdown is a test-only mode that, on the clean "
            "completion path, emits one private synthetic \"stopping\" lifecycle "
            "marker line just before the \"stopped\" line, then exits 0; it "
            "models the helper-side of a graceful shutdown. It is smoke-local / "
            "test-only, is helper-driven (NOT a response to a real parent stop "
            "message; no parent-to-child control channel exists), stays synthetic "
            "only, and is not a MotionFrame.\n";
  output << "--emit-timeout-forced-shutdown is a test-only mode that, on the "
            "clean completion path, emits one private synthetic \"stopping\" "
            "lifecycle marker followed by one private synthetic "
            "\"shutdown-timeout\" marker just before the \"stopped\" line, then "
            "exits 0; it models a stopping -> synthetic shutdown-timeout -> clean "
            "terminal exit sequence. It is smoke-local / test-only and "
            "helper-driven: there is NO real parent stop message, NO real forced "
            "kill, and NO production shutdown-timeout policy; the helper simply "
            "exits cleanly. It stays synthetic only and is not a MotionFrame.\n";
  output << "--emit-unsafe-diagnostic is a test-only mode that emits one stderr "
            "line that intentionally violates the safe-diagnostic contract (it "
            "omits the required \"[helper] \" prefix), modeling an unsafe "
            "diagnostic that Native Core must treat as a policy violation and "
            "fail closed. The line is a benign synthetic marker only: it carries "
            "no raw data, paths, secrets, pixels, tensors, or model contents. The "
            "helper otherwise completes normally and is not a MotionFrame.\n";
  output << "--skip-ready is a test-only mode that skips emitting the \"ready\" "
            "lifecycle boundary line; the helper otherwise completes normally "
            "(emits result frames, the \"stopped\" line, and exits 0). It is "
            "smoke-local / test-only and models a missing-ready failure vector "
            "so Native Core can confirm it fails closed when the ready boundary "
            "is absent. It stays synthetic only and is not a MotionFrame.\n";
  output << "--skip-stopped is a test-only mode that emits the \"ready\" "
            "lifecycle boundary line and result frames normally, but skips "
            "emitting the \"stopped\" lifecycle boundary line before exiting 0. "
            "It is smoke-local / test-only and models a missing-stopped failure "
            "vector so Native Core can confirm it fails closed when the stopped "
            "boundary is absent. It stays synthetic only and is not a "
            "MotionFrame.\n";
  output << "--emit-malformed-ready is a test-only mode that emits a \"ready\" "
            "line with an invalid schema version (schemaVersion:10 instead of 1) "
            "in place of the normal ready line; the helper otherwise completes "
            "normally (emits result frames, the \"stopped\" line, and exits 0). "
            "The value 10 is chosen to directly test that the lifecycle "
            "observation does not accept schemaVersion via a bare substring "
            "match of \"schemaVersion\":1 (which would match schemaVersion:10). "
            "It is smoke-local / test-only and models a malformed-ready failure "
            "vector so Native Core can confirm it fails closed when the ready "
            "line is present but carries an invalid schema version. It stays "
            "synthetic only and is not a MotionFrame.\n";
  output << "--emit-malformed-result-schema is a test-only mode that emits one "
            "\"result\" line with an invalid schema version (schemaVersion:10 "
            "instead of 1) before the normal result frames; the helper otherwise "
            "completes normally (emits the ready line, valid result frames, the "
            "\"stopped\" line, and exits 0). The value 10 is chosen to directly "
            "test that the normal helper-runtime smoke parser does not accept "
            "schemaVersion via a bare substring match of \"schemaVersion\":1 "
            "(which would match schemaVersion:10). It is smoke-local / test-only "
            "and models a malformed-result failure vector so Native Core can "
            "confirm the normal parse path fails closed when a result line "
            "carries an invalid schema version. It stays synthetic only and is "
            "not a MotionFrame.\n";
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

    if (argument == "--emit-unknown-type") {
      options.emitUnknownType = true;
      continue;
    }

    if (argument == "--emit-malformed-line") {
      options.emitMalformedLine = true;
      continue;
    }

    if (argument == "--emit-oversized-line") {
      options.emitOversizedLine = true;
      continue;
    }

    if (argument == "--emit-timeout-forced-shutdown") {
      options.emitTimeoutForcedShutdown = true;
      continue;
    }

    if (argument == "--emit-graceful-shutdown") {
      options.emitGracefulShutdown = true;
      continue;
    }

    if (argument == "--emit-unsafe-diagnostic") {
      options.emitUnsafeDiagnostic = true;
      continue;
    }

    if (argument == "--skip-ready") {
      options.skipReady = true;
      continue;
    }

    if (argument == "--skip-stopped") {
      options.skipStopped = true;
      continue;
    }

    if (argument == "--emit-malformed-ready") {
      options.emitMalformedReady = true;
      continue;
    }

    if (argument == "--emit-malformed-result-schema") {
      options.emitMalformedResultSchema = true;
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

// Emits a malformed "ready" line with an invalid schema version (10 instead of
// 1). The value 10 is chosen deliberately: it shares the digit "1" with the
// valid version, so the lifecycle observation must NOT rely on a bare
// "schemaVersion":1 substring match (which would also match "schemaVersion":10)
// and must instead match the exact boundary "schemaVersion":1, or
// "schemaVersion":1}. It is intentionally NOT a MotionFrame and contains no
// raw data, paths, secrets, pixels, tensors, or model contents. Smoke-local /
// test-only.
void writeMalformedReadyLine(std::ostream &output) {
  output << "{"
         << "\"type\":\"ready\","
         << "\"schemaVersion\":10,"
         << "\"source\":\"synthetic-helper\"}\n";
}

// Emits a single safe, synthetic helper-style line carrying an unknown type.
// Native Core would ignore such a line with a safe diagnostic (no state
// corruption); this models the unknown_message_type_safe_ignore vector. It is
// intentionally NOT a MotionFrame and contains no raw data, paths, secrets,
// pixels, tensors, or model contents.
void writeUnknownTypeLine(std::ostream &output) {
  output << "{"
         << "\"type\":\"unknown-synthetic\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"source\":\"synthetic-helper\"}\n";
}

// Emits a single short, intentionally invalid helper-output line. It opens like
// a helper object but is not parseable helper JSON (missing delimiters and a
// closing brace), modeling a malformed line that must not corrupt Native Core's
// lifecycle handling. It is intentionally NOT a MotionFrame, carries the distinct
// marker "malformed-synthetic", and contains no raw data, paths, secrets, pixels,
// tensors, or model contents. It deliberately omits the ready/result/stopped
// markers so it cannot perturb lifecycle reconstruction.
void writeMalformedLine(std::ostream &output) {
  output << "{\"type\":\"malformed-synthetic\" this-is-not-valid-helper-json\n";
}

// Emits a single deterministic oversized helper-output line: the distinct marker
// "oversized-synthetic" followed by kSyntheticOversizedFillerBytes safe filler
// characters. The line is bounded to a few KB so a smoke can exercise an
// oversized-line size check without memory pressure. It is intentionally NOT a
// MotionFrame and contains only the marker and repeated safe filler -- no raw
// data, paths, secrets, pixels, tensors, or model contents. It deliberately omits
// the ready/result/stopped markers so it cannot perturb lifecycle reconstruction.
void writeOversizedLine(std::ostream &output) {
  output << "oversized-synthetic";
  for (int fillerIndex = 0; fillerIndex < kSyntheticOversizedFillerBytes;
       ++fillerIndex) {
    output << 'x';
  }
  output << "\n";
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

// Emits a single synthetic internal helper "result" line with an INVALID schema
// version (10 instead of 1). The value 10 is chosen deliberately: it shares the
// digit "1" with the valid version, so the normal helper-runtime smoke parser must
// NOT rely on a bare "schemaVersion":1 substring match (which would also match
// "schemaVersion":10) and must instead match the exact boundary "schemaVersion":1,
// or "schemaVersion":1}. The line is otherwise a well-formed result shape so that,
// before the exact-boundary fix, a prefix match would wrongly accept it and map it
// to a MotionFrame. It is intentionally NOT a MotionFrame and contains no raw data,
// paths, secrets, pixels, tensors, or model contents. Smoke-local / test-only.
void writeMalformedResultSchemaLine(std::ostream &output, long long timestampMs) {
  output << std::fixed << std::setprecision(6);
  output << "{"
         << "\"type\":\"result\","
         << "\"schemaVersion\":10,"
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

// Emits a single private synthetic "stopping" lifecycle marker line. It models
// the helper-side of a graceful shutdown: the helper announces it is stopping
// just before its clean "stopped" line. It is intentionally NOT a MotionFrame,
// carries the distinct type "stopping", and contains no raw data, paths,
// secrets, pixels, tensors, or model contents. It is smoke-local / test-only and
// helper-driven: there is no parent-to-child control channel, so this is NOT a
// response to a real parent "stop" message.
void writeStoppingLine(std::ostream &output, const std::string &reason) {
  output << "{"
         << "\"type\":\"stopping\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"reason\":\"" << reason << "\"}\n";
}

// Emits a single private synthetic "shutdown-timeout" lifecycle marker line. It
// models a graceful stop that did not complete within a bounded smoke window, so
// a shutdown-timeout / forced-exit-style terminal outcome is observed. It is
// intentionally NOT a MotionFrame, carries the distinct type "shutdown-timeout",
// and contains no raw data, paths, secrets, pixels, tensors, or model contents.
// It is smoke-local / test-only and helper-driven: there is no parent-to-child
// control channel and no real forced termination; the helper still exits cleanly.
void writeShutdownTimeoutLine(std::ostream &output, const std::string &reason) {
  output << "{"
         << "\"type\":\"shutdown-timeout\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"reason\":\"" << reason << "\"}\n";
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

  // Test-only: skip the "ready" lifecycle boundary so Native Core can confirm it
  // fails closed when the ready boundary is absent. The helper otherwise
  // completes normally (emits result frames, the "stopped" line, and exits 0).
  // --emit-malformed-ready takes precedence and emits a malformed ready line in
  // place of the normal one.
  if (options.emitMalformedReady) {
    std::cerr << "[helper] startup: emitting malformed ready line "
                 "(reason=synthetic-malformed-ready)\n";
    writeMalformedReadyLine(std::cout);
  } else if (!options.skipReady) {
    writeReadyLine(std::cout);
  } else {
    std::cerr << "[helper] startup: skipping ready line "
                 "(reason=synthetic-skip-ready)\n";
  }

  // Test-only: emit one synthetic helper-style line with an unknown type after
  // ready. The helper otherwise continues normally, modeling an unknown message
  // that Native Core would ignore without corrupting the lifecycle.
  if (options.emitUnknownType) {
    std::cerr << "[helper] emitting synthetic unknown-type line "
                 "(reason=synthetic-unknown-type)\n";
    writeUnknownTypeLine(std::cout);
  }

  // Test-only: emit one intentionally invalid helper-output line after ready.
  // The helper otherwise continues normally, modeling a malformed line that
  // Native Core would discard without corrupting the lifecycle.
  if (options.emitMalformedLine) {
    std::cerr << "[helper] emitting synthetic malformed line "
                 "(reason=synthetic-malformed-line)\n";
    writeMalformedLine(std::cout);
  }

  // Test-only: emit one bounded oversized helper-output line after ready. The
  // helper otherwise continues normally, modeling an oversized line that a
  // bounded size check would reject without corrupting the lifecycle.
  if (options.emitOversizedLine) {
    std::cerr << "[helper] emitting synthetic oversized line "
                 "(reason=synthetic-oversized-line)\n";
    writeOversizedLine(std::cout);
  }

  // Test-only: emit one synthetic "result" line carrying an INVALID schema
  // version (schemaVersion:10) before the normal result frames. The normal
  // helper-runtime smoke parser must reject it via exact-boundary schemaVersion
  // matching and fail closed before writing any MotionFrame; a bare
  // "schemaVersion":1 substring match would wrongly accept it. The helper
  // otherwise continues normally.
  if (options.emitMalformedResultSchema) {
    std::cerr << "[helper] emitting synthetic malformed result schema line "
                 "(reason=synthetic-malformed-result-schema)\n";
    writeMalformedResultSchemaLine(std::cout, 0);
  }

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

  // Test-only: emit one stderr line that intentionally VIOLATES the
  // safe-diagnostic contract by omitting the required "[helper] " prefix. It
  // models an unsafe diagnostic (e.g. raw pixels, paths, secrets) that Native
  // Core must treat as a policy violation and fail closed. The line is a benign
  // synthetic marker only -- it carries no raw data, paths, secrets, pixels,
  // tensors, or model contents. The helper otherwise completes normally (it
  // still emits the clean "stopped" line and exits 0); the smoke's detection of
  // the unsafe line is what forces a fail-closed reconstruction.
  if (options.emitUnsafeDiagnostic) {
    std::cerr << "unsafe-synthetic-diagnostic: modeled-policy-violation "
                 "(reason=synthetic-unsafe-diagnostic)\n";
  }

  // Test-only: on the clean completion path, emit one private synthetic
  // "stopping" lifecycle marker just before the "stopped" line, modeling the
  // helper-side of a graceful shutdown (stopping -> exited). This is helper-
  // driven and smoke-local; no parent-to-child control channel exists.
  if (options.emitGracefulShutdown) {
    std::cerr << "[helper] stopping: reason=graceful-shutdown "
                 "(reason=synthetic-graceful-shutdown)\n";
    writeStoppingLine(std::cout, "graceful-shutdown");
  }

  // Test-only: on the clean completion path, model a stopping -> synthetic
  // shutdown-timeout -> clean terminal exit sequence by emitting a private
  // "stopping" marker followed by a private "shutdown-timeout" marker just before
  // the "stopped" line. This is helper-driven and smoke-local; there is no
  // parent-to-child control channel, no real forced kill, and no production
  // shutdown-timeout policy -- the helper still exits 0 cleanly.
  if (options.emitTimeoutForcedShutdown) {
    std::cerr << "[helper] stopping: reason=timeout-forced-shutdown "
                 "(reason=synthetic-timeout-forced-shutdown)\n";
    writeStoppingLine(std::cout, "timeout-forced-shutdown");
    std::cerr << "[helper] shutdown-timeout: reason=synthetic-shutdown-timeout "
                 "(reason=synthetic-timeout-forced-shutdown)\n";
    writeShutdownTimeoutLine(std::cout, "synthetic-shutdown-timeout");
  }

  // Test-only: skip the "stopped" lifecycle boundary so Native Core can confirm
  // it fails closed when the stopped boundary is absent. The helper has already
  // emitted the "ready" line and result frames normally; it exits 0 cleanly
  // without ever emitting "stopped".
  if (options.skipStopped) {
    std::cerr << "[helper] shutdown: skipping stopped line "
                 "(reason=synthetic-skip-stopped), emittedResultCount="
              << emittedResultCount << "\n";
    return 0;
  }

  writeStoppedLine(std::cout, "completed");
  std::cerr << "[helper] shutdown: reason=completed, emittedResultCount="
            << emittedResultCount << "\n";

  return 0;
}
