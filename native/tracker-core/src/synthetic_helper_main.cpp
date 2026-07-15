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

#include "helper_frame_packet.h"
#include "helper_message.h"

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <cerrno>
#include <unistd.h>
#endif

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

// v0.13.0 (#533): interactive session-mode padding for the oversized session
// result fixture. Strictly greater than the session's kHelperMaxLineBytes bound
// (2048) so the padded result line is genuinely rejected by the session's
// bounded line reader. Kept file-local to avoid a header dependency here.
constexpr int kSessionOversizedFillerBytes = 2200;

// v0.13.0 (#533): deterministic adapter value patterns for interactive session
// results, cycling by request index so the session parse-and-clamp mapping is
// exercised through the real request/result channel. Mirrors the batch adapter
// patterns: in-range, out-of-range (clamped by the mapper), and exact-boundary.
struct SessionAdapterPattern {
  double confidence;
  double pitch;
  double yaw;
  double roll;
  double leftOpen;
  double rightOpen;
  double mouthOpen;
  double mouthSmile;
};

constexpr SessionAdapterPattern kSessionAdapterPatterns[3] = {
    {0.82, 0.30, -0.25, 0.10, 0.75, 0.65, 0.40, 0.55},
    {1.75, 4.20, -3.50, 2.00, 1.50, -0.50, 2.00, -1.00},
    {1.00, -1.00, 1.00, 0.00, 0.00, 1.00, 1.00, 0.00},
};

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
  bool emitMalformedStoppedSchema = false;
  bool emitAdapterValues = false;
  // v0.13.0 (#533): interactive session mode and its deterministic fault modes.
  // Session mode reads real parent control lines from stdin and emits one result
  // envelope per request; all fields default off so batch/smoke behavior is
  // unchanged.
  bool sessionMode = false;
  bool sessionSkipReady = false;
  bool sessionExitBeforeReady = false;
  bool sessionExitAfterReady = false;
  bool sessionHangResult = false;
  bool sessionExitOnRequest = false;
  bool sessionMalformedResult = false;
  bool sessionUnknownResult = false;
  bool sessionOversizedResult = false;
  bool sessionNonfiniteResult = false;
  bool sessionStaleRequestId = false;
  bool sessionStaleTimestamp = false;
  bool sessionUnsafeStderr = false;
  bool sessionUnterminatedUnsafeStderr = false;
  bool sessionIgnoreStop = false;
  bool sessionMissingStopped = false;
  bool sessionMalformedStopped = false;
  // v0.13.0 (#534): opt-in private frame transport within session mode, and
  // its deterministic test-only fault modes. All default off so session mode
  // without --session-frame-mode is byte-for-byte the #533 result-only
  // behavior.
  bool sessionFrameMode = false;
  bool sessionFrameIgnore = false;
  bool sessionFrameShortRead = false;
  bool sessionFrameExitDuringTransfer = false;
  bool sessionFrameBadAck = false;
  // v0.13.0 (#556): test-only, session-mode-only ready source override. Off
  // by default so the default session ready line is byte-for-byte unchanged
  // (source=synthetic-helper). This fixture stays synthetic-only: it emits
  // only the approved mediapipe-face-landmarker identity string and touches
  // no MediaPipe package, model, path, frame, or runtime behavior.
  bool sessionReadySourceMediaPipe = false;
};

// v0.13.0 (#534): the private frame endpoint the parent inherits into this
// process. On POSIX it is always a fixed fd (matching
// HelperProcessSession's kFrameTransportChildFd); on Windows the numeric
// handle value is read from a private, per-launch environment variable that
// is never logged. Neither value is ever printed.
#ifdef _WIN32
using FrameHandle = HANDLE;
constexpr FrameHandle kInvalidFrameHandle = nullptr;
#else
using FrameHandle = int;
constexpr FrameHandle kInvalidFrameHandle = -1;
constexpr int kFrameTransportChildFd = 3;
#endif

#ifdef _WIN32
FrameHandle resolveFrameHandleFromEnvironment() {
  // _dupenv_s (rather than std::getenv) so this Windows-only lookup owns its
  // own buffer instead of relying on getenv's implementation-defined
  // internal static storage.
  char *value = nullptr;
  std::size_t valueLength = 0;
  if (_dupenv_s(&value, &valueLength, "LVK_FRAME_PIPE_HANDLE") != 0 ||
      value == nullptr) {
    free(value);
    return kInvalidFrameHandle;
  }
  char *end = nullptr;
  const long long raw = std::strtoll(value, &end, 10);
  const bool valid = end != value && *end == '\0';
  free(value);
  if (!valid) {
    return kInvalidFrameHandle;
  }
  return reinterpret_cast<HANDLE>(static_cast<std::intptr_t>(raw));
}

bool readExactFrameBytes(
    FrameHandle handle, std::uint8_t *buffer, std::size_t length) {
  std::size_t readTotal = 0;
  while (readTotal < length) {
    DWORD chunk = 0;
    const DWORD toRead = static_cast<DWORD>(length - readTotal);
    if (!ReadFile(handle, buffer + readTotal, toRead, &chunk, nullptr) ||
        chunk == 0) {
      return false;
    }
    readTotal += chunk;
  }
  return true;
}
#else
bool readExactFrameBytes(
    FrameHandle handle, std::uint8_t *buffer, std::size_t length) {
  std::size_t readTotal = 0;
  while (readTotal < length) {
    const ssize_t chunk = read(handle, buffer + readTotal, length - readTotal);
    if (chunk > 0) {
      readTotal += static_cast<std::size_t>(chunk);
      continue;
    }
    if (chunk < 0 && errno == EINTR) {
      continue;
    }
    return false;  // EOF or hard error
  }
  return true;
}
#endif

// Deterministic frame acknowledgement to append to a session result line;
// null when not in frame mode. Native Core-internal only -- never pixel
// data, never a path, never a handle value.
struct FrameAckToEmit {
  unsigned long long sequence = 0;
  unsigned long long payloadBytes = 0;
  std::uint32_t checksum = 0;
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
            "[--emit-malformed-result-schema] "
            "[--emit-malformed-stopped-schema] [--emit-adapter-values]\n";
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
  output << "--emit-malformed-stopped-schema is a test-only mode that emits the "
            "\"stopped\" lifecycle boundary line with an invalid schema version "
            "(schemaVersion:10 instead of 1) in place of the normal stopped line; "
            "the helper otherwise completes normally (emits the ready line, its "
            "result frames, then the malformed stopped line, and exits 0). The "
            "value 10 is chosen to directly test that the normal helper-runtime "
            "smoke parser does not accept schemaVersion via a bare substring match "
            "of \"schemaVersion\":1 (which would match schemaVersion:10). Pairing "
            "it with --frames 0 keeps the rejection ahead of any mapped result "
            "frame. It is smoke-local / test-only and models a malformed-stopped "
            "failure vector so Native Core can confirm the normal parse path fails "
            "closed when the stopped line carries an invalid schema version. It "
            "stays synthetic only and is not a MotionFrame.\n";
  output << "--emit-adapter-values is a test-only mode that replaces each normal "
            "\"result\" line's fixed values with one of three deterministic "
            "per-frame adapter-style patterns (cycling by frame index): an "
            "in-range pattern, an out-of-range pattern (values outside the "
            "confidence/eye/mouth [0,1] and rotation [-1,1] ranges), and an "
            "exact-boundary pattern. It models a synthetic backend/adapter "
            "emitting varying values so Native Core's helper-runtime parse and "
            "clamp mapping can be exercised end-to-end through live captured "
            "stdout, not just direct in-process struct construction. The helper "
            "otherwise completes normally (emits the ready line, the "
            "\"stopped\" line, and exits 0). It stays synthetic only, carries no "
            "raw data, paths, secrets, pixels, tensors, or model contents, and "
            "is not a MotionFrame.\n";
  output << "--fail-after N is a test-only mode that simulates a helper failure "
            "after emitting N synthetic result frames. N must be between 0 and "
         << kMaxFrameCount << ".\n";
  output << "--session runs the interactive session mode (v0.13.0, #533): the "
            "helper emits a \"ready\" line, then one \"result\" envelope per "
            "parent \"request\" control line read from stdin (echoing requestId "
            "and frameTimestampMs), and a \"stopping\"/\"stopped\" pair on a "
            "parent \"stop\" request or stdin EOF. It stays synthetic only and "
            "never emits MotionFrame. The --session-* flags "
            "(--session-skip-ready, --session-exit-before-ready, "
            "--session-exit-after-ready, --session-hang-result, "
            "--session-exit-on-request, --session-malformed-result, "
            "--session-unknown-result, --session-oversized-result, "
            "--session-nonfinite-result, --session-stale-request-id, "
            "--session-stale-timestamp, --session-unsafe-stderr, "
            "--session-unterminated-unsafe-stderr, --session-ignore-stop, "
            "--session-missing-stopped, --session-malformed-stopped) are "
            "deterministic test-only session fault modes.\n";
  output << "--session-frame-mode (v0.13.0, #534) additionally reads exactly "
            "one bounded binary frame packet per parent \"request\" from the "
            "private frame endpoint, and appends a frameAck object "
            "(sequence, payloadBytes, checksum) to the result envelope. It "
            "never accesses a camera and never emits pixel data. "
            "--session-frame-ignore, --session-frame-short-read, "
            "--session-frame-exit-during-transfer, and "
            "--session-frame-bad-ack are deterministic test-only frame fault "
            "modes; combine with --session-stale-request-id to model a "
            "stale frameAck.sequence.\n";
  output << "--session-ready-source-mediapipe (v0.13.0, #556) is a "
            "deterministic test-only session-mode flag that changes only the "
            "\"source\" value emitted on the session's \"ready\" line from "
            "\"synthetic-helper\" to \"mediapipe-face-landmarker\"; every "
            "other session behavior (results, stopped, frame transport) is "
            "unchanged. This fixture remains synthetic only: it emits no "
            "real MediaPipe package, model, path, frame, or runtime "
            "behavior.\n";
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

    if (argument == "--emit-malformed-stopped-schema") {
      options.emitMalformedStoppedSchema = true;
      continue;
    }

    if (argument == "--emit-adapter-values") {
      options.emitAdapterValues = true;
      continue;
    }

    if (argument == "--session") {
      options.sessionMode = true;
      continue;
    }
    if (argument == "--session-skip-ready") {
      options.sessionSkipReady = true;
      continue;
    }
    if (argument == "--session-exit-before-ready") {
      options.sessionExitBeforeReady = true;
      continue;
    }
    if (argument == "--session-exit-after-ready") {
      options.sessionExitAfterReady = true;
      continue;
    }
    if (argument == "--session-hang-result") {
      options.sessionHangResult = true;
      continue;
    }
    if (argument == "--session-exit-on-request") {
      options.sessionExitOnRequest = true;
      continue;
    }
    if (argument == "--session-malformed-result") {
      options.sessionMalformedResult = true;
      continue;
    }
    if (argument == "--session-unknown-result") {
      options.sessionUnknownResult = true;
      continue;
    }
    if (argument == "--session-oversized-result") {
      options.sessionOversizedResult = true;
      continue;
    }
    if (argument == "--session-nonfinite-result") {
      options.sessionNonfiniteResult = true;
      continue;
    }
    if (argument == "--session-stale-request-id") {
      options.sessionStaleRequestId = true;
      continue;
    }
    if (argument == "--session-stale-timestamp") {
      options.sessionStaleTimestamp = true;
      continue;
    }
    if (argument == "--session-unsafe-stderr") {
      options.sessionUnsafeStderr = true;
      continue;
    }
    if (argument == "--session-unterminated-unsafe-stderr") {
      options.sessionUnterminatedUnsafeStderr = true;
      continue;
    }
    if (argument == "--session-ignore-stop") {
      options.sessionIgnoreStop = true;
      continue;
    }
    if (argument == "--session-missing-stopped") {
      options.sessionMissingStopped = true;
      continue;
    }
    if (argument == "--session-malformed-stopped") {
      options.sessionMalformedStopped = true;
      continue;
    }
    if (argument == "--session-frame-mode") {
      options.sessionFrameMode = true;
      continue;
    }
    if (argument == "--session-frame-ignore") {
      options.sessionFrameIgnore = true;
      continue;
    }
    if (argument == "--session-frame-short-read") {
      options.sessionFrameShortRead = true;
      continue;
    }
    if (argument == "--session-frame-exit-during-transfer") {
      options.sessionFrameExitDuringTransfer = true;
      continue;
    }
    if (argument == "--session-frame-bad-ack") {
      options.sessionFrameBadAck = true;
      continue;
    }
    if (argument == "--session-ready-source-mediapipe") {
      options.sessionReadySourceMediaPipe = true;
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

void writeReadyLine(std::ostream &output, const std::string &source) {
  output << "{"
         << "\"type\":\"ready\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"source\":\"" << source << "\"}\n";
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
         << "\"source\":\"" << lvk::tracker::kSyntheticHelperReadySource
         << "\"}\n";
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

// Emits a synthetic internal helper "result" line using one of three
// deterministic adapter-style value patterns, cycling by frameIndex % 3:
//   0 = in-range: plausible tracking values already inside the mapper's
//       accepted ranges.
//   1 = out-of-range: values deliberately outside confidence/eye/mouth [0,1]
//       and rotation [-1,1] so Native Core's clamp mapping must engage.
//   2 = exact-boundary: values sitting exactly at the clamp boundaries.
// This models a synthetic backend/adapter emitting varying values so the
// existing parse-and-clamp mapping is exercised through live captured stdout
// text (not just direct in-process struct construction, which
// lvk-helper-result-mapping-smoke already covers). It is intentionally NOT a
// MotionFrame and contains no raw data, paths, secrets, pixels, tensors, or
// model contents. Smoke-local / test-only.
void writeAdapterResultLine(
    std::ostream &output,
    int frameIndex,
    long long timestampMs) {
  struct AdapterPattern {
    double confidence;
    double pitch;
    double yaw;
    double roll;
    double leftOpen;
    double rightOpen;
    double mouthOpen;
    double mouthSmile;
  };

  static const AdapterPattern kPatterns[3] = {
      // In-range.
      {0.82, 0.30, -0.25, 0.10, 0.75, 0.65, 0.40, 0.55},
      // Out-of-range (must be clamped by createTrackingSampleFromHelperResult).
      {1.75, 4.20, -3.50, 2.00, 1.50, -0.50, 2.00, -1.00},
      // Exact boundary values.
      {1.00, -1.00, 1.00, 0.00, 0.00, 1.00, 1.00, 0.00},
  };

  const AdapterPattern &pattern = kPatterns[frameIndex % 3];

  output << std::fixed << std::setprecision(6);
  output << "{"
         << "\"type\":\"result\","
         << "\"schemaVersion\":" << kHelperSchemaVersion << ","
         << "\"timestampMs\":" << timestampMs << ","
         << "\"status\":\"tracking\","
         << "\"confidence\":" << pattern.confidence << ","
         << "\"faceRotation\":{"
         << "\"pitch\":" << pattern.pitch << ","
         << "\"yaw\":" << pattern.yaw << ","
         << "\"roll\":" << pattern.roll << "},"
         << "\"eyes\":{"
         << "\"leftOpen\":" << pattern.leftOpen << ","
         << "\"rightOpen\":" << pattern.rightOpen << "},"
         << "\"mouth\":{"
         << "\"open\":" << pattern.mouthOpen << ","
         << "\"smile\":" << pattern.mouthSmile << "},"
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

// Emits the "stopped" lifecycle boundary line with an INVALID schema version (10
// instead of 1) in place of the normal stopped line. The value 10 is chosen
// deliberately: it shares the digit "1" with the valid version, so the normal
// helper-runtime smoke parser must NOT rely on a bare "schemaVersion":1 substring
// match (which would also match "schemaVersion":10) and must instead match the
// exact boundary "schemaVersion":1, or "schemaVersion":1}. The line is otherwise a
// well-formed stopped shape so that, before the exact-boundary fix, a prefix match
// would wrongly accept it. It is intentionally NOT a MotionFrame and contains no
// raw data, paths, secrets, pixels, tensors, or model contents. Smoke-local /
// test-only.
void writeMalformedStoppedSchemaLine(
    std::ostream &output,
    const std::string &reason) {
  output << "{"
         << "\"type\":\"stopped\","
         << "\"schemaVersion\":10,"
         << "\"reason\":\"" << reason << "\"}\n";
}

// v0.13.0 (#533): interactive session helpers. -------------------------------

// True when a parent control line carries the given "type". The parent writes
// compact single-line JSON control messages; a substring match is sufficient
// for this synthetic test tool (Native Core owns the strict parser).
bool sessionControlIsType(const std::string &line, const char *type) {
  return line.find(std::string("\"type\":\"") + type + "\"") !=
         std::string::npos;
}

long long sessionExtractLong(
    const std::string &line, const char *key, long long fallback) {
  const std::string token = std::string("\"") + key + "\":";
  const std::size_t position = line.find(token);
  if (position == std::string::npos) {
    return fallback;
  }
  return std::strtoll(line.c_str() + position + token.size(), nullptr, 10);
}

// Emits one session "result" envelope (or a requested fault variant) echoing the
// parent's requestId and frameTimestampMs. It is intentionally NOT a MotionFrame
// and carries no raw data, paths, secrets, pixels, tensors, or model contents.
void writeSessionResult(
    std::ostream &output,
    const HelperOptions &options,
    long long requestId,
    long long frameTimestampMs,
    long long requestIndex,
    const FrameAckToEmit *frameAck = nullptr) {
  if (options.sessionMalformedResult) {
    output << "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":"
           << requestId << " this-is-not-valid-session-json\n";
    return;
  }
  if (options.sessionUnknownResult) {
    output << "{\"type\":\"telemetry\",\"schemaVersion\":1,\"requestId\":"
           << requestId << "}\n";
    return;
  }

  const long long emittedRequestId =
      options.sessionStaleRequestId ? requestId + 1 : requestId;
  const long long emittedFrameTimestampMs =
      options.sessionStaleTimestamp ? frameTimestampMs + 1 : frameTimestampMs;
  const SessionAdapterPattern &pattern =
      kSessionAdapterPatterns[requestIndex % 3];

  output << std::fixed << std::setprecision(6);
  output << "{"
         << "\"type\":\"result\","
         << "\"schemaVersion\":1,"
         << "\"requestId\":" << emittedRequestId << ","
         << "\"frameTimestampMs\":" << emittedFrameTimestampMs << ","
         << "\"status\":\"tracking\","
         << "\"confidence\":";
  if (options.sessionNonfiniteResult) {
    // A finite JSON number token that parses to a non-finite double; Native Core
    // must reject the result rather than neutralize it.
    output << "1e400";
  } else {
    output << pattern.confidence;
  }
  output << ","
         << "\"faceRotation\":{"
         << "\"pitch\":" << pattern.pitch << ","
         << "\"yaw\":" << pattern.yaw << ","
         << "\"roll\":" << pattern.roll << "},"
         << "\"eyes\":{"
         << "\"leftOpen\":" << pattern.leftOpen << ","
         << "\"rightOpen\":" << pattern.rightOpen << "},"
         << "\"mouth\":{"
         << "\"open\":" << pattern.mouthOpen << ","
         << "\"smile\":" << pattern.mouthSmile << "},"
         << "\"diag\":{\"inferenceMs\":" << 0.0 << "}";
  if (frameAck != nullptr) {
    output << ",\"frameAck\":{"
           << "\"sequence\":" << frameAck->sequence << ","
           << "\"payloadBytes\":" << frameAck->payloadBytes << ","
           << "\"checksum\":" << frameAck->checksum << "}";
  }
  if (options.sessionOversizedResult) {
    output << ",\"pad\":\"";
    for (int fillerIndex = 0; fillerIndex < kSessionOversizedFillerBytes;
         ++fillerIndex) {
      output << 'x';
    }
    output << "\"";
  }
  output << "}\n";
}

// Runs the interactive session: emit ready, then one result envelope per parent
// request, until a parent stop request or stdin EOF. stdout is flushed after
// every protocol line so the parent's bounded reads observe them promptly. All
// stderr uses the safe "[helper] " diagnostic prefix.
int runSyntheticHelperSession(const HelperOptions &options) {
  std::cerr << "[helper] session: starting (source=synthetic-helper)\n";

  // v0.13.0 (#534): resolve the private frame endpoint once, before any
  // ready/request handling, when frame mode was requested. The numeric
  // handle/fd value is never printed.
  FrameHandle frameHandle = kInvalidFrameHandle;
  if (options.sessionFrameMode) {
#ifdef _WIN32
    frameHandle = resolveFrameHandleFromEnvironment();
#else
    frameHandle = kFrameTransportChildFd;
#endif
    if (frameHandle == kInvalidFrameHandle) {
      std::cerr << "[helper] session: frame mode requested but no frame "
                   "endpoint is available "
                   "(reason=synthetic-session-frame-missing-endpoint)\n";
      return 1;
    }
  }

  if (options.sessionExitBeforeReady) {
    std::cerr << "[helper] session: exiting before ready "
                 "(reason=synthetic-session-exit-before-ready)\n";
    return 1;
  }

  if (options.sessionSkipReady) {
    std::cerr << "[helper] session: skipping ready "
                 "(reason=synthetic-session-skip-ready)\n";
  } else {
    writeReadyLine(
        std::cout,
        options.sessionReadySourceMediaPipe
            ? lvk::tracker::kMediaPipeFaceLandmarkerReadySource
            : lvk::tracker::kSyntheticHelperReadySource);
    std::cout.flush();
  }

  if (options.sessionExitAfterReady) {
    // Exit cleanly right after ready, before reading any request. Models a
    // helper that dies after the handshake but before/at the first request
    // write; the parent must stay alive and fail closed.
    std::cerr << "[helper] session: exiting after ready "
                 "(reason=synthetic-session-exit-after-ready)\n";
    return 0;
  }

  long long requestIndex = 0;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    if (line.empty()) {
      continue;
    }

    if (sessionControlIsType(line, "stop")) {
      if (options.sessionIgnoreStop) {
        // Model a stop that never completes so the parent's bounded shutdown
        // wait fires and it force-terminates the child.
        std::cerr << "[helper] session: ignoring stop "
                     "(reason=synthetic-session-ignore-stop)\n";
        continue;
      }
      if (options.sessionMissingStopped) {
        // Exit cleanly on stop without emitting the "stopped" boundary; the
        // parent must treat this as an incomplete shutdown.
        std::cerr << "[helper] session: exiting without stopped "
                     "(reason=synthetic-session-missing-stopped)\n";
        return 0;
      }
      if (options.sessionMalformedStopped) {
        // Emit a "stopped" line with an invalid schemaVersion; the parent's
        // strict shutdown validation must reject it.
        std::cout << "{\"type\":\"stopped\",\"schemaVersion\":10,"
                     "\"reason\":\"session-stop\"}\n";
        std::cout.flush();
        std::cerr << "[helper] session: emitted malformed stopped "
                     "(reason=synthetic-session-malformed-stopped)\n";
        return 0;
      }
      writeStoppingLine(std::cout, "session-stop");
      std::cout.flush();
      writeStoppedLine(std::cout, "session-stop");
      std::cout.flush();
      std::cerr << "[helper] session: stopped (reason=session-stop)\n";
      return 0;
    }

    if (sessionControlIsType(line, "request")) {
      const long long requestId = sessionExtractLong(line, "requestId", 0);
      const long long frameTimestampMs =
          sessionExtractLong(line, "frameTimestampMs", 0);

      if (options.sessionUnsafeStderr) {
        // Emitted on the request path (not at ready) so Native Core reliably
        // observes it during a track() exchange and fails closed. It
        // intentionally omits the safe "[helper] " prefix. Benign synthetic
        // marker only: no raw data, paths, or secrets.
        std::cerr << "unsafe-synthetic-session-diagnostic: "
                     "modeled-policy-violation "
                     "(reason=synthetic-session-unsafe-stderr)\n";
      }
      if (options.sessionUnterminatedUnsafeStderr) {
        // An unsafe stderr line WITHOUT a trailing newline, followed by exit, so
        // the parent must validate the unterminated residual at EOF and fail
        // closed. Benign synthetic marker only.
        std::cerr << "unsafe-synthetic-session-unterminated: "
                     "modeled-policy-violation";
        std::cerr.flush();
        return 0;
      }
      if (options.sessionExitOnRequest) {
        std::cerr << "[helper] session: exiting on request "
                     "(reason=synthetic-session-exit-on-request)\n";
        return 1;
      }
      if (options.sessionHangResult) {
        // Withhold the result so the parent's bounded result wait fires.
        std::cerr << "[helper] session: withholding result "
                     "(reason=synthetic-session-hang-result)\n";
        continue;
      }

      FrameAckToEmit ackStorage;
      const FrameAckToEmit *ackPtr = nullptr;

      if (options.sessionFrameMode) {
        if (options.sessionFrameExitDuringTransfer) {
          std::cerr << "[helper] session: exiting during frame transfer "
                       "(reason=synthetic-session-frame-exit-during-transfer)"
                       "\n";
          return 1;
        }
        if (options.sessionFrameIgnore) {
          // Deliberately never reads the frame endpoint and withholds the
          // result, so the parent's bounded frame write/result wait fires.
          std::cerr << "[helper] session: ignoring frame pipe "
                       "(reason=synthetic-session-frame-ignore)\n";
          continue;
        }

        std::uint8_t headerBytes[lvk::tracker::kFramePacketHeaderBytes];
        if (!readExactFrameBytes(
                frameHandle, headerBytes, sizeof(headerBytes))) {
          std::cerr << "[helper] session: frame header read failed "
                       "(reason=synthetic-session-frame-header-read-failed)"
                       "\n";
          return 1;
        }
        lvk::tracker::FramePacketHeader header;
        const lvk::tracker::FramePacketDecodeStatus status =
            lvk::tracker::decodeFramePacketHeader(
                headerBytes, sizeof(headerBytes), header);
        if (status != lvk::tracker::FramePacketDecodeStatus::Ok) {
          std::cerr << "[helper] session: frame header invalid "
                       "(reason=synthetic-session-frame-header-invalid)\n";
          return 1;
        }

        std::size_t payloadToRead = static_cast<std::size_t>(header.payloadBytes);
        if (options.sessionFrameShortRead) {
          payloadToRead = payloadToRead / 2;
        }
        std::vector<std::uint8_t> payload(payloadToRead);
        if (payloadToRead > 0 &&
            !readExactFrameBytes(frameHandle, payload.data(), payloadToRead)) {
          std::cerr << "[helper] session: frame payload read failed "
                       "(reason=synthetic-session-frame-payload-read-failed)"
                       "\n";
          return 1;
        }

        ackStorage.sequence = static_cast<unsigned long long>(
            options.sessionStaleRequestId ? requestId + 1 : requestId);
        ackStorage.payloadBytes =
            static_cast<unsigned long long>(payloadToRead);
        ackStorage.checksum =
            lvk::tracker::fnv1a32(payload.data(), payload.size());
        if (options.sessionFrameBadAck) {
          ackStorage.checksum ^= 1u;
        }
        ackPtr = &ackStorage;
      }

      writeSessionResult(
          std::cout, options, requestId, frameTimestampMs, requestIndex,
          ackPtr);
      std::cout.flush();
      ++requestIndex;
      continue;
    }

    std::cerr << "[helper] session: ignoring unknown control line\n";
  }

  // stdin closed by the parent: clean terminal stop.
  writeStoppedLine(std::cout, "session-eof");
  std::cout.flush();
  std::cerr << "[helper] session: stopped (reason=session-eof)\n";
  return 0;
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

  // v0.13.0 (#533): interactive session mode is a distinct, opt-in path that
  // reads real parent control lines. All existing batch/smoke behavior below is
  // unchanged when --session is not supplied.
  if (options.sessionMode) {
    return runSyntheticHelperSession(options);
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
    writeReadyLine(std::cout, lvk::tracker::kSyntheticHelperReadySource);
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
    if (options.emitAdapterValues) {
      writeAdapterResultLine(std::cout, frameIndex, timestampMs);
    } else {
      writeResultLine(std::cout, timestampMs);
    }
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

  // Test-only: emit the "stopped" lifecycle boundary line with an INVALID schema
  // version (schemaVersion:10) in place of the normal stopped line. The normal
  // helper-runtime smoke parser must reject it via exact-boundary schemaVersion
  // matching and fail closed; a bare "schemaVersion":1 substring match would
  // wrongly accept it. The helper still exits 0 cleanly. Pairing this with
  // --frames 0 keeps the rejection ahead of any mapped result frame.
  if (options.emitMalformedStoppedSchema) {
    std::cerr << "[helper] shutdown: emitting malformed stopped schema line "
                 "(reason=synthetic-malformed-stopped-schema), emittedResultCount="
              << emittedResultCount << "\n";
    writeMalformedStoppedSchemaLine(std::cout, "completed");
    return 0;
  }

  writeStoppedLine(std::cout, "completed");
  std::cerr << "[helper] shutdown: reason=completed, emittedResultCount="
            << emittedResultCount << "\n";

  return 0;
}
