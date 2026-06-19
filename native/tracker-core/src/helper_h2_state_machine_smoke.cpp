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
// The graceful-shutdown case (shutdown_graceful_exit) reconstructs a `stopping`
// state from a private, test-only synthetic helper marker emitted just before
// the clean stopped line. There is NO parent-to-child control channel in code:
// `stopping` is a reconstructed lifecycle label (like failed/timed_out/fallback),
// not a real parent stop exchange.
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
// Delay-before-ready used by the startup-timeout case. It is well above
// kHangTimeoutMs so the bounded supervisor deterministically terminates the
// helper before it can emit its ready line. The child is killed at the timeout,
// so the case's wall-clock cost stays near kHangTimeoutMs, not this value.
constexpr int kStartupDelayMs = 5000;
// Smoke-local, test-only maximum helper output line length. Every legitimate
// synthetic helper line (ready/result/stopped/unknown/malformed) is far below
// this, so it never false-positives on normal output. This is a smoke-local
// size check ONLY; it is NOT a supervisor or production size/backpressure policy.
constexpr size_t kMaxHelperLineBytesForSmoke = 1024;

// Helper lifecycle states tracked by Native Core, per the H2 handshake / state
// machine design. This is a local, smoke-internal modeling of those states; it
// is not public MotionFrame and is not added to packages/motion-protocol.
enum class HelperState {
  not_started,
  launching,
  waiting_for_ready,
  ready,
  running,
  stopping,
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
    case HelperState::stopping:
      return "stopping";
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

// Result of a single bounded, smoke-local scan over captured PRIVATE helper
// stdout. Lifecycle markers are reconstructed ONLY from lines within the
// smoke-local size limit: any line longer than `maxLineBytes` is rejected before
// its content is scanned, so an oversized line can never contribute a lifecycle
// marker. Only line LENGTHS are measured and only bounded lines are inspected;
// the oversized payload is never fully stored, printed, or forwarded. This is a
// smoke-local, test-only size check; it is NOT a supervisor or production
// size/backpressure/reject policy.
struct SmokeLineScanResult {
  bool foundReady = false;
  bool foundResult = false;
  bool foundStopped = false;
  bool rejectedOversizedLine = false;
};

// Scans `text` line by line with a simple char loop. For each line: if its
// length exceeds `maxLineBytes` it is rejected (rejectedOversizedLine = true) and
// NOT scanned for lifecycle markers; otherwise that bounded line alone is scanned
// for the lifecycle markers. Copying stops as soon as a line exceeds the limit,
// so the oversized payload is never fully buffered, printed, or forwarded.
SmokeLineScanResult scanHelperStdoutWithSmokeLineLimit(const std::string& text,
                                                       size_t maxLineBytes) {
  SmokeLineScanResult result;
  std::string boundedLine;
  size_t lineLength = 0;
  bool lineOversized = false;
  for (size_t index = 0; index <= text.size(); ++index) {
    const bool atEnd = index == text.size();
    const char character = atEnd ? '\n' : text[index];
    if (character == '\n' || character == '\r') {
      if (lineOversized) {
        // Oversized line: rejected before any lifecycle marker scan, so it can
        // never perturb lifecycle reconstruction.
        result.rejectedOversizedLine = true;
      } else if (!boundedLine.empty()) {
        if (contains(boundedLine, "\"type\":\"ready\"")) {
          result.foundReady = true;
        }
        if (contains(boundedLine, "\"type\":\"result\"")) {
          result.foundResult = true;
        }
        if (contains(boundedLine, "\"type\":\"stopped\"")) {
          result.foundStopped = true;
        }
      }
      boundedLine.clear();
      lineLength = 0;
      lineOversized = false;
    } else {
      ++lineLength;
      if (lineLength > maxLineBytes) {
        // Stop copying once the line exceeds the limit: the oversized payload is
        // never fully stored, printed, or forwarded; only its rejection matters.
        lineOversized = true;
        boundedLine.clear();
      } else {
        boundedLine.push_back(character);
      }
    }
  }
  return result;
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

// Helper timeout / silence after running: not_started -> launching ->
// waiting_for_ready -> ready -> running -> timed_out -> fallback. With
// --interval-ms 1000 the synthetic helper emits and flushes its ready line and
// the first result before its first sleep (synthetic_helper_main.cpp:
// writeReadyLine -> writeResultLine -> std::cout.flush() -> sleep), so those
// markers are deterministically captured before the bounded timeout fires. This
// case therefore models a liveness/silence timeout after the helper reached
// running, not a pure startup timeout. ready/running are appended only when
// their markers are present.
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

  if (contains(run.stdoutText, "\"type\":\"ready\"")) {
    path.push_back(HelperState::ready);
  }
  if (contains(run.stdoutText, "\"type\":\"result\"")) {
    path.push_back(HelperState::running);
  }

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
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::timed_out,
      HelperState::fallback};
  if (!checkPath("timeout", path, expected)) {
    return false;
  }

  reportPath("timeout", path);
  return true;
}

// Pure startup timeout: not_started -> launching -> waiting_for_ready ->
// timed_out -> fallback. With --delay-ready-ms kStartupDelayMs the synthetic
// helper sleeps before emitting its ready line, so the bounded supervisor
// terminates the child while still in waiting_for_ready (no ready, no result on
// the helper's stdout). This models a startup timeout where ready never arrives,
// distinct from the liveness/silence-after-running timeout case above. Unlike
// that case, ready/running are never appended; their absence is asserted.
bool runStartupTimeoutCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath,
      {"--frames", "3", "--delay-ready-ms", std::to_string(kStartupDelayMs)},
      kHangTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("startup_timeout", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("startup_timeout",
                  "ready emitted before startup timeout (expected none)");
    return false;
  }

  if (!run.timedOut) {
    reportFailure("startup_timeout", "expected startup timeout to be detected");
    return false;
  }
  path.push_back(HelperState::timed_out);
  path.push_back(HelperState::fallback);

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("startup_timeout", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::timed_out,
      HelperState::fallback};
  if (!checkPath("startup_timeout", path, expected)) {
    return false;
  }

  reportPath("startup_timeout", path);
  return true;
}

// Unknown helper message type is ignored without corrupting the reconstructed
// state path: not_started -> launching -> waiting_for_ready -> ready -> running
// -> exited. With --emit-unknown-type the synthetic helper emits one extra
// helper-style line carrying an unknown "type" after ready, then completes
// normally. That unknown line is captured only in the helper's PRIVATE stdout
// (asserted present there) and is never forwarded to this smoke's stdout, which
// stays empty. No fallback is triggered; the path is identical to the normal
// case.
bool runUnknownMessageTypeCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3", "--emit-unknown-type"}, kNormalTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("unknown_message_type", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (run.timedOut) {
    reportFailure("unknown_message_type", "unexpected timeout");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("unknown_message_type", "missing ready marker");
    return false;
  }
  path.push_back(HelperState::ready);

  if (!contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("unknown_message_type", "missing result marker");
    return false;
  }
  path.push_back(HelperState::running);

  if (run.exitCode != 0) {
    reportFailure("unknown_message_type", "expected exit code 0");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"stopped\"")) {
    reportFailure("unknown_message_type", "missing stopped marker");
    return false;
  }
  path.push_back(HelperState::exited);

  // The unknown-type line must be present in the captured PRIVATE helper stdout,
  // proving it was emitted and captured privately. It is never printed to this
  // smoke's stdout.
  if (!contains(run.stdoutText, "\"type\":\"unknown-synthetic\"")) {
    reportFailure("unknown_message_type",
                  "missing unknown-type marker in private helper stdout");
    return false;
  }

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("unknown_message_type", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::exited};
  if (!checkPath("unknown_message_type", path, expected)) {
    return false;
  }

  reportPath("unknown_message_type", path);
  return true;
}

// Malformed helper output line is ignored by lifecycle reconstruction without
// corrupting the reconstructed state path: not_started -> launching ->
// waiting_for_ready -> ready -> running -> exited. With --emit-malformed-line the
// synthetic helper emits one short, intentionally invalid helper-output line
// after ready, then completes normally. That line is captured only in the
// helper's PRIVATE stdout (asserted present there) and is never forwarded to this
// smoke's stdout, which stays empty. No fallback is triggered.
//
// Honest scope: this smoke uses bounded string checks, not a JSON parser. It
// verifies the malformed line is IGNORED BY LIFECYCLE RECONSTRUCTION and stays
// private; it does NOT demonstrate general parser "safe drop" semantics, which
// remain future production work. This corresponds to the design vector
// malformed_json_line_safe_drop but verifies only that narrower property.
bool runMalformedLineCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3", "--emit-malformed-line"}, kNormalTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("malformed_line", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (run.timedOut) {
    reportFailure("malformed_line", "unexpected timeout");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("malformed_line", "missing ready marker");
    return false;
  }
  path.push_back(HelperState::ready);

  if (!contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("malformed_line", "missing result marker");
    return false;
  }
  path.push_back(HelperState::running);

  if (run.exitCode != 0) {
    reportFailure("malformed_line", "expected exit code 0");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"stopped\"")) {
    reportFailure("malformed_line", "missing stopped marker");
    return false;
  }
  path.push_back(HelperState::exited);

  // The malformed line must be present in the captured PRIVATE helper stdout,
  // proving it was emitted and captured privately. It is never printed to this
  // smoke's stdout.
  if (!contains(run.stdoutText, "malformed-synthetic")) {
    reportFailure("malformed_line",
                  "missing malformed marker in private helper stdout");
    return false;
  }

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("malformed_line", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::exited};
  if (!checkPath("malformed_line", path, expected)) {
    return false;
  }

  reportPath("malformed_line", path);
  return true;
}

// Oversized helper output line is rejected by a smoke-local size check and
// excluded from lifecycle reconstruction, without corrupting the reconstructed
// state path: not_started -> launching -> waiting_for_ready -> ready -> running
// -> exited. With --emit-oversized-line the synthetic helper emits one bounded
// (~2 KB) line after ready, then completes normally. That line is captured only
// in the helper's PRIVATE stdout (its marker is asserted present, by substring
// check) and is never forwarded to this smoke's stdout, which stays empty.
//
// Lifecycle markers (ready/result/stopped) are reconstructed by a smoke-local
// line scan that rejects any line exceeding kMaxHelperLineBytesForSmoke BEFORE
// scanning it for markers, so the oversized line cannot contribute a lifecycle
// marker. The case asserts that a line was rejected (i.e. the oversized line
// exceeded the limit) and that ready/result/stopped were still observed on
// bounded lines.
//
// Honest scope: the size limit and rejection are SMOKE-LOCAL / TEST-ONLY. They
// are not a supervisor or production size / backpressure / reject policy; the
// supervisor is unchanged. No fallback is triggered.
bool runOversizedLineCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3", "--emit-oversized-line"}, kNormalTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("oversized_line_rejected", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (run.timedOut) {
    reportFailure("oversized_line_rejected", "unexpected timeout");
    return false;
  }

  // Smoke-local, test-only line scan: lifecycle markers are reconstructed only
  // from bounded lines. Any line exceeding kMaxHelperLineBytesForSmoke is
  // rejected before its lifecycle markers are scanned, so the oversized line is
  // excluded from lifecycle reconstruction.
  const SmokeLineScanResult scan = scanHelperStdoutWithSmokeLineLimit(
      run.stdoutText, kMaxHelperLineBytesForSmoke);

  if (!scan.foundReady) {
    reportFailure("oversized_line_rejected", "missing ready marker");
    return false;
  }
  path.push_back(HelperState::ready);

  if (!scan.foundResult) {
    reportFailure("oversized_line_rejected", "missing result marker");
    return false;
  }
  path.push_back(HelperState::running);

  if (run.exitCode != 0) {
    reportFailure("oversized_line_rejected", "expected exit code 0");
    return false;
  }
  if (!scan.foundStopped) {
    reportFailure("oversized_line_rejected", "missing stopped marker");
    return false;
  }
  path.push_back(HelperState::exited);

  // The oversized line's marker must be present in the captured PRIVATE helper
  // stdout (substring check; the payload itself is never printed).
  if (!contains(run.stdoutText, "oversized-synthetic")) {
    reportFailure("oversized_line_rejected",
                  "missing oversized marker in private helper stdout");
    return false;
  }

  // Smoke-local, test-only rejection: the scan must have rejected at least one
  // line exceeding kMaxHelperLineBytesForSmoke (only line lengths are measured;
  // no payload is printed or fully stored).
  if (!scan.rejectedOversizedLine) {
    reportFailure("oversized_line_rejected",
                  "no line exceeded the smoke-local size limit");
    return false;
  }

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("oversized_line_rejected", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::exited};
  if (!checkPath("oversized_line_rejected", path, expected)) {
    return false;
  }

  reportPath("oversized_line_rejected", path);
  return true;
}

// Graceful shutdown: not_started -> launching -> waiting_for_ready -> ready ->
// running -> stopping -> exited. With --emit-graceful-shutdown the synthetic
// helper, on its clean completion path, emits one private "stopping" lifecycle
// marker line just before its "stopped" line, then exits 0. This smoke
// reconstructs the `stopping` state from that private marker and `exited` from
// the clean stopped marker plus exit code 0.
//
// Honest scope: there is NO parent-to-child control channel in code, and this
// case does not add one. The `stopping` state is a RECONSTRUCTED lifecycle label
// (like failed/timed_out/fallback in the other cases), derived from a private,
// test-only synthetic helper marker; it is NOT a real parent stop exchange. The
// marker is captured only in the helper's PRIVATE stdout (asserted present there)
// and is never forwarded to this smoke's stdout, which stays empty.
bool runShutdownGracefulExitCase(const std::string& helperPath) {
  const HelperProcessRunResult run = runHelperProcessForSmoke(
      helperPath, {"--frames", "3", "--emit-graceful-shutdown"},
      kNormalTimeoutMs);

  std::vector<HelperState> path = {HelperState::not_started};

  if (!run.launched) {
    reportFailure("shutdown_graceful_exit", "child failed to launch");
    return false;
  }
  path.push_back(HelperState::launching);
  path.push_back(HelperState::waiting_for_ready);

  if (run.timedOut) {
    reportFailure("shutdown_graceful_exit", "unexpected timeout");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"ready\"")) {
    reportFailure("shutdown_graceful_exit", "missing ready marker");
    return false;
  }
  path.push_back(HelperState::ready);

  if (!contains(run.stdoutText, "\"type\":\"result\"")) {
    reportFailure("shutdown_graceful_exit", "missing result marker");
    return false;
  }
  path.push_back(HelperState::running);

  // The private "stopping" marker models the helper-side graceful stop. It must
  // be present in the captured PRIVATE helper stdout before the clean exit. The
  // distinct "stopping" type cannot be confused with the "stopped" marker.
  if (!contains(run.stdoutText, "\"type\":\"stopping\"")) {
    reportFailure("shutdown_graceful_exit",
                  "missing stopping marker in private helper stdout");
    return false;
  }
  path.push_back(HelperState::stopping);

  if (run.exitCode != 0) {
    reportFailure("shutdown_graceful_exit", "expected exit code 0");
    return false;
  }
  if (!contains(run.stdoutText, "\"type\":\"stopped\"")) {
    reportFailure("shutdown_graceful_exit", "missing stopped marker");
    return false;
  }
  path.push_back(HelperState::exited);

  if (!helperStderrIsSafe(run.stderrText)) {
    reportFailure("shutdown_graceful_exit", "unexpected non-helper stderr line");
    return false;
  }

  const std::vector<HelperState> expected = {
      HelperState::not_started, HelperState::launching,
      HelperState::waiting_for_ready, HelperState::ready,
      HelperState::running, HelperState::stopping, HelperState::exited};
  if (!checkPath("shutdown_graceful_exit", path, expected)) {
    return false;
  }

  reportPath("shutdown_graceful_exit", path);
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
      !runTimeoutCase(helperPath) || !runStartupTimeoutCase(helperPath) ||
      !runUnknownMessageTypeCase(helperPath) ||
      !runMalformedLineCase(helperPath) ||
      !runOversizedLineCase(helperPath) ||
      !runShutdownGracefulExitCase(helperPath)) {
    return 1;
  }

  std::cerr << "[h2-state-machine-smoke] shutdown: all H2 synthetic state-"
               "machine cases passed.\n";
  return 0;
}
