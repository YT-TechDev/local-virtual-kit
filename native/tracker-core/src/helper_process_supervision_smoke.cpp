// Helper process supervision smoke (H1c).
//
// Launches lvk-synthetic-helper as a child process under bounded supervision
// and validates lifecycle outcomes for four cases: normal completion, helper
// failure, timeout/termination, and high-volume output (bounded capture).
// Captured child stdout/stderr are private child-process data and are NOT
// forwarded to the parent's stdout. Parent diagnostics go to stderr with a safe
// [supervision-smoke] prefix.
//
// This is synthetic only: no camera, no model, no raw frames, and it is NOT
// wired into the lvk-tracker-core runtime. Only lightweight string checks are
// used against the synthetic helper's known smoke contract; no JSON library and
// no general JSON parsing are introduced. See
// docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.

#include "helper_process_supervisor.h"

#include <iostream>
#include <string>
#include <vector>

namespace {

using lvk::tracker::HelperProcessRunResult;
using lvk::tracker::runHelperProcessForSmoke;

constexpr int kNormalTimeoutMs = 5000;
constexpr int kHangTimeoutMs = 200;
constexpr int kHighVolumeTimeoutMs = 5000;
// Frame count chosen so the helper emits cumulative stdout far above the
// smoke-only capture cap (each synthetic result line is a few hundred bytes),
// deterministically exercising the bounded-capture path. Well within the
// Windows pipe buffer, so the child still completes cleanly on both platforms.
constexpr int kHighVolumeFrameCount = 2000;

bool contains(const std::string& haystack, const std::string& needle) {
  return haystack.find(needle) != std::string::npos;
}

// Every non-empty stderr line emitted by the helper must use the safe
// "[helper] " diagnostic prefix.
bool helperStderrIsSafe(const std::string& stderrText) {
  std::string line;
  for (size_t index = 0; index <= stderrText.size(); ++index) {
    const bool atEnd = index == stderrText.size();
    const char character = atEnd ? '\n' : stderrText[index];
    if (character == '\n' || character == '\r') {
      if (!line.empty()) {
        if (line.rfind("[helper] ", 0) != 0) {
          return false;
        }
        line.clear();
      }
    } else {
      line.push_back(character);
    }
  }
  return true;
}

void reportFailure(const std::string& caseName, const std::string& reason) {
  std::cerr << "[supervision-smoke] error: case=" << caseName
            << ", reason=" << reason << "\n";
}

bool runNormalCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3"}, kNormalTimeoutMs);

  if (!run.launched) {
    reportFailure("normal", "child failed to launch");
    return false;
  }
  if (run.timedOut) {
    reportFailure("normal", "unexpected timeout");
    return false;
  }
  if (run.exitCode != 0) {
    reportFailure("normal", "expected exit code 0");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"") ||
      !contains(run.stdoutText, "\"type\":\"result\"") ||
      !contains(run.stdoutText, "\"type\":\"stopped\"")) {
    reportFailure("normal", "missing ready/result/stopped lifecycle markers");
    return false;
  }
  if (!contains(run.stdoutText, "\"schemaVersion\":1") ||
      !contains(run.stdoutText, "\"source\":\"synthetic-helper\"")) {
    reportFailure("normal", "missing helper contract markers");
    return false;
  }
  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("normal", "unexpected non-helper stderr line");
    return false;
  }

  std::cerr << "[supervision-smoke] normal: launched, exitCode=0, lifecycle "
               "markers present, safe stderr.\n";
  return true;
}

bool runFailureCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3", "--fail-after", "1"}, kNormalTimeoutMs);

  if (!run.launched) {
    reportFailure("failure", "child failed to launch");
    return false;
  }
  if (run.timedOut) {
    reportFailure("failure", "unexpected timeout");
    return false;
  }
  if (run.exitCode == 0) {
    reportFailure("failure", "expected non-zero exit code");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"") ||
      !contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("failure", "missing ready/result before failure");
    return false;
  }
  if (!contains(run.stderrText, "[helper] error:")) {
    reportFailure("failure", "missing safe helper error diagnostic");
    return false;
  }
  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("failure", "unexpected non-helper stderr line");
    return false;
  }

  std::cerr << "[supervision-smoke] failure: handled non-zero exit, helper "
               "error diagnostic present, safe stderr.\n";
  return true;
}

bool runTimeoutCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "5", "--interval-ms", "1000"}, kHangTimeoutMs);

  if (!run.launched) {
    reportFailure("timeout", "child failed to launch");
    return false;
  }
  if (!run.timedOut) {
    reportFailure("timeout", "expected timeout to be detected");
    return false;
  }
  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("timeout", "unexpected non-helper stderr line");
    return false;
  }

  std::cerr << "[supervision-smoke] timeout: detected hang, terminated child, "
               "did not hang.\n";
  return true;
}

// High-volume output: the helper emits far more cumulative stdout than the
// smoke-only capture cap. This proves the supervisor's captured buffer stays
// BOUNDED (does not grow without limit), stays PRIVATE (never forwarded to the
// parent's stdout), and that high-volume output does not corrupt lifecycle
// handling -- the child still exits cleanly. Because capture is clamped to the
// cap, the trailing "stopped" line is intentionally beyond the captured prefix;
// only the early ready/result markers are asserted present. This is a
// smoke-only safety bound, NOT a production supervisor / backpressure policy.
bool runHighVolumeCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", std::to_string(kHighVolumeFrameCount)},
      kHighVolumeTimeoutMs);

  if (!run.launched) {
    reportFailure("high_volume", "child failed to launch");
    return false;
  }
  if (run.timedOut) {
    reportFailure("high_volume", "unexpected timeout");
    return false;
  }
  if (run.exitCode != 0) {
    reportFailure("high_volume", "expected exit code 0");
    return false;
  }

  // Bounded capture: the helper emitted far more than the cap, so captured
  // stdout must be clamped to the cap and flagged truncated.
  if (run.stdoutText.size() > lvk::tracker::kHelperSmokeCapturedStreamByteCap) {
    reportFailure("high_volume",
                  "captured stdout exceeded the smoke-only capture cap");
    return false;
  }
  if (!run.stdoutTruncated) {
    reportFailure("high_volume",
                  "expected high-volume stdout to be truncated at the cap");
    return false;
  }

  // Lifecycle markers from the early bounded prefix remain recoverable: the
  // helper emits ready then results before the truncation point.
  if (!contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("high_volume", "missing ready marker in bounded capture");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("high_volume", "missing result marker in bounded capture");
    return false;
  }

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("high_volume", "unexpected non-helper stderr line");
    return false;
  }

  std::cerr << "[supervision-smoke] high-volume: launched, exitCode=0, capture "
               "bounded at cap, truncated flag set, safe stderr.\n";
  return true;
}

}  // namespace

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::cerr << "[supervision-smoke] error: expected path to lvk-synthetic-"
                 "helper as the first argument.\n";
    return 1;
  }

  const std::string helperPath = argv[1];

  if (!runNormalCase(helperPath) || !runFailureCase(helperPath) ||
      !runTimeoutCase(helperPath) || !runHighVolumeCase(helperPath)) {
    return 1;
  }

  std::cerr << "[supervision-smoke] shutdown: all supervision cases passed.\n";
  return 0;
}
