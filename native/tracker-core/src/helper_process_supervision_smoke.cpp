// Helper process supervision smoke (H1c).
//
// Launches lvk-synthetic-helper as a child process under bounded supervision
// and validates lifecycle outcomes for three cases: normal completion, helper
// failure, and timeout/termination. Captured child stdout/stderr are private
// child-process data and are NOT forwarded to the parent's stdout. Parent
// diagnostics go to stderr with a safe [supervision-smoke] prefix.
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

}  // namespace

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::cerr << "[supervision-smoke] error: expected path to lvk-synthetic-"
                 "helper as the first argument.\n";
    return 1;
  }

  const std::string helperPath = argv[1];

  if (!runNormalCase(helperPath) || !runFailureCase(helperPath) ||
      !runTimeoutCase(helperPath)) {
    return 1;
  }

  std::cerr << "[supervision-smoke] shutdown: all supervision cases passed.\n";
  return 0;
}
