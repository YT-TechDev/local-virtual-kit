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
#include "helper_process_session.h"

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
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
using lvk::tracker::HelperSessionConfig;
using lvk::tracker::kMediaPipeFaceLandmarkerReadySource;
using lvk::tracker::kSyntheticHelperReadySource;
using lvk::tracker::MediaPipeFaceLandmarkerHelperTrackingBackend;
using lvk::tracker::PreprocessedFrame;
using lvk::tracker::SyntheticFrameHelperTrackingBackend;
using lvk::tracker::TrackingSample;
using lvk::tracker::TrackingStatus;

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

// Caller-controlled frame-timestamp sentinels selecting the child's per-frame
// behavior. Any timestamp not listed here is an ordinary tracking frame.
constexpr long long kSlowFrameTs = 900001;       // delayed result -> ResultTimeout
constexpr long long kNoFaceFrameTs = 900002;     // ok==true, status==lost
constexpr long long kMalformedFrameTs = 900003;  // unparseable result

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
    std::uint32_t ackChecksum) {
  std::cout << std::fixed << std::setprecision(6);
  std::cout << "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":"
            << requestId << ",\"frameTimestampMs\":" << frameTimestampMs
            << ",\"status\":\"" << status << "\",\"confidence\":" << confidence
            << ",\"faceRotation\":{\"pitch\":" << 0.0 << ",\"yaw\":" << 0.0
            << ",\"roll\":" << 0.0 << "},\"eyes\":{\"leftOpen\":" << 1.0
            << ",\"rightOpen\":" << 1.0 << "},\"mouth\":{\"open\":" << 0.0
            << ",\"smile\":" << 0.0 << "},\"diag\":{\"inferenceMs\":" << 0.0
            << "},\"frameAck\":{\"sequence\":" << ackSequence
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
    expect(
        stderrCapture.str() == kResultTimeoutLine,
        "recovery: gen1 emits exactly the one approved result-timeout line");
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
        stderrCapture.str() == kRecoverySucceededLine,
        "recovery: the successful replacement emits exactly the recovery "
        "succeeded line");
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
      countOccurrences(diagnostics, kRecoveryOutcomePrefix) == 1,
      "exhausted: no second recovery-outcome line once the budget is spent "
      "(gen2's own terminal timeout is a #587 line, not a new attempt)");

  backend.stop();
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
    expect(
        stderrCapture.str() == kResultTimeoutLine,
        "replacement-launch-failure: gen1 emits exactly the result-timeout "
        "line");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8000));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-launch-failure: the failed replacement returns LOST");
    expect(
        stderrCapture.str() == kRecoveryFailedLaunchFailureLine,
        "replacement-launch-failure: exactly one recovery-failed "
        "launch-failure line");
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
    expect(
        stderrCapture.str() == kResultTimeoutLine,
        "replacement-ready-timeout: gen1 emits exactly the result-timeout "
        "line");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8100));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-ready-timeout: the failed replacement returns LOST");
    expect(
        stderrCapture.str() == kRecoveryFailedReadyTimeoutLine,
        "replacement-ready-timeout: exactly one recovery-failed "
        "ready-timeout line");
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
    expect(
        stderrCapture.str() == kResultTimeoutLine,
        "replacement-malformed-ready: gen1 emits exactly the result-timeout "
        "line");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8200));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-malformed-ready: the failed replacement returns LOST");
    expect(
        stderrCapture.str() == kRecoveryFailedMalformedMessageLine,
        "replacement-malformed-ready: exactly one recovery-failed "
        "malformed-message line");
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
    expect(
        stderrCapture.str() == kResultTimeoutLine,
        "replacement-none: gen1 emits exactly the result-timeout line");
  }

  {
    StreamCapture stdoutCapture(std::cout);
    StreamCapture stderrCapture(std::cerr);
    const TrackingSample afterAttempt = backend.track(makeValidFrame(8300));
    expect(
        afterAttempt.status == TrackingStatus::Lost,
        "replacement-none: the forced construction failure returns LOST");
    expect(
        stderrCapture.str() == kRecoveryFailedNoneLine,
        "replacement-none: exactly one recovery-failed none line, never raw "
        "exception text");
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
