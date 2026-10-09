// Bounded helper result-timeout recovery smoke (#589).
//
// Deterministic, behavioral native smoke that drives the REAL production owner
// path:
//
//   MediaPipeFaceLandmarkerHelperTrackingBackend
//     -> FrameHelperTrackingBackend
//       -> HelperProcessSession::trackWithFrame()
//
// with a small in-memory synthetic cv::Mat. It proves the single, bounded,
// MediaPipe-route-only recovery approved for #589: after the current
// successfully-started helper generation reaches terminal ResultTimeout on the
// normal track() path (returning LOST and emitting its one #587 line), exactly
// one lifetime recovery attempt reconstructs a fresh HelperProcessSession from
// the retained config, on the FOLLOWING track() entry.
//
// It compiles with real OpenCV enabled (LVK_HAS_OPENCV_CAMERA=1 /
// LVK_HAS_OPENCV_IMAGE=1) but never opens a camera, never loads MediaPipe,
// Python, or a model, and never uses the network, sockets, temp files, or
// persisted frames/MotionFrames. Like the #587 smoke it re-execs itself (via
// the existing, already-approved HelperInvocationMode::ExactArguments
// caller-owned-argv path) as a minimal, self-contained frame-transport session
// responder -- see runRecoveryTestChild() below -- that speaks only the
// existing ready / request+frame / result(+frameAck) / stop contract. It adds
// no flag or fault behavior to lvk-synthetic-helper or any production helper
// code.
//
// The child is stateless across generations (a fresh child is spawned for each
// generation, with identical argv), so which frame times out / is no-face /
// is malformed is selected entirely by the CALLER-CONTROLLED frame timestamp
// (a small set of sentinel values), never by filesystem/env persistence across
// children. This makes each generation's behavior deterministic without a
// wall-clock assertion: the child's fixed slow-frame delay only has to outlast
// the smoke-only result-timeout, and it is force-terminated mid-sleep, so it
// costs no measured latency.
//
// The smoke-only timeouts live exclusively in the smoke's local
// HelperSessionConfig and never touch any production default.

#include "tracking_backend.h"

#include "helper_frame_packet.h"
#include "helper_message.h"
#include "helper_process_cleanup_registry.h"
#include "helper_process_session.h"

#include <chrono>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <opencv2/core.hpp>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <cerrno>
#include <unistd.h>
#endif

namespace {

int gFailures = 0;

// Reports through std::clog, never std::cout/std::cerr: most assertions here
// run while a StreamCapture has this process's cout/cerr redirected, so
// reporting on either would be swallowed into the buffer under test. std::clog
// reaches the real stderr and is never captured.
void expect(bool condition, const std::string& what) {
  if (!condition) {
    ++gFailures;
    std::clog << "[recovery-smoke] FAILED: " << what << "\n";
  }
}

using lvk::tracker::CameraFrame;
using lvk::tracker::HelperInvocationMode;
using lvk::tracker::HelperProcessCleanupRegistry;
using lvk::tracker::HelperSessionConfig;
using lvk::tracker::kHelperTimingSaturationCap;
using lvk::tracker::kMediaPipeFaceLandmarkerReadySource;
using lvk::tracker::kSyntheticHelperReadySource;
using lvk::tracker::MediaPipeFaceLandmarkerHelperTrackingBackend;
using lvk::tracker::PreprocessedFrame;
using lvk::tracker::saturateHelperTimingCount;
using lvk::tracker::saturateHelperTimingDouble;
using lvk::tracker::saturateHelperTimingValue;
using lvk::tracker::SyntheticFrameHelperTrackingBackend;
using lvk::tracker::TrackingSample;
using lvk::tracker::TrackingStatus;
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
namespace test_seam = lvk::tracker::test_seam;
#endif

// Marker argument identifying the self-exec test-child mode. Smoke-local only:
// never a production helper flag, never parsed by lvk-synthetic-helper or
// HelperProcessSession.
constexpr const char* kRecoveryChildArg = "--lvk-589-recovery-smoke-child";

// The exact, fixed #587 terminal lines, keyed only on the diagnostic category
// (the backend label never appears in this line). No private/injected bytes.
constexpr const char* kResultTimeoutLine =
    "[helper-session] session failed (category=result-timeout)\n";
constexpr const char* kMalformedMessageLine =
    "[helper-session] session failed (category=malformed-message)\n";
constexpr const char* kTerminalFailurePrefix =
    "[helper-session] session failed";

// The exact, fixed #589 recovery-outcome lines (owner-approved contract).
// kRecoveryOutcomePrefix distinguishes these from the #587 terminal-failure
// line above (kTerminalFailurePrefix) so absence/presence checks never
// conflate the two independent one-line contracts.
constexpr const char* kRecoverySucceededLine =
    "[helper-session] recovery succeeded\n";
constexpr const char* kRecoveryFailedLaunchFailureLine =
    "[helper-session] recovery failed (category=launch-failure)\n";
constexpr const char* kRecoveryFailedReadyTimeoutLine =
    "[helper-session] recovery failed (category=ready-timeout)\n";
constexpr const char* kRecoveryFailedMalformedMessageLine =
    "[helper-session] recovery failed (category=malformed-message)\n";
constexpr const char* kRecoveryFailedNoneLine =
    "[helper-session] recovery failed (category=none)\n";
constexpr const char* kRecoveryOutcomePrefix = "[helper-session] recovery";

// The #616 diagnostic-only timing line prefix. Distinct from both
// kTerminalFailurePrefix and kRecoveryOutcomePrefix, so every existing
// presence/absence/count check above keeps its exact meaning.
constexpr const char* kFailureTimingPrefix = "[helper-session] failure timing";

// The exact, fixed #592 gen1-cleanup disposition lines (owner-approved
// contract). Each always precedes -- and is asserted immediately adjacent
// to -- the unchanged #591 recovery-outcome line above, since both share the
// "[helper-session] recovery" prefix and are emitted within the same
// recovery attempt.
constexpr const char* kRecoveryGen1CleanupConfirmedReleaseLine =
    "[helper-session] recovery gen1-cleanup (disposition=confirmed-release)\n";
constexpr const char* kRecoveryGen1CleanupUnknownLine =
    "[helper-session] recovery gen1-cleanup (disposition=unknown)\n";
constexpr const char* kRecoveryGen1CleanupDeferredRegistryTransferLine =
    "[helper-session] recovery gen1-cleanup "
    "(disposition=deferred-registry-transfer)\n";

// Caller-controlled frame-timestamp sentinels selecting the child's per-frame
// behavior. Any timestamp not listed here is an ordinary tracking frame.
constexpr long long kSlowFrameTs = 900001;       // delayed result -> ResultTimeout
constexpr long long kNoFaceFrameTs = 900002;     // ok==true, status==lost
constexpr long long kMalformedFrameTs = 900003;  // unparseable result
// #616: explicit helper diag.inferenceMs values, so the timing line's inference
// fields are deterministic. Each is an ordinary successful (ok==true) result.
constexpr long long kInference12FrameTs = 900004;        // tracking, 12.4 -> 12
constexpr long long kNoFaceInference8FrameTs = 900005;   // no-face, 7.6 -> 8
constexpr long long kNoDiagFrameTs = 900006;             // diag omitted -> 0
constexpr long long kNegativeInferenceFrameTs = 900007;  // -5.0 -> 0
constexpr long long kHugeInferenceFrameTs = 900008;      // 5e12 -> cap

// Smoke-only injection budgets. Deliberately separate from, and far below, the
// production defaults this change never touches (resultTimeoutMs 2000 /
// stopTimeoutMs 1000). kChildSlowSleepMs (child side) outlasts
// kSmokeResultTimeoutMs (parent side) by a wide margin, so the parent's result
// wait always fires first; no assertion measures the delay, and the child is
// force-terminated mid-sleep so the delay costs no smoke latency.
constexpr int kSmokeResultTimeoutMs = 80;
constexpr int kSmokeStopTimeoutMs = 40;
constexpr int kChildSlowSleepMs = 600;

// ---------------------------------------------------------------------------
// Self-exec frame-transport test child. A minimal, synthetic-only session
// responder that consumes the existing private frame packet and answers with a
// correct frameAck. Behavior per frame is chosen only from the caller-supplied
// frameTimestampMs. It is NOT lvk-synthetic-helper and is never reached by
// production code -- only this smoke, via HelperInvocationMode::ExactArguments.
// It touches no camera, file, model, or network.
// ---------------------------------------------------------------------------

#ifdef _WIN32
using FrameHandle = HANDLE;
constexpr FrameHandle kInvalidFrameHandle = nullptr;

FrameHandle resolveFrameHandle() {
  char* value = nullptr;
  std::size_t valueLength = 0;
  if (_dupenv_s(&value, &valueLength, "LVK_FRAME_PIPE_HANDLE") != 0 ||
      value == nullptr) {
    free(value);
    return kInvalidFrameHandle;
  }
  char* end = nullptr;
  const long long raw = std::strtoll(value, &end, 10);
  const bool valid = end != value && *end == '\0';
  free(value);
  if (!valid) {
    return kInvalidFrameHandle;
  }
  return reinterpret_cast<HANDLE>(static_cast<std::intptr_t>(raw));
}

bool readExactFrameBytes(
    FrameHandle handle, std::uint8_t* buffer, std::size_t length) {
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
using FrameHandle = int;
constexpr FrameHandle kInvalidFrameHandle = -1;
constexpr int kFrameTransportChildFd = 3;

FrameHandle resolveFrameHandle() { return kFrameTransportChildFd; }

bool readExactFrameBytes(
    FrameHandle handle, std::uint8_t* buffer, std::size_t length) {
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

long long extractLongField(
    const std::string& line, const std::string& key, long long fallback) {
  const std::string token = "\"" + key + "\":";
  const std::size_t position = line.find(token);
  if (position == std::string::npos) {
    return fallback;
  }
  return std::strtoll(line.c_str() + position + token.size(), nullptr, 10);
}

// Writes a strictly-parseable session result envelope (tracking or lost) with a
// correct frameAck appended. Modeled exactly on the accepted synthetic-helper
// session/frame format; carries no raw data, path, secret, pixel, tensor, or
// model content.
void writeResultLine(
    long long requestId,
    long long frameTimestampMs,
    const char* status,
    double confidence,
    unsigned long long ackSequence,
    unsigned long long ackPayloadBytes,
    std::uint32_t ackChecksum,
    double inferenceMs = 0.0,
    bool includeDiag = true) {
  std::cout << std::fixed << std::setprecision(6);
  std::cout << "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":"
            << requestId << ",\"frameTimestampMs\":" << frameTimestampMs
            << ",\"status\":\"" << status << "\",\"confidence\":" << confidence
            << ",\"faceRotation\":{\"pitch\":" << 0.0 << ",\"yaw\":" << 0.0
            << ",\"roll\":" << 0.0 << "},\"eyes\":{\"leftOpen\":" << 1.0
            << ",\"rightOpen\":" << 1.0 << "},\"mouth\":{\"open\":" << 0.0
            << ",\"smile\":" << 0.0 << "}";
  if (includeDiag) {
    std::cout << ",\"diag\":{\"inferenceMs\":" << inferenceMs << "}";
  }
  std::cout << ",\"frameAck\":{\"sequence\":" << ackSequence
            << ",\"payloadBytes\":" << ackPayloadBytes
            << ",\"checksum\":" << ackChecksum << "}}\n";
  std::cout.flush();
}

int runRecoveryTestChild() {
  const FrameHandle frameHandle = resolveFrameHandle();
  if (frameHandle == kInvalidFrameHandle) {
    // Frame mode requested but no private endpoint inherited: fail closed
    // without ever emitting ready, exactly like the production helper.
    return 1;
  }

  // Ready line using the MediaPipe route identity (this smoke's config expects
  // it). Synthetic-only string; no MediaPipe package, model, or path involved.
  std::cout << "{\"type\":\"ready\",\"schemaVersion\":1,\"source\":\""
            << kMediaPipeFaceLandmarkerReadySource << "\"}\n";
  std::cout.flush();

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    if (line.empty()) {
      continue;
    }
    if (line.find("\"type\":\"stop\"") != std::string::npos) {
      std::cout << "{\"type\":\"stopping\",\"schemaVersion\":1,\"reason\":"
                   "\"session-stop\"}\n";
      std::cout.flush();
      std::cout << "{\"type\":\"stopped\",\"schemaVersion\":1,\"reason\":"
                   "\"session-stop\"}\n";
      std::cout.flush();
      return 0;
    }
    if (line.find("\"type\":\"request\"") == std::string::npos) {
      continue;  // tolerate unknown control lines
    }

    const long long requestId = extractLongField(line, "requestId", 0);
    const long long frameTimestampMs =
        extractLongField(line, "frameTimestampMs", 0);

    // Always consume the private frame packet first so the parent's bounded
    // frame write completes and no bytes are left straddling generations.
    std::uint8_t headerBytes[lvk::tracker::kFramePacketHeaderBytes];
    if (!readExactFrameBytes(frameHandle, headerBytes, sizeof(headerBytes))) {
      return 1;
    }
    lvk::tracker::FramePacketHeader header;
    if (lvk::tracker::decodeFramePacketHeader(
            headerBytes, sizeof(headerBytes), header) !=
        lvk::tracker::FramePacketDecodeStatus::Ok) {
      return 1;
    }
    std::vector<std::uint8_t> payload(
        static_cast<std::size_t>(header.payloadBytes));
    if (!payload.empty() &&
        !readExactFrameBytes(frameHandle, payload.data(), payload.size())) {
      return 1;
    }
    const std::uint32_t checksum =
        lvk::tracker::fnv1a32(payload.data(), payload.size());
    const unsigned long long ackPayloadBytes =
        static_cast<unsigned long long>(payload.size());
    const unsigned long long ackSequence =
        static_cast<unsigned long long>(requestId);

    if (frameTimestampMs == kMalformedFrameTs) {
      // Unparseable result envelope -> the parent's strict parse fails closed
      // with a track-path MalformedMessage terminal category.
      std::cout << "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":"
                << requestId << " this-is-not-valid-session-json\n";
      std::cout.flush();
      continue;
    }
    if (frameTimestampMs == kSlowFrameTs) {
      // Outlast the parent's small result wait so it observes ResultTimeout.
      // The result written afterward can never arrive within that wait; the
      // child is normally force-terminated mid-sleep during teardown.
      std::this_thread::sleep_for(std::chrono::milliseconds(kChildSlowSleepMs));
      writeResultLine(
          requestId, frameTimestampMs, "tracking", 1.0, ackSequence,
          ackPayloadBytes, checksum);
      continue;
    }
    // #616 explicit inference values (and diag omission).
    if (frameTimestampMs == kInference12FrameTs) {
      writeResultLine(
          requestId, frameTimestampMs, "tracking", 1.0, ackSequence,
          ackPayloadBytes, checksum, 12.4);
      continue;
    }
    if (frameTimestampMs == kNoFaceInference8FrameTs) {
      writeResultLine(
          requestId, frameTimestampMs, "lost", 0.0, ackSequence,
          ackPayloadBytes, checksum, 7.6);
      continue;
    }
    if (frameTimestampMs == kNoDiagFrameTs) {
      writeResultLine(
          requestId, frameTimestampMs, "tracking", 1.0, ackSequence,
          ackPayloadBytes, checksum, 0.0, false);
      continue;
    }
    if (frameTimestampMs == kNegativeInferenceFrameTs) {
      writeResultLine(
          requestId, frameTimestampMs, "tracking", 1.0, ackSequence,
          ackPayloadBytes, checksum, -5.0);
      continue;
    }
    if (frameTimestampMs == kHugeInferenceFrameTs) {
      writeResultLine(
          requestId, frameTimestampMs, "tracking", 1.0, ackSequence,
          ackPayloadBytes, checksum, 5.0e12);
      continue;
    }
    if (frameTimestampMs == kNoFaceFrameTs) {
      // Legitimate no-face: a successful (ok==true) result with status lost.
      writeResultLine(
          requestId, frameTimestampMs, "lost", 0.0, ackSequence,
          ackPayloadBytes, checksum);
      continue;
    }
    // Ordinary tracking frame.
    writeResultLine(
        requestId, frameTimestampMs, "tracking", 1.0, ackSequence,
        ackPayloadBytes, checksum);
  }

  std::cout << "{\"type\":\"stopped\",\"schemaVersion\":1,\"reason\":"
               "\"session-eof\"}\n";
  std::cout.flush();
  return 0;
}

// ---------------------------------------------------------------------------
// Test scaffolding.
// ---------------------------------------------------------------------------

// Captures a std::ostream's stream buffer for the object's lifetime, so
// stdout/stderr can be observed deterministically in-process.
class StreamCapture {
 public:
  explicit StreamCapture(std::ostream& stream)
      : stream_(stream), original_(stream.rdbuf(buffer_.rdbuf())) {}
  ~StreamCapture() { stream_.rdbuf(original_); }

  StreamCapture(const StreamCapture&) = delete;
  StreamCapture& operator=(const StreamCapture&) = delete;

  std::string str() const { return buffer_.str(); }

 private:
  std::ostream& stream_;
  std::ostringstream buffer_;
  std::streambuf* original_;
};

std::size_t countOccurrences(
    const std::string& haystack, const std::string& needle) {
  std::size_t count = 0;
  std::size_t pos = 0;
  while ((pos = haystack.find(needle, pos)) != std::string::npos) {
    ++count;
    pos += needle.size();
  }
  return count;
}

// ---------------------------------------------------------------------------
// #616 timing-line helpers. The pattern below is the exact closed grammar
// from #616 (and the Electron preservation matcher): fixed keys, order,
// ", " delimiters, generation 1|2, U = 0|[1-9][0-9]{0,8}, V = U|na, and
// whole-line anchors.
// ---------------------------------------------------------------------------

struct ParsedTiming {
  int generation = 0;
  unsigned long long exchanges = 0;
  unsigned long long ageMs = 0;
  unsigned long long writeMs = 0;
  unsigned long long maxGapMs = 0;
  unsigned long long overshootMs = 0;
  bool lastWaitKnown = false;
  unsigned long long lastWaitMs = 0;
  bool maxWaitKnown = false;
  unsigned long long maxWaitMs = 0;
  unsigned long long slowWaits = 0;
  bool lastInferenceKnown = false;
  unsigned long long lastInferenceMs = 0;
  bool maxInferenceKnown = false;
  unsigned long long maxInferenceMs = 0;
};

bool parseTimingLine(const std::string& line, ParsedTiming& out) {
  static const std::string kU = "(0|[1-9][0-9]{0,8})";
  static const std::string kV = "(0|[1-9][0-9]{0,8}|na)";
  static const std::regex kPattern(
      "^\\[helper-session\\] failure timing \\(generation=([12]), exchanges=" +
      kU + ", ageMs=" + kU + ", writeMs=" + kU + ", maxGapMs=" + kU +
      ", overshootMs=" + kU + ", lastWaitMs=" + kV + ", maxWaitMs=" + kV +
      ", slowWaits=" + kU + ", lastInferenceMs=" + kV +
      ", maxInferenceMs=" + kV + "\\)$");
  std::smatch match;
  if (!std::regex_match(line, match, kPattern)) {
    return false;
  }
  const auto u = [&match](std::size_t index) {
    return std::stoull(match[index].str());
  };
  const auto v = [&match](std::size_t index, bool& known) {
    known = match[index].str() != "na";
    return known ? std::stoull(match[index].str()) : 0ull;
  };
  out.generation = static_cast<int>(u(1));
  out.exchanges = u(2);
  out.ageMs = u(3);
  out.writeMs = u(4);
  out.maxGapMs = u(5);
  out.overshootMs = u(6);
  out.lastWaitMs = v(7, out.lastWaitKnown);
  out.maxWaitMs = v(8, out.maxWaitKnown);
  out.slowWaits = u(9);
  out.lastInferenceMs = v(10, out.lastInferenceKnown);
  out.maxInferenceMs = v(11, out.maxInferenceKnown);
  return true;
}

// Splits captured stderr into lines. Every captured diagnostic must be
// '\n'-terminated; a trailing partial line is reported as a failure.
std::vector<std::string> splitLines(
    const std::string& text, const std::string& label) {
  std::vector<std::string> lines;
  std::size_t begin = 0;
  while (begin < text.size()) {
    const std::size_t end = text.find('\n', begin);
    if (end == std::string::npos) {
      expect(false, label + ": captured stderr ends with a complete line");
      lines.push_back(text.substr(begin));
      break;
    }
    lines.push_back(text.substr(begin, end - begin));
    begin = end + 1;
  }
  return lines;
}

// Schema semantics and relations that must hold for EVERY timing line. Never
// asserts that a successful wait is <= resultTimeoutMs (the existing
// scan-before-deadline ordering can accept a complete line after the
// deadline). The age relation is exact integer arithmetic on the same
// monotonic samples: detection = deadline + overshoot, deadline = wait start
// + resultTimeoutMs, wait start = write start + writeMs, write start >= ready.
void expectTimingRelations(
    const ParsedTiming& timing, int resultTimeoutMs, const std::string& label) {
  const bool hasExchange = timing.exchanges > 0;
  expect(
      timing.lastWaitKnown == hasExchange &&
          timing.maxWaitKnown == hasExchange &&
          timing.lastInferenceKnown == hasExchange &&
          timing.maxInferenceKnown == hasExchange,
      label + ": successful-exchange fields are na exactly when exchanges=0");
  expect(
      timing.maxWaitMs >= timing.lastWaitMs,
      label + ": maxWaitMs >= lastWaitMs");
  expect(
      timing.maxInferenceMs >= timing.lastInferenceMs,
      label + ": maxInferenceMs >= lastInferenceMs");
  expect(
      timing.slowWaits <= timing.exchanges, label + ": slowWaits <= exchanges");
  expect(
      timing.maxGapMs >= timing.overshootMs,
      label + ": maxGapMs >= overshootMs (the final gap spans the deadline)");
  expect(
      timing.ageMs >= timing.writeMs + timing.overshootMs +
              static_cast<unsigned long long>(resultTimeoutMs),
      label + ": ageMs >= writeMs + resultTimeoutMs + overshootMs");
}

// Asserts `lines[index]` is a strictly valid timing line for `generation` that
// satisfies every relation above, and returns it parsed.
ParsedTiming expectTimingLineAt(
    const std::vector<std::string>& lines,
    std::size_t index,
    int generation,
    const std::string& label) {
  ParsedTiming timing;
  const bool present = index < lines.size();
  expect(
      present, label + ": a timing line is present at the expected position");
  if (!present) {
    return timing;
  }
  const bool parsed = parseTimingLine(lines[index], timing);
  expect(parsed, label + ": the timing line matches the exact closed grammar");
  if (!parsed) {
    return timing;
  }
  expect(
      timing.generation == generation,
      label + ": generation=" + std::to_string(generation));
  expectTimingRelations(timing, kSmokeResultTimeoutMs, label);
  return timing;
}

// The terminal ResultTimeout frame's whole stderr: exactly the unchanged #587
// result-timeout line immediately followed by exactly one timing line.
ParsedTiming expectResultTimeoutWithTiming(
    const std::string& stderrText, int generation, const std::string& label) {
  const std::vector<std::string> lines = splitLines(stderrText, label);
  expect(
      lines.size() == 2,
      label + ": exactly two diagnostic lines on the timed-out frame");
  expect(
      !lines.empty() && lines[0] + "\n" == kResultTimeoutLine,
      label + ": the first line is exactly the approved result-timeout line");
  return expectTimingLineAt(lines, 1, generation, label);
}

// A small valid BGR24 frame (CV_8UC3). Never a camera frame.
PreprocessedFrame makeValidFrame(long long timestampMs) {
  PreprocessedFrame frame;
  frame.cameraFrame = CameraFrame{0, timestampMs, 4, 3, 30.0};
  frame.width = 4;
  frame.height = 3;
  frame.image = cv::Mat(3, 4, CV_8UC3, cv::Scalar(10, 20, 30));
  return frame;
}

// An invalid (empty) image: eligible for nothing, must fail closed to LOST
// without ever touching the helper for that frame.
PreprocessedFrame makeInvalidFrame(long long timestampMs) {
  PreprocessedFrame frame;
  frame.cameraFrame = CameraFrame{0, timestampMs, 4, 3, 30.0};
  frame.width = 4;
  frame.height = 3;
  frame.image = cv::Mat();  // empty
  return frame;
}

HelperSessionConfig baseChildConfig(const std::string& selfPath) {
  HelperSessionConfig config;
  config.executablePath = selfPath;
  config.invocationMode = HelperInvocationMode::ExactArguments;
  config.exactArguments = {kRecoveryChildArg};
  config.enableFrameTransport = true;
  config.expectedReadySource = kMediaPipeFaceLandmarkerReadySource;
  config.resultTimeoutMs = kSmokeResultTimeoutMs;
  config.stopTimeoutMs = kSmokeStopTimeoutMs;
  return config;
}

// A config that fails the ready handshake deterministically: the child emits
// the MediaPipe ready source, but the session is told to expect the synthetic
// source, so parseHelperReadyLine rejects it and start() fails closed with a
// start-path category (never a track-path #587 line).
HelperSessionConfig startFailureConfig(const std::string& selfPath) {
  HelperSessionConfig config = baseChildConfig(selfPath);
  config.expectedReadySource = kSyntheticHelperReadySource;
  return config;
}

// Case 1: healthy baseline -- several valid frames return Tracking, no terminal
// line, and the backend writes nothing to stdout.
void testHealthyBaseline(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "healthy: backend starts");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyDirectlyOwnsChild(),
      "healthy: backend directly owns a live child after start");
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 1,
      "healthy: lifetime recovery budget starts at exactly 1");
#endif

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  for (int i = 0; i < 3; ++i) {
    const TrackingSample sample = backend.track(makeValidFrame(1000 + i));
    expect(
        sample.status == TrackingStatus::Tracking,
        "healthy: valid frame " + std::to_string(i) + " returns Tracking");
  }
  expect(
      stderrCapture.str().find(kTerminalFailurePrefix) == std::string::npos,
      "healthy: no terminal-failure diagnostic on a healthy session");
  expect(
      stderrCapture.str().find(kRecoveryOutcomePrefix) == std::string::npos,
      "healthy: no recovery-outcome line without a recovery attempt");
  expect(
      stderrCapture.str().find(kFailureTimingPrefix) == std::string::npos,
      "healthy: no #616 timing line for a healthy");
  expect(
      stdoutCapture.str().empty(),
      "healthy (stream boundary): stdout stays empty during backend operation");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 1,
      "healthy: budget is never spent on a healthy session");
#endif

  backend.stop();
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "healthy: no child directly owned after a clean stop (reaped)");
#endif
}

// Case 2: exact one-time recovery. gen1 is healthy, then one designated slow
// frame times out (LOST + exactly one result-timeout line, no recovery inside
// the failing frame); the NEXT track() entry reconstructs, the replacement
// starts, and a valid frame returns Tracking through the replacement.
void testExactOneTimeRecovery(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "recovery: backend starts");

  // gen1 healthy frame.
  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample healthy = backend.track(makeValidFrame(1000));
    expect(
        healthy.status == TrackingStatus::Tracking,
        "recovery: gen1 healthy frame returns Tracking");
    expect(
        stderrCapture.str().empty(),
        "recovery: no diagnostic before the timeout");
  }

  // The timeout-triggering frame: LOST, exactly one #587 line, NO recovery yet.
  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "recovery: the timed-out frame returns the safe LOST fallback");
    // #616: the unchanged #587 line, immediately followed by exactly one
    // generation=1 timing line (one prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "recovery: gen1 emits exactly the one approved result-timeout line");
    expect(
        gen1Timing.exchanges == 1,
        "recovery: gen1 timing counts its one successful exchange");
    expect(
        stdoutCapture.str().empty(),
        "recovery (stream boundary): stdout stays empty on the failing frame");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    expect(
        backend.testOnlyRemainingRecoveryBudget() == 1,
        "recovery: budget is NOT spent inside the failing frame");
#endif
  }

  // The following track() entry reconstructs and exchanges through gen2.
  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample recovered = backend.track(makeValidFrame(1001));
    expect(
        recovered.status == TrackingStatus::Tracking,
        "recovery: a valid frame returns Tracking through the replacement");
    expect(
        stderrCapture.str().find(kTerminalFailurePrefix) == std::string::npos,
        "recovery: the successful replacement exchange emits no diagnostic");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupConfirmedReleaseLine) +
                kRecoverySucceededLine,
        "recovery: the successful replacement emits exactly the "
        "confirmed-release gen1-cleanup line immediately followed by the "
        "unchanged recovery-succeeded line");
    expect(
        stdoutCapture.str().empty(),
        "recovery (stream boundary): stdout stays empty through the "
        "replacement");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    expect(
        backend.testOnlyRemainingRecoveryBudget() == 0,
        "recovery: the single lifetime attempt is now spent (budget 0)");
    expect(
        backend.testOnlyDirectlyOwnsChild(),
        "recovery: the backend directly owns the fresh replacement child");
#endif
  }

  backend.stop();
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "recovery: no child directly owned after the replacement is stopped");
#endif
}

// Case 3: per-generation #587 and exhausted budget. gen1 times out (line 1) and
// recovers; the replacement gen2 later reaches a second ResultTimeout and emits
// its own one line (proving per-generation reporting); the budget is exhausted,
// so no second reconstruction occurs and later valid frames stay LOST.
void testExhaustedBudgetPerGeneration(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "exhausted: backend starts");

  StreamCapture stderrCapture(std::cerr);

  // gen1: timeout -> LOST + line 1.
  const TrackingSample gen1Timeout = backend.track(makeValidFrame(kSlowFrameTs));
  expect(
      gen1Timeout.status == TrackingStatus::Lost,
      "exhausted: gen1 timeout returns LOST");

  // Reconstruct on the next entry; gen2 is healthy for one frame.
  const TrackingSample gen2Healthy = backend.track(makeValidFrame(2000));
  expect(
      gen2Healthy.status == TrackingStatus::Tracking,
      "exhausted: gen2 returns Tracking after reconstruction");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 0,
      "exhausted: budget is spent after the single reconstruction");
#endif

  // gen2: second timeout -> LOST + line 2 (its own generation's line).
  const TrackingSample gen2Timeout = backend.track(makeValidFrame(kSlowFrameTs));
  expect(
      gen2Timeout.status == TrackingStatus::Lost,
      "exhausted: gen2 second timeout returns LOST");

  // Next entry: budget is exhausted, so NO second reconstruction. The failed
  // gen2 is not replaced; later otherwise-valid frames stay LOST.
  const TrackingSample afterBudget = backend.track(makeValidFrame(2001));
  expect(
      afterBudget.status == TrackingStatus::Lost,
      "exhausted: no second reconstruction -- frame stays LOST after the "
      "budget is exhausted");
  const TrackingSample afterBudget2 = backend.track(makeValidFrame(2002));
  expect(
      afterBudget2.status == TrackingStatus::Lost,
      "exhausted: the failed replacement stays LOST permanently");

  const std::string diagnostics = stderrCapture.str();
  expect(
      countOccurrences(diagnostics, kTerminalFailurePrefix) == 2,
      "exhausted: exactly two terminal lines -- one per successfully-started "
      "generation");
  expect(
      countOccurrences(diagnostics, kResultTimeoutLine) == 2,
      "exhausted: both lines are the fixed result-timeout category");
  expect(
      countOccurrences(diagnostics, kRecoverySucceededLine) == 1,
      "exhausted: exactly one recovery-succeeded line (the single "
      "reconstruction)");
  expect(
      countOccurrences(
          diagnostics, kRecoveryGen1CleanupConfirmedReleaseLine) == 1,
      "exhausted: exactly one gen1-cleanup line (the single reconstruction's "
      "gen1 cleanup)");
  expect(
      countOccurrences(diagnostics, kRecoveryOutcomePrefix) == 2,
      "exhausted: exactly the two lines of the single reconstruction "
      "(gen1-cleanup + recovery-succeeded) -- no third line once the budget "
      "is spent (gen2's own terminal timeout is a #587 line, not a new "
      "attempt)");

  // #616: exactly one timing line per failed generation, each immediately
  // after its own #587 line, and nothing after the budget is exhausted:
  // RT, timing(1), gen1-cleanup, succeeded, RT, timing(2).
  expect(
      countOccurrences(diagnostics, kFailureTimingPrefix) == 2,
      "exhausted: exactly two timing lines -- one per failed generation");
  const std::vector<std::string> lines =
      splitLines(diagnostics, "exhausted");
  expect(lines.size() == 6, "exhausted: exactly six diagnostic lines in total");
  if (lines.size() == 6) {
    expect(
        lines[0] + "\n" == kResultTimeoutLine &&
            lines[2] + "\n" == kRecoveryGen1CleanupConfirmedReleaseLine &&
            lines[3] + "\n" == kRecoverySucceededLine &&
            lines[4] + "\n" == kResultTimeoutLine,
        "exhausted: the existing #587/#589/#592 lines keep their order");
    const ParsedTiming gen1Timing =
        expectTimingLineAt(lines, 1, 1, "exhausted: gen1 timing");
    expect(
        gen1Timing.exchanges == 0,
        "exhausted: gen1 timed out on its first exchange (exchanges=0)");
    const ParsedTiming gen2Timing =
        expectTimingLineAt(lines, 5, 2, "exhausted: gen2 timing");
    expect(
        gen2Timing.exchanges == 1,
        "exhausted: gen2 counts only its own one successful exchange");
  }

  backend.stop();
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "exhausted: no child directly owned after stop");
#endif
}

// Case 4: legitimate no-face. A strict ok==true / status==lost response stays
// LOST while the session remains usable; a later valid frame returns Tracking
// from the same generation. No terminal line, no reconstruction.
void testLegitimateNoFace(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "no-face: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);

  const TrackingSample noFace = backend.track(makeValidFrame(kNoFaceFrameTs));
  expect(
      noFace.status == TrackingStatus::Lost,
      "no-face: a legitimate no-face result returns LOST");
  const TrackingSample stillUsable = backend.track(makeValidFrame(3000));
  expect(
      stillUsable.status == TrackingStatus::Tracking,
      "no-face: the same generation remains usable (Tracking afterward)");

  expect(
      stderrCapture.str().find(kTerminalFailurePrefix) == std::string::npos,
      "no-face: no terminal line for a legitimate no-face result");
  expect(
      stderrCapture.str().find(kRecoveryOutcomePrefix) == std::string::npos,
      "no-face: no recovery-outcome line without a recovery attempt");
  expect(
      stderrCapture.str().find(kFailureTimingPrefix) == std::string::npos,
      "no-face: no #616 timing line for a legitimate no-face");
  expect(
      stdoutCapture.str().empty(),
      "no-face (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 1,
      "no-face: budget is never touched (no reconstruction)");
#endif

  backend.stop();
}

// Case 5: non-terminal invalid image. An invalid image fails closed to LOST
// without touching or replacing the healthy session; a later valid frame proves
// the same generation is still usable. No terminal line, no reconstruction.
void testInvalidImageNonTerminal(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "invalid-image: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);

  const TrackingSample invalid = backend.track(makeInvalidFrame(4000));
  expect(
      invalid.status == TrackingStatus::Lost,
      "invalid-image: an invalid image fails closed to LOST");
  const TrackingSample stillUsable = backend.track(makeValidFrame(4001));
  expect(
      stillUsable.status == TrackingStatus::Tracking,
      "invalid-image: the healthy session is untouched (Tracking afterward)");

  expect(
      stderrCapture.str().find(kTerminalFailurePrefix) == std::string::npos,
      "invalid-image: no terminal line for a non-terminal invalid image");
  expect(
      stderrCapture.str().find(kRecoveryOutcomePrefix) == std::string::npos,
      "invalid-image: no recovery-outcome line without a recovery attempt");
  expect(
      stderrCapture.str().find(kFailureTimingPrefix) == std::string::npos,
      "invalid-image: no #616 timing line for a non-terminal invalid image");
  expect(
      stdoutCapture.str().empty(),
      "invalid-image (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 1,
      "invalid-image: budget is never touched (no reconstruction)");
#endif

  backend.stop();
}

// Case 6: other terminal category. A deterministic MalformedMessage terminal
// failure emits one correct #587 category line but must NOT reconstruct; the
// generation stays permanently LOST and the recovery budget is untouched.
void testOtherTerminalCategoryNoRecovery(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "other-terminal: backend starts");

  StreamCapture stderrCapture(std::cerr);

  const TrackingSample malformed = backend.track(makeValidFrame(kMalformedFrameTs));
  expect(
      malformed.status == TrackingStatus::Lost,
      "other-terminal: a malformed result returns LOST");
  expect(
      stderrCapture.str() == kMalformedMessageLine,
      "other-terminal: exactly one malformed-message category line");

  // The next entry must NOT reconstruct (category != ResultTimeout); the
  // generation stays permanently LOST.
  const TrackingSample afterMalformed = backend.track(makeValidFrame(5000));
  expect(
      afterMalformed.status == TrackingStatus::Lost,
      "other-terminal: no reconstruction for a non-ResultTimeout category");
  const TrackingSample afterMalformed2 = backend.track(makeValidFrame(5001));
  expect(
      afterMalformed2.status == TrackingStatus::Lost,
      "other-terminal: the failed generation stays LOST permanently");

  expect(
      countOccurrences(stderrCapture.str(), kTerminalFailurePrefix) == 1,
      "other-terminal: still exactly one terminal line (no reconstruction)");
  expect(
      stderrCapture.str().find(kRecoveryOutcomePrefix) == std::string::npos,
      "other-terminal: no recovery-outcome line for a non-ResultTimeout "
      "category");
  expect(
      stderrCapture.str().find(kFailureTimingPrefix) == std::string::npos,
      "other-terminal: no #616 timing line for a non-ResultTimeout terminal category");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 1,
      "other-terminal: the recovery budget is untouched by a non-ResultTimeout "
      "category");
#endif

  backend.stop();
}

// Case 7: start/ready failure. A failed initial ready handshake stays outside
// #587 and cannot trigger recovery; a defensive track() afterward returns LOST,
// emits no track-path terminal line, and never enters a restart loop.
void testStartFailureExcluded(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(
      startFailureConfig(selfPath));

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);

  expect(!backend.start(), "start-failure: backend start() fails closed");
  const TrackingSample defensive = backend.track(makeValidFrame(6000));
  expect(
      defensive.status == TrackingStatus::Lost,
      "start-failure: a defensive track() after a failed start returns LOST");
  const TrackingSample defensive2 = backend.track(makeValidFrame(6001));
  expect(
      defensive2.status == TrackingStatus::Lost,
      "start-failure: repeated track() stays LOST (no restart loop)");

  expect(
      stderrCapture.str().find(kTerminalFailurePrefix) == std::string::npos,
      "start-failure: a start/ready failure never emits a track-path terminal "
      "line");
  expect(
      stderrCapture.str().find(kRecoveryOutcomePrefix) == std::string::npos,
      "start-failure: no recovery-outcome line without a Reported track-path "
      "failure");
  expect(
      stderrCapture.str().find(kFailureTimingPrefix) == std::string::npos,
      "start-failure: no #616 timing line for a start/ready failure");
  expect(
      stdoutCapture.str().empty(),
      "start-failure (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 1,
      "start-failure: budget is untouched (recovery requires a successful "
      "start and a Reported track-path failure)");
#endif

  backend.stop();
}

// Synthetic frame-helper route: Disabled policy. The SAME timing-out child
// drives a SyntheticFrameHelperTrackingBackend: it must emit its one #587 line
// on the timeout but NEVER reconstruct, so a later valid frame stays LOST.
void testSyntheticRouteDoesNotRecover(const std::string& selfPath) {
  SyntheticFrameHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "synthetic-route: backend starts");

  StreamCapture stderrCapture(std::cerr);

  const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
  expect(
      timedOut.status == TrackingStatus::Lost,
      "synthetic-route: the timed-out frame returns LOST");

  // No reconstruction on the Disabled route: the failed session is not
  // replaced, so a later otherwise-valid frame stays LOST.
  const TrackingSample afterFailure = backend.track(makeValidFrame(7000));
  expect(
      afterFailure.status == TrackingStatus::Lost,
      "synthetic-route: Disabled policy never reconstructs -- frame stays LOST");
  const TrackingSample afterFailure2 = backend.track(makeValidFrame(7001));
  expect(
      afterFailure2.status == TrackingStatus::Lost,
      "synthetic-route: the failed session stays LOST permanently");

  expect(
      countOccurrences(stderrCapture.str(), kTerminalFailurePrefix) == 1,
      "synthetic-route: exactly one terminal line and no reconstruction");
  expect(
      countOccurrences(stderrCapture.str(), kResultTimeoutLine) == 1,
      "synthetic-route: the line is the fixed result-timeout category");
  expect(
      stderrCapture.str().find(kRecoveryOutcomePrefix) == std::string::npos,
      "synthetic-route: the Disabled policy never attempts recovery, so no "
      "recovery-outcome line is ever emitted");
  // #616: the synthetic frame-helper wrapper shares the timing diagnostic:
  // exactly one generation=1 line total, right after its #587 line.
  expectResultTimeoutWithTiming(
      stderrCapture.str(), 1,
      "synthetic-route: one result-timeout line plus one timing line total");

  backend.stop();
}

// Cases 9-12: the four deterministic replacement-failure outcomes (#589
// recovery-outcome observability). Each drives gen1 into the SAME natural
// ResultTimeout as testExactOneTimeRecovery, then uses the fixed, test-seam-
// only RecoveryTestOverride to force one specific outcome for the single
// approved REPLACEMENT construction/start only -- gen1 is always the same
// real, healthy, unmodified child. Never modifies HelperProcessSession,
// production defaults, or the trigger/budget/state-machine.

// Case 9: forced replacement launch failure -> exactly one
// "recovery failed (category=launch-failure)" line, then permanent LOST.
void testReplacementLaunchFailure(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "replacement-launch-failure: backend starts");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  backend.testOnlySetRecoveryOverride(
      MediaPipeFaceLandmarkerHelperTrackingBackend::RecoveryTestOverride::
          ForceLaunchFailure);
#endif

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "replacement-launch-failure: gen1 timeout returns LOST");
    // #616: the unchanged #587 line, immediately followed by exactly
    // one generation=1 timing line (no prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "replacement-launch-failure: gen1 emits exactly the result-timeout "
        "line");
    expect(
        gen1Timing.exchanges == 0 && !gen1Timing.lastWaitKnown,
        "replacement-launch-failure: gen1 timing reports exchanges=0 "
        "with na wait fields");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8000));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-launch-failure: the failed replacement returns LOST");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupConfirmedReleaseLine) +
                kRecoveryFailedLaunchFailureLine,
        "replacement-launch-failure: exactly the confirmed-release "
        "gen1-cleanup line immediately followed by the unchanged "
        "recovery-failed launch-failure line");
    expect(
        stdoutCapture.str().empty(),
        "replacement-launch-failure (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    expect(
        backend.testOnlyRemainingRecoveryBudget() == 0,
        "replacement-launch-failure: the single lifetime attempt is spent");
#endif
  }

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterBudget = backend.track(makeValidFrame(8001));
    expect(
        afterBudget.status == TrackingStatus::Lost,
        "replacement-launch-failure: stays LOST after the budget is spent");
    expect(
        stderrCapture.str().empty(),
        "replacement-launch-failure: no further diagnostic once the budget "
        "is spent");
  }

  backend.stop();
}

// Case 10: forced replacement ready timeout -> exactly one
// "recovery failed (category=ready-timeout)" line, then permanent LOST.
void testReplacementReadyTimeout(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "replacement-ready-timeout: backend starts");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  backend.testOnlySetRecoveryOverride(
      MediaPipeFaceLandmarkerHelperTrackingBackend::RecoveryTestOverride::
          ForceReadyTimeout);
#endif

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "replacement-ready-timeout: gen1 timeout returns LOST");
    // #616: the unchanged #587 line, immediately followed by exactly
    // one generation=1 timing line (no prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "replacement-ready-timeout: gen1 emits exactly the result-timeout "
        "line");
    expect(
        gen1Timing.exchanges == 0 && !gen1Timing.lastWaitKnown,
        "replacement-ready-timeout: gen1 timing reports exchanges=0 "
        "with na wait fields");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8100));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-ready-timeout: the failed replacement returns LOST");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupConfirmedReleaseLine) +
                kRecoveryFailedReadyTimeoutLine,
        "replacement-ready-timeout: exactly the confirmed-release "
        "gen1-cleanup line immediately followed by the unchanged "
        "recovery-failed ready-timeout line");
    expect(
        stdoutCapture.str().empty(),
        "replacement-ready-timeout (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    expect(
        backend.testOnlyRemainingRecoveryBudget() == 0,
        "replacement-ready-timeout: the single lifetime attempt is spent");
#endif
  }

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterBudget = backend.track(makeValidFrame(8101));
    expect(
        afterBudget.status == TrackingStatus::Lost,
        "replacement-ready-timeout: stays LOST after the budget is spent");
    expect(
        stderrCapture.str().empty(),
        "replacement-ready-timeout: no further diagnostic once the budget "
        "is spent");
  }

  backend.stop();
}

// Case 11: forced replacement malformed ready -> exactly one
// "recovery failed (category=malformed-message)" line, then permanent LOST.
void testReplacementMalformedReady(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "replacement-malformed-ready: backend starts");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  backend.testOnlySetRecoveryOverride(
      MediaPipeFaceLandmarkerHelperTrackingBackend::RecoveryTestOverride::
          ForceMalformedReady);
#endif

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "replacement-malformed-ready: gen1 timeout returns LOST");
    // #616: the unchanged #587 line, immediately followed by exactly
    // one generation=1 timing line (no prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "replacement-malformed-ready: gen1 emits exactly the result-timeout "
        "line");
    expect(
        gen1Timing.exchanges == 0 && !gen1Timing.lastWaitKnown,
        "replacement-malformed-ready: gen1 timing reports exchanges=0 "
        "with na wait fields");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8200));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-malformed-ready: the failed replacement returns LOST");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupConfirmedReleaseLine) +
                kRecoveryFailedMalformedMessageLine,
        "replacement-malformed-ready: exactly the confirmed-release "
        "gen1-cleanup line immediately followed by the unchanged "
        "recovery-failed malformed-message line");
    expect(
        stdoutCapture.str().empty(),
        "replacement-malformed-ready (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    expect(
        backend.testOnlyRemainingRecoveryBudget() == 0,
        "replacement-malformed-ready: the single lifetime attempt is spent");
#endif
  }

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterBudget = backend.track(makeValidFrame(8201));
    expect(
        afterBudget.status == TrackingStatus::Lost,
        "replacement-malformed-ready: stays LOST after the budget is spent");
    expect(
        stderrCapture.str().empty(),
        "replacement-malformed-ready: no further diagnostic once the budget "
        "is spent");
  }

  backend.stop();
}

// Case 12: deterministic test-only replacement construction exception ->
// session_ left null, exactly one "recovery failed (category=none)" line,
// then permanent LOST. Proves the exception/null path never leaks raw
// exception text and always maps to the fixed "none" label.
void testReplacementConstructThrow(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "replacement-none: backend starts");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  backend.testOnlySetRecoveryOverride(
      MediaPipeFaceLandmarkerHelperTrackingBackend::RecoveryTestOverride::
          ForceConstructThrow);
#endif

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "replacement-none: gen1 timeout returns LOST");
    // #616: the unchanged #587 line, immediately followed by exactly
    // one generation=1 timing line (no prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "replacement-none: gen1 emits exactly the result-timeout line");
    expect(
        gen1Timing.exchanges == 0 && !gen1Timing.lastWaitKnown,
        "replacement-none: gen1 timing reports exchanges=0 "
        "with na wait fields");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8300));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-none: the forced construction failure returns LOST");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupConfirmedReleaseLine) +
                kRecoveryFailedNoneLine,
        "replacement-none: exactly the confirmed-release gen1-cleanup line "
        "immediately followed by the unchanged recovery-failed none line, "
        "never raw exception text");
    expect(
        stdoutCapture.str().empty(),
        "replacement-none (stream boundary): stdout stays empty");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    expect(
        backend.testOnlyRemainingRecoveryBudget() == 0,
        "replacement-none: the single lifetime attempt is spent");
    expect(
        !backend.testOnlyDirectlyOwnsChild(),
        "replacement-none: no child owned after a forced construction "
        "failure (session_ left null)");
#endif
  }

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterBudget = backend.track(makeValidFrame(8301));
    expect(
        afterBudget.status == TrackingStatus::Lost,
        "replacement-none: stays LOST after the budget is spent");
    expect(
        stderrCapture.str().empty(),
        "replacement-none: no further diagnostic once the budget is spent");
  }

  backend.stop();
}

// ---------------------------------------------------------------------------
// #616 diagnostic-only ResultTimeout timing cases.
// ---------------------------------------------------------------------------

// Case 15: the shared saturation/rounding clamps behind every timing value.
// Boundaries only; no process, clock, or child involved.
void testTimingSaturation() {
  constexpr unsigned long long cap = kHelperTimingSaturationCap;
  static_assert(cap == 999999999ull, "the #616 cap is exactly 999999999");
  expect(saturateHelperTimingValue(LLONG_MIN) == 0, "saturate: LLONG_MIN -> 0");
  expect(saturateHelperTimingValue(-1LL) == 0, "saturate: -1 -> 0");
  expect(saturateHelperTimingValue(0LL) == 0, "saturate: 0 -> 0");
  expect(saturateHelperTimingValue(1LL) == 1, "saturate: 1 -> 1");
  expect(
      saturateHelperTimingValue(static_cast<long long>(cap) - 1) == cap - 1,
      "saturate: cap-1 is kept");
  expect(
      saturateHelperTimingValue(static_cast<long long>(cap)) == cap,
      "saturate: cap is kept");
  expect(
      saturateHelperTimingValue(static_cast<long long>(cap) + 1) == cap,
      "saturate: cap+1 -> cap");
  expect(saturateHelperTimingValue(LLONG_MAX) == cap, "saturate: LLONG_MAX -> cap");
  expect(saturateHelperTimingCount(0ull) == 0, "saturate count: 0 -> 0");
  expect(saturateHelperTimingCount(cap) == cap, "saturate count: cap is kept");
  expect(
      saturateHelperTimingCount(ULLONG_MAX) == cap,
      "saturate count: ULLONG_MAX -> cap (no wraparound)");
  expect(
      saturateHelperTimingDouble(std::numeric_limits<double>::quiet_NaN()) == 0,
      "saturate double: NaN -> 0");
  expect(
      saturateHelperTimingDouble(-std::numeric_limits<double>::infinity()) == 0,
      "saturate double: -inf -> 0");
  expect(
      saturateHelperTimingDouble(std::numeric_limits<double>::infinity()) == cap,
      "saturate double: +inf -> cap");
  expect(saturateHelperTimingDouble(-0.0) == 0, "saturate double: -0.0 -> 0");
  expect(saturateHelperTimingDouble(-5.0) == 0, "saturate double: -5 -> 0");
  expect(saturateHelperTimingDouble(0.49) == 0, "saturate double: 0.49 -> 0");
  expect(saturateHelperTimingDouble(0.5) == 1, "saturate double: 0.5 -> 1");
  expect(saturateHelperTimingDouble(7.6) == 8, "saturate double: 7.6 -> 8");
  expect(saturateHelperTimingDouble(12.4) == 12, "saturate double: 12.4 -> 12");
  expect(
      saturateHelperTimingDouble(999999998.6) == cap,
      "saturate double: rounding up to the cap stays at the cap");
  expect(saturateHelperTimingDouble(1.0e300) == cap, "saturate double: 1e300 -> cap");
}

// Case 16: the full two-generation sequence with explicit helper inference
// values. gen1 has three successful exchanges (including a legitimate no-face
// result and a diag-less envelope) before its terminal ResultTimeout; gen2 has
// two (a saturating value, then a negative one) before its own. Proves
// per-generation counts, inference rounding/saturation/omission-to-zero,
// exact line ordering, the unchanged single-attempt budget, clean stdout, and
// no orphaned child.
void testFailureTimingTwoGenerations(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "timing-two-gen: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);

  expect(
      backend.track(makeValidFrame(kInference12FrameTs)).status ==
          TrackingStatus::Tracking,
      "timing-two-gen: gen1 explicit-inference frame returns Tracking");
  expect(
      backend.track(makeValidFrame(kNoFaceInference8FrameTs)).status ==
          TrackingStatus::Lost,
      "timing-two-gen: gen1 legitimate no-face frame returns LOST");
  expect(
      backend.track(makeValidFrame(kNoDiagFrameTs)).status ==
          TrackingStatus::Tracking,
      "timing-two-gen: gen1 diag-less frame returns Tracking");
  expect(
      stderrCapture.str().empty(),
      "timing-two-gen: no diagnostic for healthy/no-face exchanges");
  expect(
      backend.track(makeValidFrame(kSlowFrameTs)).status == TrackingStatus::Lost,
      "timing-two-gen: gen1 timeout returns LOST");

  // Next entry recovers; gen2 exchanges twice, then times out.
  expect(
      backend.track(makeValidFrame(kHugeInferenceFrameTs)).status ==
          TrackingStatus::Tracking,
      "timing-two-gen: gen2 saturating-inference frame returns Tracking");
  expect(
      backend.track(makeValidFrame(kNegativeInferenceFrameTs)).status ==
          TrackingStatus::Tracking,
      "timing-two-gen: gen2 negative-inference frame returns Tracking");
  expect(
      backend.track(makeValidFrame(kSlowFrameTs)).status == TrackingStatus::Lost,
      "timing-two-gen: gen2 timeout returns LOST");

  // Budget exhausted: no reconstruction and no further line of any kind.
  expect(
      backend.track(makeValidFrame(9000)).status == TrackingStatus::Lost,
      "timing-two-gen: stays LOST once the budget is spent");
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      backend.testOnlyRemainingRecoveryBudget() == 0,
      "timing-two-gen: the single-attempt budget is unchanged (spent once)");
#endif

  const std::vector<std::string> lines =
      splitLines(stderrCapture.str(), "timing-two-gen");
  expect(lines.size() == 6, "timing-two-gen: exactly six diagnostic lines");
  if (lines.size() == 6) {
    expect(
        lines[0] + "\n" == kResultTimeoutLine &&
            lines[2] + "\n" == kRecoveryGen1CleanupConfirmedReleaseLine &&
            lines[3] + "\n" == kRecoverySucceededLine &&
            lines[4] + "\n" == kResultTimeoutLine,
        "timing-two-gen: RT, timing, gen1-cleanup, succeeded, RT, timing");
    const ParsedTiming gen1 =
        expectTimingLineAt(lines, 1, 1, "timing-two-gen: gen1 timing");
    expect(
        gen1.exchanges == 3,
        "timing-two-gen: gen1 counts all three successful exchanges, "
        "including the no-face result");
    expect(
        gen1.lastInferenceMs == 0 && gen1.maxInferenceMs == 12,
        "timing-two-gen: gen1 inference is last=0 (diag omitted) / max=12 "
        "(12.4 and 7.6 rounded)");
    const ParsedTiming gen2 =
        expectTimingLineAt(lines, 5, 2, "timing-two-gen: gen2 timing");
    expect(
        gen2.exchanges == 2,
        "timing-two-gen: gen2 counts only its own two successful exchanges");
    expect(
        gen2.lastInferenceMs == 0 && gen2.maxInferenceMs == kHelperTimingSaturationCap,
        "timing-two-gen: gen2 inference is last=0 (negative clamped) / "
        "max=999999999 (saturated)");
  }
  expect(
      stdoutCapture.str().empty(),
      "timing-two-gen (stream boundary): stdout stays empty");

  backend.stop();
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "timing-two-gen: no child directly owned after stop");
#endif
}

// Case 17: the replacement's FIRST attempted exchange times out. The recovery
// and gen2's terminal timeout happen in the same track() call, so its timing
// line reports generation=2, exchanges=0, and every successful-exchange field
// na -- proving failure on the first replacement exchange, not its cause.
void testReplacementFirstExchangeTimesOut(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "timing-gen2-first: backend starts");

  {
    StreamCapture stderrCapture(std::cerr);
    backend.track(makeValidFrame(9100));
    backend.track(makeValidFrame(9101));
    backend.track(makeValidFrame(kSlowFrameTs));
    const ParsedTiming gen1 = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1, "timing-gen2-first: gen1 timeout");
    expect(gen1.exchanges == 2, "timing-gen2-first: gen1 exchanges=2");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample sample = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        sample.status == TrackingStatus::Lost,
        "timing-gen2-first: the replacement's first exchange returns LOST");
    const std::vector<std::string> lines =
        splitLines(stderrCapture.str(), "timing-gen2-first");
    expect(
        lines.size() == 4,
        "timing-gen2-first: exactly gen1-cleanup, succeeded, RT, timing");
    if (lines.size() == 4) {
      expect(
          lines[0] + "\n" == kRecoveryGen1CleanupConfirmedReleaseLine &&
              lines[1] + "\n" == kRecoverySucceededLine &&
              lines[2] + "\n" == kResultTimeoutLine,
          "timing-gen2-first: the existing lines keep their order");
      const ParsedTiming gen2 =
          expectTimingLineAt(lines, 3, 2, "timing-gen2-first: gen2 timing");
      expect(
          gen2.exchanges == 0 && !gen2.lastWaitKnown && !gen2.maxWaitKnown &&
              !gen2.lastInferenceKnown && !gen2.maxInferenceKnown &&
              gen2.slowWaits == 0,
          "timing-gen2-first: generation=2, exchanges=0, all "
          "successful-exchange fields na");
    }
    expect(
        stdoutCapture.str().empty(),
        "timing-gen2-first (stream boundary): stdout stays empty");
  }

  {
    StreamCapture stderrCapture(std::cerr);
    expect(
        backend.track(makeValidFrame(9102)).status == TrackingStatus::Lost,
        "timing-gen2-first: stays LOST after the budget is spent");
    expect(
        stderrCapture.str().empty(),
        "timing-gen2-first: no further diagnostic once the budget is spent");
  }

  backend.stop();
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "timing-gen2-first: no child directly owned after stop");
#endif
}

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
// Stall length for the #616 one-shot result-wait stall seam: three result
// timeouts, so every assertion below is a relation against the config, never
// an absolute wall-clock threshold.
constexpr int kTimingStallMs = 3 * kSmokeResultTimeoutMs;

// Case 18: a controlled stall after the failed wait's first pump. The child's
// slow-frame delay (kChildSlowSleepMs) outlasts result timeout + stall, so the
// timeout is guaranteed; the stall must then show up as overshoot beyond the
// whole result timeout, and the maximum check-to-check gap must cover it.
void testFailureTimingStallAfterFirstPump(const std::string& selfPath) {
  static_assert(
      kChildSlowSleepMs > kSmokeResultTimeoutMs + kTimingStallMs,
      "the slow child must outlast the result wait plus the stall");
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "timing-stall-first-pump: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  test_seam::setNextResultWaitStall(
      test_seam::ResultWaitStallMode::AfterFirstPump, kTimingStallMs);
  expect(
      backend.track(makeValidFrame(kSlowFrameTs)).status == TrackingStatus::Lost,
      "timing-stall-first-pump: the timed-out frame returns LOST");
  expect(
      !test_seam::resultWaitStallArmedForTest(),
      "timing-stall-first-pump: the one-shot stall fired");
  const ParsedTiming timing = expectResultTimeoutWithTiming(
      stderrCapture.str(), 1, "timing-stall-first-pump");
  // overshoot >= (pump return + stall) - deadline >= stall - resultTimeout.
  expect(
      timing.overshootMs > static_cast<unsigned long long>(kSmokeResultTimeoutMs),
      "timing-stall-first-pump: overshootMs exceeds the whole result timeout");
  expect(
      timing.maxGapMs >= timing.overshootMs,
      "timing-stall-first-pump: maxGapMs covers the stalled interval");
  expect(
      stdoutCapture.str().empty(),
      "timing-stall-first-pump (stream boundary): stdout stays empty");

  backend.stop();
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "timing-stall-first-pump: no child directly owned after stop");
}

// Case 19: the existing scan-before-deadline ordering. The stall fires only
// once a COMPLETE response line is already buffered, then outlasts the result
// deadline; the next scan still accepts that line, so the exchange succeeds
// after its deadline. A later natural timeout's timing line must then report
// that successful wait as longer than resultTimeoutMs and as a slow wait.
void testSuccessfulWaitAcceptedAfterDeadline(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(baseChildConfig(selfPath));
  expect(backend.start(), "timing-late-accept: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  test_seam::setNextResultWaitStall(
      test_seam::ResultWaitStallMode::AfterCompleteLineBuffered, kTimingStallMs);
  expect(
      backend.track(makeValidFrame(9200)).status == TrackingStatus::Tracking,
      "timing-late-accept: a complete line buffered before the deadline is "
      "accepted after it");
  expect(
      !test_seam::resultWaitStallArmedForTest(),
      "timing-late-accept: the stall fired with a complete line buffered");
  expect(
      stderrCapture.str().empty(),
      "timing-late-accept: the late successful exchange emits no diagnostic");

  expect(
      backend.track(makeValidFrame(kSlowFrameTs)).status == TrackingStatus::Lost,
      "timing-late-accept: the following slow frame times out");
  const ParsedTiming timing = expectResultTimeoutWithTiming(
      stderrCapture.str(), 1, "timing-late-accept");
  expect(timing.exchanges == 1, "timing-late-accept: exactly one exchange");
  expect(
      timing.lastWaitMs == timing.maxWaitMs,
      "timing-late-accept: last and max wait are the single successful wait");
  expect(
      timing.lastWaitMs > static_cast<unsigned long long>(kSmokeResultTimeoutMs),
      "timing-late-accept: the successful wait exceeded resultTimeoutMs");
  expect(
      timing.slowWaits == 1,
      "timing-late-accept: the late wait counts as one slow wait");
  expect(
      timing.lastInferenceMs == 0 && timing.maxInferenceMs == 0,
      "timing-late-accept: a reported 0.0 inference reads as 0");
  expect(
      stdoutCapture.str().empty(),
      "timing-late-accept (stream boundary): stdout stays empty");

  backend.stop();
  expect(
      !backend.testOnlyDirectlyOwnsChild(),
      "timing-late-accept: no child directly owned after stop");
  expect(
      HelperProcessCleanupRegistry::instance().pendingCount() == 0,
      "timing-late-accept: no durable registry entry left behind");
}
#endif

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
// Pumps the durable cleanup registry until it drains or the bounded deadline
// elapses, returning the final pending count. Mirrors the equivalent helper
// in the frame-transport smoke: the transferred real child is reaped only
// once its already-issued terminate request is actually confirmed by a
// later poll(), so a short bounded poll loop is used rather than assuming
// instantaneous resolution.
std::size_t pumpRegistryUntilEmptyOrDeadline(int deadlineMs) {
  auto& registry = HelperProcessCleanupRegistry::instance();
  const auto start = std::chrono::steady_clock::now();
  std::size_t remaining = registry.pump();
  while (remaining > 0) {
    const auto elapsed =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start)
            .count();
    if (elapsed >= deadlineMs) {
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    remaining = registry.pump();
  }
  return remaining;
}

// Case 13 (#592): the dedicated Failed-state-reachable one-shot cleanup-
// resolve throw seam forces resolveChildCleanup()'s catch path during gen1's
// recovery cleanup, proving it reports the fixed "unknown" disposition, runs
// the existing bounded noexcept emergencyResolveChildOwnership(), and leaves
// no directly owned child, prepared fallback, or durable registry entry
// behind -- and that the later destructor call performs no second cleanup
// attempt and emits nothing extra.
void testGen1CleanupUnknownDisposition(const std::string& selfPath) {
  MediaPipeFaceLandmarkerHelperTrackingBackend backend(
      baseChildConfig(selfPath));
  expect(backend.start(), "gen1-cleanup-unknown: backend starts");

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "gen1-cleanup-unknown: gen1 timeout returns LOST");
    // #616: the unchanged #587 line, immediately followed by exactly
    // one generation=1 timing line (no prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "gen1-cleanup-unknown: gen1 emits exactly the result-timeout line");
    expect(
        gen1Timing.exchanges == 0 && !gen1Timing.lastWaitKnown,
        "gen1-cleanup-unknown: gen1 timing reports exchanges=0 "
        "with na wait fields");
  }

  // Arm the Failed-state-reachable one-shot throw seam AFTER the terminal
  // ResultTimeout frame and BEFORE the recovery track() call, so it fires
  // inside the recovery attempt's resolveChildCleanup() -> stop() while gen1
  // is already Failed -- never reachable through the existing graceful-
  // stop-only setForceNextGracefulStopThrow seam.
  test_seam::setForceNextCleanupResolveThrow(true);

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample recovered = backend.track(makeValidFrame(8400));
    expect(
        recovered.status == TrackingStatus::Tracking,
        "gen1-cleanup-unknown: a valid frame returns Tracking through the "
        "replacement");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupUnknownLine) +
                kRecoverySucceededLine,
        "gen1-cleanup-unknown: exactly the unknown gen1-cleanup line "
        "immediately followed by the unchanged recovery-succeeded line");
    expect(
        stdoutCapture.str().empty(),
        "gen1-cleanup-unknown (stream boundary): stdout stays empty");
  }

  expect(
      HelperProcessCleanupRegistry::instance().pendingCount() == 0,
      "gen1-cleanup-unknown: the emergency ownership path leaves no durable "
      "registry entry (no directly owned child or prepared fallback "
      "survives)");

  // The replacement generation (gen2) is healthy and still running at this
  // point, so it legitimately holds its own outstanding child-fallback
  // reservation for its whole lifetime -- the reservation baseline is only
  // meaningful once gen2 itself is stopped below.
  backend.stop();

  expect(
      HelperProcessCleanupRegistry::instance()
              .childFallbackReservationCountForTest() == 0,
      "gen1-cleanup-unknown: the child-fallback reservation returns to "
      "baseline once the replacement generation is stopped");
}

// Case 14 (#592): the existing fixed one-shot child-cleanup-timeout seam
// forces gen1's directly owned real child to be committed to the durable
// cleanup registry instead of confirmed-released, proving the
// "deferred-registry-transfer" disposition. Run LAST: disableAutoWorkerForTest()
// is process-global, so every earlier test in this binary must keep relying
// on the registry's normal (worker-driven or immediately-confirmed) behavior
// undisturbed.
void testGen1CleanupDeferredRegistryTransfer(const std::string& selfPath) {
  auto& registry = HelperProcessCleanupRegistry::instance();
  expect(
      registry.pendingCount() == 0,
      "gen1-cleanup-deferred: the initial registry baseline is zero");
  registry.disableAutoWorkerForTest();

  MediaPipeFaceLandmarkerHelperTrackingBackend backend(
      baseChildConfig(selfPath));
  expect(backend.start(), "gen1-cleanup-deferred: backend starts");

  {
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample timedOut = backend.track(makeValidFrame(kSlowFrameTs));
    expect(
        timedOut.status == TrackingStatus::Lost,
        "gen1-cleanup-deferred: gen1 timeout returns LOST");
    // #616: the unchanged #587 line, immediately followed by exactly
    // one generation=1 timing line (no prior successful exchange).
    const ParsedTiming gen1Timing = expectResultTimeoutWithTiming(
        stderrCapture.str(), 1,
        "gen1-cleanup-deferred: gen1 emits exactly the result-timeout line");
    expect(
        gen1Timing.exchanges == 0 && !gen1Timing.lastWaitKnown,
        "gen1-cleanup-deferred: gen1 timing reports exchanges=0 "
        "with na wait fields");
  }

  // Force the next bounded termination to report unresolved (the request is
  // still actually issued -- see setForceNextChildCleanupTimeout), so gen1's
  // recovery cleanup commits the already-prepared fallback to the durable
  // registry instead of confirming release.
  test_seam::setForceNextChildCleanupTimeout(true);

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample recovered = backend.track(makeValidFrame(8500));
    expect(
        recovered.status == TrackingStatus::Tracking,
        "gen1-cleanup-deferred: a valid frame returns Tracking through the "
        "replacement");
    expect(
        stderrCapture.str() ==
            std::string(kRecoveryGen1CleanupDeferredRegistryTransferLine) +
                kRecoverySucceededLine,
        "gen1-cleanup-deferred: exactly the deferred-registry-transfer "
        "gen1-cleanup line immediately followed by the unchanged "
        "recovery-succeeded line");
    expect(
        stdoutCapture.str().empty(),
        "gen1-cleanup-deferred (stream boundary): stdout stays empty");
  }

  // The transferred entry may already be opportunistically resolved by this
  // point: the SAME recovery track() call above also exchanges a frame
  // through the healthy replacement (gen2), and gen2's own frame-transport
  // write reserves the registry's independent writer slot via tryReserve(),
  // which pumps (and can therefore reap) any already-resolvable entry as a
  // side effect -- including gen1's real, already-terminated child. Either
  // way there is never more than the one transferred entry, and the bounded
  // drain below is the authoritative proof that it returns to baseline.
  expect(
      registry.pendingCount() <= 1,
      "gen1-cleanup-deferred: at most the single transferred entry is ever "
      "pending immediately after the recovery attempt");
  expect(
      pumpRegistryUntilEmptyOrDeadline(5000) == 0,
      "gen1-cleanup-deferred: bounded pump() calls drain the transferred "
      "entry back to the captured zero baseline");

  // gen2 is healthy and still running at this point, so it legitimately
  // holds its own outstanding child-fallback reservation for its whole
  // lifetime -- the reservation baseline is only meaningful once gen2 itself
  // is stopped below.
  backend.stop();

  expect(
      registry.childFallbackReservationCountForTest() == 0,
      "gen1-cleanup-deferred: the child-fallback reservation returns to "
      "baseline once the replacement generation is stopped");
}
#endif

int runTests(const std::string& selfPath) {
  testHealthyBaseline(selfPath);
  testExactOneTimeRecovery(selfPath);
  testExhaustedBudgetPerGeneration(selfPath);
  testLegitimateNoFace(selfPath);
  testInvalidImageNonTerminal(selfPath);
  testOtherTerminalCategoryNoRecovery(selfPath);
  testStartFailureExcluded(selfPath);
  testSyntheticRouteDoesNotRecover(selfPath);
  testReplacementLaunchFailure(selfPath);
  testReplacementReadyTimeout(selfPath);
  testReplacementMalformedReady(selfPath);
  testReplacementConstructThrow(selfPath);
  testTimingSaturation();
  testFailureTimingTwoGenerations(selfPath);
  testReplacementFirstExchangeTimesOut(selfPath);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  testFailureTimingStallAfterFirstPump(selfPath);
  testSuccessfulWaitAcceptedAfterDeadline(selfPath);
  testGen1CleanupUnknownDisposition(selfPath);
  // Must run last: disableAutoWorkerForTest() is process-global.
  testGen1CleanupDeferredRegistryTransfer(selfPath);
#endif

  if (gFailures != 0) {
    std::cerr << "[recovery-smoke] " << gFailures << " assertion(s) failed.\n";
    return 1;
  }
  std::cout << "tracking-backend result-timeout recovery smoke OK\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc >= 2 && std::string(argv[1]) == kRecoveryChildArg) {
    return runRecoveryTestChild();
  }
  return runTests(argv[0]);
}
