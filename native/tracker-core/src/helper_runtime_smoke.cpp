#include "helper_runtime_smoke.h"

#include "helper_process_supervisor.h"
#include "helper_tracking_result.h"
#include "motion_frame_writer.h"

#include <cstdlib>
#include <sstream>
#include <string>
#include <vector>

namespace lvk::tracker {
namespace {

constexpr int kHelperRuntimeSmokeTimeoutMs = 5000;
constexpr int kHelperRuntimeSmokeHangTimeoutMs = 200;

bool containsToken(const std::string& line, const std::string& token) {
  return line.find(token) != std::string::npos;
}

bool extractNumberAfter(
    const std::string& line,
    const std::string& key,
    double& value) {
  const std::size_t keyIndex = line.find(key);
  if (keyIndex == std::string::npos) {
    return false;
  }

  const std::size_t valueStart = keyIndex + key.size();
  char* end = nullptr;
  value = std::strtod(line.c_str() + valueStart, &end);
  return end != line.c_str() + valueStart;
}

bool extractLongLongAfter(
    const std::string& line,
    const std::string& key,
    long long& value) {
  const std::size_t keyIndex = line.find(key);
  if (keyIndex == std::string::npos) {
    return false;
  }

  const std::size_t valueStart = keyIndex + key.size();
  char* end = nullptr;
  value = std::strtoll(line.c_str() + valueStart, &end, 10);
  return end != line.c_str() + valueStart;
}

bool parseStatus(const std::string& line, HelperTrackingStatus& status) {
  if (containsToken(line, "\"status\":\"tracking\"")) {
    status = HelperTrackingStatus::Tracking;
    return true;
  }
  if (containsToken(line, "\"status\":\"lost\"")) {
    status = HelperTrackingStatus::Lost;
    return true;
  }
  if (containsToken(line, "\"status\":\"not_started\"")) {
    status = HelperTrackingStatus::NotStarted;
    return true;
  }
  return false;
}

bool parseResultLine(
    const std::string& line,
    HelperTrackingResult& result,
    std::string& reason) {
  if (!containsToken(line, "\"type\":\"result\"") ||
      !containsToken(line, "\"schemaVersion\":1")) {
    reason = "missing result/schema marker";
    return false;
  }

  if (!extractLongLongAfter(line, "\"timestampMs\":", result.timestampMs)) {
    reason = "missing timestampMs";
    return false;
  }
  if (!parseStatus(line, result.status)) {
    reason = "missing status";
    return false;
  }
  if (!extractNumberAfter(line, "\"confidence\":", result.confidence)) {
    reason = "missing confidence";
    return false;
  }
  if (!extractNumberAfter(line, "\"pitch\":", result.faceRotation.pitch) ||
      !extractNumberAfter(line, "\"yaw\":", result.faceRotation.yaw) ||
      !extractNumberAfter(line, "\"roll\":", result.faceRotation.roll)) {
    reason = "missing faceRotation";
    return false;
  }
  if (!extractNumberAfter(line, "\"leftOpen\":", result.eyes.leftOpen) ||
      !extractNumberAfter(line, "\"rightOpen\":", result.eyes.rightOpen)) {
    reason = "missing eyes";
    return false;
  }
  if (!extractNumberAfter(line, "\"open\":", result.mouth.open) ||
      !extractNumberAfter(line, "\"smile\":", result.mouth.smile)) {
    reason = "missing mouth";
    return false;
  }

  double inferenceMs = 0.0;
  if (extractNumberAfter(line, "\"inferenceMs\":", inferenceMs)) {
    result.inferenceMs = inferenceMs;
  }

  return true;
}

void writeDiagnostic(std::ostream& output, const std::string& message) {
  output << "[helper-runtime-smoke] " << message << "\n";
}

void writeFallbackMotionFrame(std::ostream& output) {
  writeMotionFrameJson(
      output,
      TrackingSample{
          0,
          TrackingStatus::Lost,
          0.0,
          Vector3{0.0, 0.0, 0.0},
          EulerRotation{0.0, 0.0, 0.0},
          1.0,
          1.0,
          Vector2{0.0, 0.0},
          0.0,
          0.0,
      });
}

bool handleExpectedFailure(
    const HelperProcessRunResult& helperRun,
    HelperRuntimeSmokeCase smokeCase,
    std::ostream& motionFrameOutput,
    std::ostream& diagnosticsOutput) {
  if (smokeCase == HelperRuntimeSmokeCase::LaunchFailure &&
      (!helperRun.launched ||
       (helperRun.launched && !helperRun.timedOut &&
        helperRun.exitCode == 127))) {
    writeFallbackMotionFrame(motionFrameOutput);
    writeDiagnostic(
        diagnosticsOutput, "helper launch failed; emitted fallback frame");
    return true;
  }
  if (smokeCase == HelperRuntimeSmokeCase::NonzeroExit &&
      helperRun.launched && !helperRun.timedOut && helperRun.exitCode != 0) {
    writeFallbackMotionFrame(motionFrameOutput);
    writeDiagnostic(
        diagnosticsOutput, "helper exited non-zero; emitted fallback frame");
    return true;
  }
  if (smokeCase == HelperRuntimeSmokeCase::Timeout &&
      helperRun.launched && helperRun.timedOut) {
    writeFallbackMotionFrame(motionFrameOutput);
    writeDiagnostic(diagnosticsOutput, "helper timed out; emitted fallback frame");
    return true;
  }
  return false;
}

std::vector<std::string> buildHelperArguments(
    const HelperRuntimeSmokeOptions& options) {
  if (options.smokeCase == HelperRuntimeSmokeCase::NonzeroExit) {
    return {"--frames", std::to_string(options.frameCount), "--fail-after", "1"};
  }
  if (options.smokeCase == HelperRuntimeSmokeCase::Timeout) {
    return {"--frames", "5", "--interval-ms", "1000"};
  }
  if (options.smokeCase == HelperRuntimeSmokeCase::UnsafeDiagnostic) {
    return {
        "--frames",
        std::to_string(options.frameCount),
        "--emit-unsafe-diagnostic"};
  }
  return {"--frames", std::to_string(options.frameCount)};
}

// Smoke-only: every non-empty helper stderr line must use the safe "[helper] "
// diagnostic prefix. The synthetic --emit-unsafe-diagnostic mode intentionally
// emits one line without it, so this returns false when an unsafe diagnostic was
// captured. Kept file-local on purpose to mirror the equivalent local checks in
// the other H2 smokes (no new shared module).
bool helperRuntimeStderrIsSafeForSmoke(const std::string& stderrText) {
  std::istringstream lines(stderrText);
  std::string line;
  while (std::getline(lines, line)) {
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    if (line.empty()) {
      continue;
    }
    if (line.rfind("[helper] ", 0) != 0) {
      return false;
    }
  }
  return true;
}

// Smoke-only fail-closed handler for the UnsafeDiagnostic case. Emits NOTHING to
// public stdout (no MotionFrame, and deliberately no fallback frame), keeps the
// unsafe child stderr private to Native Core (never forwarded or echoed), writes
// only a safe "[helper-runtime-smoke] " diagnostic, and returns non-zero so the
// smoke fails closed. This is smoke-local detection only, NOT a production
// diagnostics-safety policy engine.
int handleUnsafeDiagnostic(
    const HelperProcessRunResult& helperRun,
    std::ostream& diagnosticsOutput) {
  if (!helperRun.launched) {
    writeDiagnostic(diagnosticsOutput, "helper launch failed");
    return 1;
  }
  if (helperRuntimeStderrIsSafeForSmoke(helperRun.stderrText)) {
    writeDiagnostic(
        diagnosticsOutput,
        "expected unsafe helper diagnostic was not captured; failing closed "
        "(no MotionFrame emitted)");
    return 1;
  }
  writeDiagnostic(
      diagnosticsOutput,
      "unsafe helper diagnostic detected; failing closed "
      "(no MotionFrame emitted)");
  return 1;
}

int smokeTimeoutMs(HelperRuntimeSmokeCase smokeCase) {
  return smokeCase == HelperRuntimeSmokeCase::Timeout
             ? kHelperRuntimeSmokeHangTimeoutMs
             : kHelperRuntimeSmokeTimeoutMs;
}

}  // namespace

int runHelperRuntimeSmoke(
    const HelperRuntimeSmokeOptions& options,
    std::ostream& motionFrameOutput,
    std::ostream& diagnosticsOutput) {
  const HelperProcessRunResult helperRun = runHelperProcessForSmoke(
      options.helperPath,
      buildHelperArguments(options),
      smokeTimeoutMs(options.smokeCase));

  if (options.smokeCase == HelperRuntimeSmokeCase::UnsafeDiagnostic) {
    return handleUnsafeDiagnostic(helperRun, diagnosticsOutput);
  }

  if (handleExpectedFailure(
          helperRun, options.smokeCase, motionFrameOutput, diagnosticsOutput)) {
    return 0;
  }

  if (!helperRun.launched) {
    writeDiagnostic(diagnosticsOutput, "helper launch failed");
    return 1;
  }
  if (helperRun.timedOut) {
    writeDiagnostic(diagnosticsOutput, "helper timed out");
    return 1;
  }
  if (helperRun.exitCode != 0) {
    writeDiagnostic(diagnosticsOutput, "helper exited non-zero");
    return 1;
  }

  std::istringstream lines(helperRun.stdoutText);
  std::string line;
  int lineIndex = 0;
  int resultCount = 0;
  bool sawReady = false;
  bool sawStopped = false;

  while (std::getline(lines, line)) {
    ++lineIndex;
    if (line.empty()) {
      continue;
    }

    if (containsToken(line, "\"type\":\"ready\"")) {
      if (!containsToken(line, "\"schemaVersion\":1") ||
          !containsToken(line, "\"source\":\"synthetic-helper\"")) {
        writeDiagnostic(
            diagnosticsOutput,
            "parse error at helper stdout line " + std::to_string(lineIndex) +
                ": invalid ready line");
        return 1;
      }
      sawReady = true;
      continue;
    }

    if (containsToken(line, "\"type\":\"stopped\"")) {
      if (!containsToken(line, "\"schemaVersion\":1")) {
        writeDiagnostic(
            diagnosticsOutput,
            "parse error at helper stdout line " + std::to_string(lineIndex) +
                ": invalid stopped line");
        return 1;
      }
      sawStopped = true;
      continue;
    }

    if (containsToken(line, "\"type\":\"result\"")) {
      HelperTrackingResult helperResult;
      std::string reason;
      if (!parseResultLine(line, helperResult, reason)) {
        writeDiagnostic(
            diagnosticsOutput,
            "parse error at helper stdout line " + std::to_string(lineIndex) +
                ": " + reason);
        return 1;
      }

      writeMotionFrameJson(
          motionFrameOutput,
          createTrackingSampleFromHelperResult(helperResult));
      ++resultCount;
      continue;
    }

    writeDiagnostic(
        diagnosticsOutput,
        "parse error at helper stdout line " + std::to_string(lineIndex) +
            ": unknown line type");
    return 1;
  }

  if (!sawReady) {
    writeDiagnostic(diagnosticsOutput, "helper ready line missing");
    return 1;
  }
  if (!sawStopped) {
    writeDiagnostic(diagnosticsOutput, "helper stopped line missing");
    return 1;
  }
  if (resultCount != options.frameCount) {
    writeDiagnostic(diagnosticsOutput, "helper result count mismatch");
    return 1;
  }

  return 0;
}

}  // namespace lvk::tracker
