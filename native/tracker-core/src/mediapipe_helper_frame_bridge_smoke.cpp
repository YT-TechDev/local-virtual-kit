// Native Core-to-Python MediaPipe helper frame bridge smoke (#571).
//
// Deterministic cross-runtime evidence that the real HelperProcessSession can
// launch a test-only Python child (native/tracker-core/tests/fixtures/
// mediapipe_helper_frame_bridge_fixture.py) through the merged #568/#570
// exact-invocation route, send one bounded BGR24 frame through the actual
// private frame endpoint, receive one correlated canonical LOST result
// through the actual helper protocol, and complete graceful shutdown.
//
// Uses createMediaPipeHelperRouteConfig() for every session configuration --
// never hand-builds or duplicates the exact argv contract -- and the real
// HelperProcessSession public API only. Single-threaded, sequential; creates
// no second process, pipe, protocol parser, or transport of its own.
//
// Never prints any argument, path, argv, protocol line, frame byte,
// checksum, fd/HANDLE, or diagnostic label. On success, stdout is exactly
// "mediapipe-helper-frame-bridge smoke OK\n" with empty stderr; on any
// failure, stderr is exactly "mediapipe-helper-frame-bridge smoke failed.\n"
// with empty stdout.

#include "helper_frame_packet.h"
#include "helper_message.h"
#include "helper_process_session.h"
#include "mediapipe_helper_route_config.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

using lvk::tracker::createMediaPipeHelperRouteConfig;
using lvk::tracker::FramePixelView;
using lvk::tracker::fnv1a32;
using lvk::tracker::HelperDiagnosticCategory;
using lvk::tracker::HelperInvocationMode;
using lvk::tracker::HelperProcessSession;
using lvk::tracker::HelperSessionConfig;
using lvk::tracker::HelperSessionState;
using lvk::tracker::HelperTrackingStatus;
using lvk::tracker::HelperTrackOutcome;
using lvk::tracker::kMediaPipeFaceLandmarkerReadySource;
using lvk::tracker::kSyntheticHelperReadySource;
using lvk::tracker::MediaPipeHelperRouteConfigInput;

// Aggregate-only assertion mechanism: no per-case text or private value is
// ever emitted, only this single failure counter.
int gFailures = 0;

void expect(bool condition) {
  if (!condition) {
    ++gFailures;
  }
}

// One tightly packed deterministic 2x2 BGR24 frame: bytes 0 through 11, in
// order. Its known FNV-1a32 checksum (asserted below before any bridge case
// runs) is the fixed constant 1246796121.
std::vector<std::uint8_t> makeFixedFrame() {
  std::vector<std::uint8_t> frame(12);
  for (std::size_t index = 0; index < frame.size(); ++index) {
    frame[index] = static_cast<std::uint8_t>(index);
  }
  return frame;
}

constexpr std::uint32_t kFixedFrameChecksum = 1246796121;

void expectCanonicalLostResult(const HelperTrackOutcome& outcome,
                                long long expectedTimestampMs) {
  expect(outcome.result.timestampMs == expectedTimestampMs);
  expect(outcome.result.status == HelperTrackingStatus::Lost);
  expect(outcome.result.confidence == 0.0);
  expect(outcome.result.faceRotation.pitch == 0.0);
  expect(outcome.result.faceRotation.yaw == 0.0);
  expect(outcome.result.faceRotation.roll == 0.0);
  expect(outcome.result.eyes.leftOpen == 1.0);
  expect(outcome.result.eyes.rightOpen == 1.0);
  expect(outcome.result.mouth.open == 0.0);
  expect(outcome.result.mouth.smile == 0.0);
  expect(std::isfinite(outcome.result.inferenceMs));
  expect(outcome.result.inferenceMs >= 0.0);
}

// Case 1: normal cross-runtime success -- start, one frame exchange, and a
// clean graceful stop.
void caseNormalSuccess(const MediaPipeHelperRouteConfigInput& baseInput) {
  const std::optional<HelperSessionConfig> configOpt =
      createMediaPipeHelperRouteConfig(baseInput);
  expect(configOpt.has_value());
  if (!configOpt.has_value()) {
    return;
  }
  const HelperSessionConfig& config = *configOpt;

  expect(config.invocationMode == HelperInvocationMode::ExactArguments);
  expect(config.exactArguments.size() == 4);
  if (config.exactArguments.size() == 4) {
    expect(config.exactArguments[0] == "-B");
    expect(config.exactArguments[1] == baseInput.helperScriptPath);
    expect(config.exactArguments[2] == "--model-asset-path");
    expect(config.exactArguments[3] == baseInput.modelAssetPath);
  }
  expect(config.extraArgs.empty());
  expect(config.expectedReadySource == kMediaPipeFaceLandmarkerReadySource);
  expect(config.enableFrameTransport == true);
  for (const std::string& argument : config.exactArguments) {
    expect(argument != "--session");
    expect(argument != "--session-frame-mode");
  }

  HelperProcessSession session(config);
  const bool started = session.start();
  expect(started);
  if (!started) {
    session.stop();
    return;
  }
  expect(session.state() == HelperSessionState::Ready);

  const std::vector<std::uint8_t> frame = makeFixedFrame();
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(571001, view);
  expect(outcome.ok);
  if (outcome.ok) {
    expect(session.state() == HelperSessionState::Running);
    expectCanonicalLostResult(outcome, 571001);
  }

  session.stop();
  expect(session.state() == HelperSessionState::Stopped);
  expect(session.shutdownDiagnostic() == HelperDiagnosticCategory::None);
}

// Case 2: child launch failure against a deliberately missing executable.
void caseLaunchFailure(const MediaPipeHelperRouteConfigInput& baseInput,
                        const std::string& missingExecutablePath) {
  MediaPipeHelperRouteConfigInput input = baseInput;
  input.pythonInterpreterPath = missingExecutablePath;

  const std::optional<HelperSessionConfig> configOpt =
      createMediaPipeHelperRouteConfig(input);
  expect(configOpt.has_value());
  if (!configOpt.has_value()) {
    return;
  }

  HelperProcessSession session(*configOpt);
  expect(!session.start());
  expect(session.state() == HelperSessionState::Failed);
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::LaunchFailure);
  session.stop();
}

// Case 3: ready-source mismatch. The real fixture still emits the real
// MediaPipe ready source; only the parent's expectation is changed.
void caseReadySourceMismatch(const MediaPipeHelperRouteConfigInput& baseInput) {
  const std::optional<HelperSessionConfig> configOpt =
      createMediaPipeHelperRouteConfig(baseInput);
  expect(configOpt.has_value());
  if (!configOpt.has_value()) {
    return;
  }
  HelperSessionConfig config = *configOpt;
  config.expectedReadySource = kSyntheticHelperReadySource;
  // Kept small so this bounded failure case stays fast.
  config.stopTimeoutMs = 200;

  HelperProcessSession session(config);
  expect(!session.start());
  expect(session.state() == HelperSessionState::Failed);
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage);
  session.stop();
}

// Case 4: result request-correlation mismatch (fixed timestamp 571002).
void caseRequestCorrelationMismatch(
    const MediaPipeHelperRouteConfigInput& baseInput) {
  const std::optional<HelperSessionConfig> configOpt =
      createMediaPipeHelperRouteConfig(baseInput);
  expect(configOpt.has_value());
  if (!configOpt.has_value()) {
    return;
  }

  HelperProcessSession session(*configOpt);
  const bool started = session.start();
  expect(started);
  if (!started || session.state() != HelperSessionState::Ready) {
    session.stop();
    return;
  }

  const std::vector<std::uint8_t> frame = makeFixedFrame();
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(571002, view);
  expect(!outcome.ok);
  expect(session.state() == HelperSessionState::Failed);
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage);
  session.stop();
}

// Case 5: frameAck checksum mismatch (fixed timestamp 571003).
void caseFrameAckMismatch(const MediaPipeHelperRouteConfigInput& baseInput) {
  const std::optional<HelperSessionConfig> configOpt =
      createMediaPipeHelperRouteConfig(baseInput);
  expect(configOpt.has_value());
  if (!configOpt.has_value()) {
    return;
  }

  HelperProcessSession session(*configOpt);
  const bool started = session.start();
  expect(started);
  if (!started || session.state() != HelperSessionState::Ready) {
    session.stop();
    return;
  }

  const std::vector<std::uint8_t> frame = makeFixedFrame();
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(571003, view);
  expect(!outcome.ok);
  expect(session.state() == HelperSessionState::Failed);
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::FrameAckMismatch);
  session.stop();
}

// Case 6: fixture exits immediately after a fully valid result, before the
// parent's later stop() request is ever processed.
void caseEarlyExitBeforeStop(const MediaPipeHelperRouteConfigInput& baseInput) {
  const std::optional<HelperSessionConfig> configOpt =
      createMediaPipeHelperRouteConfig(baseInput);
  expect(configOpt.has_value());
  if (!configOpt.has_value()) {
    return;
  }

  HelperProcessSession session(*configOpt);
  const bool started = session.start();
  expect(started);
  if (!started || session.state() != HelperSessionState::Ready) {
    session.stop();
    return;
  }

  const std::vector<std::uint8_t> frame = makeFixedFrame();
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(571004, view);
  expect(outcome.ok);
  if (outcome.ok) {
    expectCanonicalLostResult(outcome, 571004);
  }

  session.stop();
  expect(session.state() == HelperSessionState::Stopped);
  expect(session.shutdownDiagnostic() == HelperDiagnosticCategory::ChildExit);
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif

  if (argc != 5) {
    std::fputs("mediapipe-helper-frame-bridge smoke failed.\n", stderr);
    return 1;
  }

  const std::string pythonInterpreterPath = argv[1];
  const std::string fixtureScriptPath = argv[2];
  const std::string modelMarkerPath = argv[3];
  const std::string missingExecutablePath = argv[4];

  const std::vector<std::uint8_t> checksumFixture = makeFixedFrame();
  expect(fnv1a32(checksumFixture.data(), checksumFixture.size()) ==
         kFixedFrameChecksum);

  MediaPipeHelperRouteConfigInput baseInput;
  baseInput.pythonInterpreterPath = pythonInterpreterPath;
  baseInput.helperScriptPath = fixtureScriptPath;
  baseInput.modelAssetPath = modelMarkerPath;

  if (gFailures == 0) {
    caseNormalSuccess(baseInput);
    caseLaunchFailure(baseInput, missingExecutablePath);
    caseReadySourceMismatch(baseInput);
    caseRequestCorrelationMismatch(baseInput);
    caseFrameAckMismatch(baseInput);
    caseEarlyExitBeforeStop(baseInput);
  }

  if (gFailures != 0) {
    std::fputs("mediapipe-helper-frame-bridge smoke failed.\n", stderr);
    return 1;
  }

  std::fputs("mediapipe-helper-frame-bridge smoke OK\n", stdout);
  return 0;
}
