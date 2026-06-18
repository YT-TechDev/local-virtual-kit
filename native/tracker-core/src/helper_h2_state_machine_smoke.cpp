// H2 synthetic state-machine smoke (first scoped H2 prototype slice).
//
// Standalone, synthetic-only executable that exercises the already-designed H2
// helper lifecycle state machine
// (docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md) using the
// existing lvk-synthetic-helper and the existing bounded helper process
// supervisor (runHelperProcessForSmoke). For each synthetic case it reconstructs
// the lifecycle state path from the supervised run result plus the helper's
// known stdout lifecycle markers and asserts it matches the documented vector
// (docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md).
//
// Boundaries (synthetic-only; bounded by the H2 implementation gate and owner
// decision):
//   - no camera, no OpenCV, no real frames, no pixels, no tensors, no models
//   - no sockets, no temporary files, no telemetry/analytics/cloud/network
//   - no new dependency and no JSON library; only lightweight bounded string
//     checks against the synthetic helper's known smoke contract
//   - captured helper stdout/stderr are PRIVATE child-process data: they are
//     never forwarded to this process's stdout. This smoke keeps its own stdout
//     empty and writes only safe [h2-state-machine-smoke] diagnostics to stderr.
//   - this target is NOT wired into the lvk-tracker-core runtime.
// See docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md and
// docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md.

#include "helper_process_supervisor.h"

#include <iostream>
#include <string>
#include <vector>

namespace {

using lvk::tracker::HelperProcessRunResult;
using lvk::tracker::runHelperProcessForSmoke;

constexpr int kNormalTimeoutMs = 5000;
constexpr int kHangTimeoutMs = 200;

// Helper lifecycle states tracked by Native Core, per the H2 handshake / state
// machine design. This is a local, smoke-internal modeling of those states; it
// is not public MotionFrame and is not added to packages/motion-protocol.
enum class HelperState {
  not_started,
  launching,
  waiting_for_ready,
  ready,
  running,
  exited,
  failed,
  timed_out,
  fallback,
};

const char* stateName(HelperState state) {
  switch (state) {
    case HelperState::not_started:
      return "not_started";
    case HelperState::launching:
      return "launching";
    case HelperState::waiting_for_ready:
      return "waiting_for_ready";
    case HelperState::ready:
      return "ready";
    case HelperState::running:
      return "running";
    case HelperState::exited:
      return "exited";
    case HelperState::failed:
      return "failed";
    case HelperState::timed_out:
      return "timed_out";
    case HelperState::fallback:
      return "fallback";
  }
  return "unknown";
}

std::string pathToString(const std::vector<HelperState>& path) {
  std::string text;
  for (size_t index = 0; index < path.size(); ++index) {
    if (index > 0) {
      text += " -> ";
    }
    text += stateName(path[index]);
  }
  return text;
}

bool contains(const std::string& haystack, const std::string& needle) {
  return haystack.find(needle) != std::string::npos;
}

// Every non-empty stderr line emitted by the helper must use the safe
// "[helper] " diagnostic prefix (matches the synthetic helper contract).
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
  std::cerr << "[h2-state-machine-smoke] error: case=" << caseName
            << ", reason=" << reason << "\n";
}

// Emits a safe diagnostic describing the reconstructed lifecycle path. Only
// state names are printed; no helper stdout/stderr payload is ever forwarded.
void reportPath(const std::string& caseName,
                const std::vector<HelperState>& path) {
  std::cerr << "[h2-state-machine-smoke] " << caseName
            << ": states=" << pathToString(path) << "\n";
}

bool checkPath(const std::string& caseName,
               const std::vector<HelperState>& actual,
               const std::vector<HelperState>& expected) {
  if (actual != expected) {
    reportFailure(caseName, "state path mismatch (expected " +
                                pathToString(expected) + ", got " +
                                pathToString(actual) + ")");
    return false;
  }
  return true;
}

// Normal run: not_started -> launching -> waiting_for_ready -> ready -> running
// -> exited.
bool runNormalCase(const std::string& helperPath) {
  const HelperProcessRunResult run =
      runHelperProcessForSmoke(helperPath, {"--frames", "3"}, kNormalTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("normal", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (run.timedOut) {
    reportFailure("normal", "unexpected timeout");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("normal", "missing ready marker");
    return false;
  }
  path.push_back(HelperState::ready);

  if (!contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("normal", "missing result marker");
    return false;
  }
  path.push_back(HelperState::running);

  if (run.exitCode != 0) {
    reportFailure("normal", "expected exit code 0");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"stopped\"")) {
    reportFailure("normal", "missing stopped marker");
    return false;
  }
  if (!contains(run.stdoutText, "\"schemaVersion\":1") ||
      !contains(run.stdoutText, "\"source\":\"synthetic-helper\"")) {
    reportFailure("normal", "missing helper contract markers");
    return false;
  }
  path.push_back(HelperState::exited);

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("normal", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::exited};
  if (!checkPath("normal", path, expected)) {
    return false;
  }

  reportPath("normal", path);
  return true;
}

// Helper non-zero exit: not_started -> launching -> waiting_for_ready -> ready
// -> running -> failed -> fallback.
bool runFailureCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3", "--fail-after", "1"}, kNormalTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("failure", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (run.timedOut) {
    reportFailure("failure", "unexpected timeout");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("failure", "missing ready marker before failure");
    return false;
  }
  path.push_back(HelperState::ready);

  if (!contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("failure", "missing result marker before failure");
    return false;
  }
  path.push_back(HelperState::running);

  if (run.exitCode == 0) {
    reportFailure("failure", "expected non-zero exit code");
    return false;
  }
  if (!contains(run.stderrText, "[helper] error:")) {
    reportFailure("failure", "missing safe helper error diagnostic");
    return false;
  }
  path.push_back(HelperState::failed);
  path.push_back(HelperState::fallback);

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("failure", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::failed, HelperState::fallback};
  if (!checkPath("failure", path, expected)) {
    return false;
  }

  reportPath("failure", path);
  return true;
}

// Helper timeout / silence: not_started -> launching -> waiting_for_ready ->
// timed_out -> fallback. Captured stdout before forced termination is not
// deterministic, so this case asserts only launch + timeout evidence (matching
// the existing supervision smoke), not intermediate stdout markers.
bool runTimeoutCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "5", "--interval-ms", "1000"}, kHangTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("timeout", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (!run.timedOut) {
    reportFailure("timeout", "expected timeout to be detected");
    return false;
  }
  path.push_back(HelperState::timed_out);
  path.push_back(HelperState::fallback);

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("timeout", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::timed_out,
      HelperState::fallback};
  if (!checkPath("timeout", path, expected)) {
    return false;
  }

  reportPath("timeout", path);
  return true;
}

}  // namespace

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::cerr << "[h2-state-machine-smoke] error: expected path to lvk-"
                 "synthetic-helper as the first argument.\n";
    return 1;
  }

  const std::string helperPath = argv[1];

  if (!runNormalCase(helperPath) || !runFailureCase(helperPath) ||
      !runTimeoutCase(helperPath)) {
    return 1;
  }

  std::cerr << "[h2-state-machine-smoke] shutdown: all H2 synthetic state-"
               "machine cases passed.\n";
  return 0;
}
