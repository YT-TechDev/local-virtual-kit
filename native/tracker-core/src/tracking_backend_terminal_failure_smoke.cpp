// Helper-session terminal-failure diagnostic smoke (#587).
//
// Deterministic, behavioral, sub-second native smoke that exercises the real
// production SyntheticHelperTrackingBackend::track() path -- and therefore the
// shared internal reporter it shares with FrameHelperTrackingBackend -- against
// lvk-synthetic-helper. No OpenCV, no camera, no real MediaPipe, no network, no
// soak. Proves the exact public contract:
//
//   [helper-session] session failed (category=<label>)
//
// emitted at most once per backend/session, strictly when
// HelperProcessSession::state() == Failed is first observed on the track()
// path with an authorized terminal category -- never on
// HelperTrackOutcome::ok == false alone, never for a legitimate no-face
// result, and never for the separate start()/ready or stop()/shutdown
// diagnostics.
//
// Case 2 (legitimate no-face) needs a helper that returns a successful
// ok == true session result with status "lost". lvk-synthetic-helper's
// session mode always reports status "tracking" and has no such fault mode,
// and per the approved #587 design this smoke may not add a production
// helper flag, modify lvk-synthetic-helper, or add a test seam to
// HelperProcessSession. So this file re-execs itself (via the existing,
// already-approved HelperInvocationMode::ExactArguments caller-owned-argv
// path) as a minimal, self-contained test-child session responder -- see
// runLostSessionTestChild() below -- that speaks just enough of the existing
// #533 session protocol (ready / one result-per-request / stop) to produce a
// real, strictly-parsed ok == true / status == lost exchange.

#include "tracking_backend.h"

#include "helper_process_session.h"

#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

int gFailures = 0;

void expect(bool condition, const std::string& what) {
  if (!condition) {
    ++gFailures;
    std::cerr << "[tracking-backend-terminal-failure-smoke] FAILED: " << what
              << "\n";
  }
}

using lvk::tracker::CameraFrame;
using lvk::tracker::HelperDiagnosticCategory;
using lvk::tracker::HelperInvocationMode;
using lvk::tracker::HelperProcessSession;
using lvk::tracker::HelperSessionConfig;
using lvk::tracker::HelperSessionState;
using lvk::tracker::HelperTrackOutcome;
using lvk::tracker::PreprocessedFrame;
using lvk::tracker::SyntheticHelperTrackingBackend;
using lvk::tracker::TrackingSample;
using lvk::tracker::TrackingStatus;

// Marker argument identifying the self-exec test-child mode. Smoke-local
// only: never a production helper flag, never parsed by lvk-synthetic-helper
// or HelperProcessSession.
constexpr const char* kLostSessionChildArg =
    "--lvk-terminal-failure-smoke-lost-session-child";

constexpr const char* kTerminalFailureLine =
    "[helper-session] session failed (category=result-timeout)\n";

PreprocessedFrame makeFrame(long long timestampMs) {
  PreprocessedFrame frame;
  frame.cameraFrame = CameraFrame{0, timestampMs, 4, 3, 30.0};
  frame.width = 4;
  frame.height = 3;
  return frame;
}

// Captures a std::ostream's stream buffer for the object's lifetime and
// restores the original buffer on destruction, so stdout/stderr can be
// captured deterministically in-process without spawning a subprocess.
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

HelperSessionConfig baseSyntheticConfig(const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  return config;
}

// Config for the deterministic result-timeout path: a small test-only
// resultTimeoutMs (well under the production default) paired with the
// existing --session-result-delay-ms fixture flag (#584) at its maximum
// (1500ms), which deterministically exceeds it. Never changes the production
// default (HelperSessionConfig::resultTimeoutMs stays 2000 everywhere else).
HelperSessionConfig resultTimeoutConfig(const std::string& helperPath) {
  HelperSessionConfig config = baseSyntheticConfig(helperPath);
  config.resultTimeoutMs = 200;
  config.stopTimeoutMs = 2000;
  config.extraArgs = {"--session-result-delay-ms", "1500"};
  return config;
}

// Fresh session/backend construction helper for the self-exec lost-session
// test child (case 2: legitimate no-face).
HelperSessionConfig lostSessionChildConfig(const std::string& selfPath) {
  HelperSessionConfig config;
  config.executablePath = selfPath;
  config.invocationMode = HelperInvocationMode::ExactArguments;
  config.exactArguments = {kLostSessionChildArg};
  return config;
}

// ---------------------------------------------------------------------------
// Self-exec test-child mode (case 2 only): a minimal, synthetic-only session
// responder that always reports a successful (ok == true) "lost" status,
// modeling legitimate no-face tracking. It speaks only the exact subset of
// the existing #533 session protocol needed for a strict parse: one "ready"
// line, one "result" envelope per parent "request" line (echoing requestId /
// frameTimestampMs), and a "stopping"/"stopped" pair on "stop" or stdin EOF.
// It is NOT lvk-synthetic-helper and is never invoked by production code --
// only this smoke's own tests reach it, via HelperInvocationMode::
// ExactArguments. It touches no camera, no file, no model, no network.
// ---------------------------------------------------------------------------

long long extractLongField(
    const std::string& line, const std::string& key, long long fallback) {
  const std::string token = "\"" + key + "\":";
  const std::size_t position = line.find(token);
  if (position == std::string::npos) {
    return fallback;
  }
  return std::strtoll(line.c_str() + position + token.size(), nullptr, 10);
}

int runLostSessionTestChild() {
  std::cout << "{\"type\":\"ready\",\"schemaVersion\":1,\"source\":"
               "\"synthetic-helper\"}\n";
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
    if (line.find("\"type\":\"request\"") != std::string::npos) {
      const long long requestId = extractLongField(line, "requestId", 0);
      const long long frameTimestampMs =
          extractLongField(line, "frameTimestampMs", 0);
      std::cout << "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":"
                 << requestId << ",\"frameTimestampMs\":" << frameTimestampMs
                 << ",\"status\":\"lost\",\"confidence\":0.0,"
                    "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
                    "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
                    "\"mouth\":{\"open\":0.0,\"smile\":0.0},"
                    "\"diag\":{\"inferenceMs\":0.0}}\n";
      std::cout.flush();
      continue;
    }
    // Unrecognized control line: ignore, matching the synthetic helper's own
    // tolerant behavior for unknown lines.
  }
  std::cout << "{\"type\":\"stopped\",\"schemaVersion\":1,\"reason\":"
               "\"session-eof\"}\n";
  std::cout.flush();
  return 0;
}

// ---------------------------------------------------------------------------
// Behavioral test cases (see docs Issue #587 for the authoritative 9-case
// regression plan this file implements 1:1).
// ---------------------------------------------------------------------------

// Case 1: a healthy session emits no terminal-failure diagnostic.
void testCase1HealthySessionNoTerminalDiagnostic(const std::string& helperPath) {
  SyntheticHelperTrackingBackend backend(baseSyntheticConfig(helperPath));
  expect(backend.start(), "case1: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  for (int i = 0; i < 3; ++i) {
    const TrackingSample sample = backend.track(makeFrame(1000 + i));
    expect(
        sample.status == TrackingStatus::Tracking,
        "case1: healthy exchange " + std::to_string(i) +
            " returns Tracking status");
  }
  const std::string stderrOut = stderrCapture.str();
  expect(
      stderrOut.find("[helper-session] session failed") == std::string::npos,
      "case1: no terminal-failure diagnostic on a healthy session");
  expect(
      stdoutCapture.str().empty(),
      "case1 (stream boundary): stdout stays empty during backend operation");

  backend.stop();
}

// Case 2: a legitimate no-face (ok == true, status == lost) result stays a
// normal LOST result, keeps the underlying session non-failed, and emits no
// terminal diagnostic -- proving the trigger is state() == Failed, never
// HelperTrackOutcome::ok == false alone.
void testCase2LegitimateNoFaceNoTerminalDiagnostic(const std::string& selfPath) {
  // Direct session-level check: the exact invariant the reporter depends on
  // (a legitimate no-face round trip never reaches Failed).
  {
    HelperProcessSession session(lostSessionChildConfig(selfPath));
    expect(session.start(), "case2: direct session starts");
    if (session.state() == HelperSessionState::Ready) {
      const HelperTrackOutcome outcome = session.track(2000);
      expect(outcome.ok, "case2: direct session track() succeeds (ok)");
      expect(
          session.state() == HelperSessionState::Running,
          "case2: session stays Running after a legitimate no-face result");
      expect(
          session.lastDiagnostic() == HelperDiagnosticCategory::None,
          "case2: lastDiagnostic stays None after a legitimate no-face result");
    }
    session.stop();
  }

  // Backend-level check: the shared reporter stays silent across repeated
  // legitimate no-face exchanges through the production track() path.
  SyntheticHelperTrackingBackend backend(lostSessionChildConfig(selfPath));
  expect(backend.start(), "case2: backend starts");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  for (int i = 0; i < 3; ++i) {
    const TrackingSample sample = backend.track(makeFrame(2000 + i));
    expect(
        sample.status == TrackingStatus::Lost,
        "case2: legitimate no-face exchange " + std::to_string(i) +
            " returns Lost status");
  }
  const std::string stderrOut = stderrCapture.str();
  expect(
      stderrOut.find("[helper-session] session failed") == std::string::npos,
      "case2: no terminal-failure diagnostic for legitimate no-face results");
  expect(
      stdoutCapture.str().empty(),
      "case2 (stream boundary): stdout stays empty during backend operation");

  backend.stop();
}

// Case 3 + Case 4: a deterministic result timeout transitions the session to
// Failed and emits exactly one "session failed (category=result-timeout)"
// line; repeated track() calls after the latch neither block nor duplicate
// the diagnostic.
void testCase3And4DeterministicResultTimeoutAndPostLatch(
    const std::string& helperPath) {
  SyntheticHelperTrackingBackend backend(resultTimeoutConfig(helperPath));
  expect(backend.start(), "case3: backend starts");

  StreamCapture firstStdoutCapture(std::cout);
  StreamCapture firstStderrCapture(std::cerr);
  const TrackingSample firstSample = backend.track(makeFrame(3000));
  const std::string firstStderr = firstStderrCapture.str();
  const std::string firstStdout = firstStdoutCapture.str();

  expect(
      firstSample.status == TrackingStatus::Lost,
      "case3: a timed-out exchange returns the safe Lost fallback");
  expect(
      firstStderr == kTerminalFailureLine,
      "case3: captured stderr is exactly the one approved "
      "result-timeout line, with no injected/private bytes");
  expect(
      firstStdout.empty(),
      "case3 (stream boundary): stdout stays empty during the failing "
      "track() call");

  // Case 4: further track() calls after the latch must stay immediate
  // (no blocking retry) and must not repeat the diagnostic.
  StreamCapture postLatchStderrCapture(std::cerr);
  for (int i = 0; i < 3; ++i) {
    const TrackingSample sample = backend.track(makeFrame(3100 + i));
    expect(
        sample.status == TrackingStatus::Lost,
        "case4: post-latch call " + std::to_string(i) +
            " keeps returning the safe Lost fallback");
  }
  const std::string postLatchStderr = postLatchStderrCapture.str();
  expect(
      countOccurrences(postLatchStderr, "[helper-session] session failed") ==
          0,
      "case4: no additional terminal-failure diagnostic after the latch");

  backend.stop();
}

// Case 5: start()/ready failures (launch-failure, ready-timeout) are outside
// this contract -- main.cpp already reports a generic startup error -- and
// must never emit the terminal-failure diagnostic, including if track() is
// defensively called afterward.
void testCase5StartAndReadyFailuresExcluded(const std::string& helperPath) {
  {
    HelperSessionConfig config = baseSyntheticConfig(helperPath);
    config.executablePath = helperPath + ".does-not-exist-lvk587";
    SyntheticHelperTrackingBackend backend(config);
    expect(!backend.start(), "case5: launch-failure fails start() closed");

    StreamCapture stderrCapture(std::cerr);
    const TrackingSample sample = backend.track(makeFrame(5000));
    (void)sample;
    expect(
        stderrCapture.str().find("[helper-session] session failed") ==
            std::string::npos,
        "case5: launch-failure never emits the terminal-failure diagnostic, "
        "even if track() is called afterward");
    backend.stop();
  }
  {
    HelperSessionConfig config = baseSyntheticConfig(helperPath);
    config.readyTimeoutMs = 300;
    config.extraArgs = {"--session-skip-ready"};
    SyntheticHelperTrackingBackend backend(config);
    expect(!backend.start(), "case5: ready-timeout fails start() closed");

    StreamCapture stderrCapture(std::cerr);
    const TrackingSample sample = backend.track(makeFrame(5100));
    (void)sample;
    expect(
        stderrCapture.str().find("[helper-session] session failed") ==
            std::string::npos,
        "case5: ready-timeout never emits the terminal-failure diagnostic, "
        "even if track() is called afterward");
    backend.stop();
  }
}

// Case 6: opaque child stderr bytes (#580 BoundedOpaqueDiscard) on the same
// deterministic result-timeout path must never leak into the public
// diagnostic; the captured track() region must be exactly the fixed line.
void testCase6OpaqueChildStderrIsolated(const std::string& helperPath) {
  HelperSessionConfig config = resultTimeoutConfig(helperPath);
  config.stderrPolicy = lvk::tracker::HelperStderrPolicy::BoundedOpaqueDiscard;
  config.extraArgs = {
      "--session-result-delay-ms", "1500", "--session-opaque-stderr-bytes",
      "4096"};
  SyntheticHelperTrackingBackend backend(config);
  expect(backend.start(), "case6: backend starts under BoundedOpaqueDiscard");

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  const TrackingSample sample = backend.track(makeFrame(6000));
  expect(
      sample.status == TrackingStatus::Lost,
      "case6: a timed-out exchange returns the safe Lost fallback");
  expect(
      stderrCapture.str() == kTerminalFailureLine,
      "case6: opaque child stderr bytes never leak into the public "
      "diagnostic -- captured stderr is exactly the one fixed line");
  expect(
      stdoutCapture.str().empty(),
      "case6 (stream boundary): stdout stays empty during the failing "
      "track() call");

  backend.stop();
}

// Case 7: after a failed session, a fresh backend/session starts clean and
// does not inherit or repeat the prior diagnostic.
void testCase7FreshSessionStartsCleanAfterFailure(
    const std::string& helperPath) {
  SyntheticHelperTrackingBackend failedBackend(resultTimeoutConfig(helperPath));
  expect(failedBackend.start(), "case7: first backend starts");
  {
    StreamCapture suppressStdout(std::cout);
    StreamCapture suppressStderr(std::cerr);
    failedBackend.track(makeFrame(7000));
    (void)suppressStdout;
    (void)suppressStderr;
  }
  failedBackend.stop();

  SyntheticHelperTrackingBackend freshBackend(baseSyntheticConfig(helperPath));
  expect(freshBackend.start(), "case7: fresh backend starts");

  StreamCapture stderrCapture(std::cerr);
  const TrackingSample sample = freshBackend.track(makeFrame(7100));
  expect(
      sample.status == TrackingStatus::Tracking,
      "case7: fresh backend/session round-trips normally");
  expect(
      stderrCapture.str().find("[helper-session] session failed") ==
          std::string::npos,
      "case7: a fresh backend/session never inherits or repeats a prior "
      "session's terminal-failure diagnostic");

  freshBackend.stop();
}

// Case 8: a healthy session's shutdown never emits the terminal-failure
// diagnostic (and, being a clean graceful stop, emits no diagnostic at all).
void testCase8HealthyShutdownNoTerminalDiagnostic(
    const std::string& helperPath) {
  SyntheticHelperTrackingBackend backend(baseSyntheticConfig(helperPath));
  expect(backend.start(), "case8: backend starts");
  backend.track(makeFrame(8000));

  StreamCapture stdoutCapture(std::cout);
  StreamCapture stderrCapture(std::cerr);
  backend.stop();
  expect(
      stderrCapture.str().empty(),
      "case8: a healthy graceful shutdown emits no diagnostic at all (in "
      "particular, no terminal-failure line)");
  expect(
      stdoutCapture.str().empty(),
      "case8 (stream boundary): stdout stays empty during shutdown");
}

int runTests(const std::string& helperPath, const std::string& selfPath) {
  testCase1HealthySessionNoTerminalDiagnostic(helperPath);
  testCase2LegitimateNoFaceNoTerminalDiagnostic(selfPath);
  testCase3And4DeterministicResultTimeoutAndPostLatch(helperPath);
  testCase5StartAndReadyFailuresExcluded(helperPath);
  testCase6OpaqueChildStderrIsolated(helperPath);
  testCase7FreshSessionStartsCleanAfterFailure(helperPath);
  testCase8HealthyShutdownNoTerminalDiagnostic(helperPath);

  if (gFailures != 0) {
    std::cerr << "[tracking-backend-terminal-failure-smoke] " << gFailures
              << " assertion(s) failed.\n";
    return 1;
  }
  std::cout << "tracking-backend-terminal-failure smoke OK\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc >= 2 && std::string(argv[1]) == kLostSessionChildArg) {
    return runLostSessionTestChild();
  }

  if (argc < 2) {
    std::cerr << "[tracking-backend-terminal-failure-smoke] usage: "
                 "lvk-tracking-backend-terminal-failure-smoke "
                 "<path-to-lvk-synthetic-helper>\n";
    return 1;
  }

  const std::string selfPath = argv[0];
  const std::string helperPath = argv[1];
  return runTests(helperPath, selfPath);
}
