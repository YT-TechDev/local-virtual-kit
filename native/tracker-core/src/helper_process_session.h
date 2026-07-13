#pragma once

#include "helper_message.h"
#include "helper_tracking_result.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace lvk::tracker {

// v0.13.0 reusable, opt-in, Native Core-owned helper session (#533).
//
// Owns a single synthetic helper child process and a bounded private control
// channel (parent->child stdin, child->parent stdout, child->parent stderr).
// It drives the existing lvk-synthetic-helper in its interactive "--session"
// mode: one bounded request/result exchange per track() call, mapped to a
// TrackingSample by the caller through the existing
// createTrackingSampleFromHelperResult boundary.
//
// It sends NO camera frame pixels to the helper (that is #534). All helper
// stdout/stderr stay private to Native Core; only generic parent diagnostic
// categories are ever exposed. The session state is Native Core-internal and is
// never added to MotionFrame. This layer adds no JSON, socket, shared-memory,
// temp-file, or network behavior.

// Native Core-internal session lifecycle. Never serialized into MotionFrame.
enum class HelperSessionState {
  NotStarted,
  Starting,
  Ready,
  Running,
  Stopping,
  Stopped,
  Failed,
};

// Generic, safe parent diagnostic categories. The raw child stdout/stderr are
// never surfaced; only these categories may be reported by the parent.
enum class HelperDiagnosticCategory {
  None,
  LaunchFailure,
  ReadyTimeout,
  MalformedMessage,
  ResultTimeout,
  ChildExit,
  ShutdownTimeout,
};

const char* helperDiagnosticCategoryLabel(HelperDiagnosticCategory category);

// Opaque per-platform process/pipe handles, defined in helper_process_session.cpp.
struct HelperSessionHandles;

struct HelperSessionConfig {
  std::string executablePath;
  // Extra helper arguments appended after "--session". Empty in normal use; a
  // development-only pass-through used to exercise the synthetic helper's
  // deterministic session fault modes in automated tests. No camera frame data
  // is ever passed here.
  std::vector<std::string> extraArgs;
  // Bounded waits. Kept small so failures surface quickly and deterministically
  // without ever blocking Native Core's frame loop indefinitely.
  int readyTimeoutMs = 2000;
  int resultTimeoutMs = 2000;
  int stopTimeoutMs = 1000;
};

struct HelperTrackOutcome {
  bool ok = false;                // false -> caller must emit safe lost tracking
  HelperTrackingResult result;    // valid only when ok == true
};

class HelperProcessSession {
 public:
  explicit HelperProcessSession(HelperSessionConfig config);
  ~HelperProcessSession();

  HelperProcessSession(const HelperProcessSession&) = delete;
  HelperProcessSession& operator=(const HelperProcessSession&) = delete;

  // Launches the child and performs the bounded ready handshake. Returns true
  // only on a clean ready boundary; on any launch/ready failure it transitions
  // to Failed, records a diagnostic category, and returns false (the caller
  // should fail before opening the camera). Safe to call once.
  bool start();

  // Runs one bounded request/result exchange. If the session is already Failed
  // or Stopped it returns a not-ok outcome immediately without waiting. On any
  // write/timeout/exit/malformed/stale-correlation failure it transitions to
  // Failed and returns a not-ok outcome (caller emits safe lost tracking).
  HelperTrackOutcome track(long long frameTimestampMs);

  // Requests a graceful stop, waits a bounded time, then force-terminates if the
  // child has not exited. Idempotent and safe to call in any state.
  void stop();

  HelperSessionState state() const { return state_; }
  HelperDiagnosticCategory lastDiagnostic() const { return lastDiagnostic_; }

  // Set by stop() when a session that reached Ready/Running did not shut down
  // cleanly (no strictly-valid stopped line and/or the child did not exit within
  // the bounded wait). None means either a clean graceful stop or a session that
  // never became healthy. Only a generic category is exposed.
  HelperDiagnosticCategory shutdownDiagnostic() const {
    return shutdownDiagnostic_;
  }

 private:
  // Structured outcome of the bounded graceful-stop drain.
  enum class ShutdownOutcome {
    StoppedCleanly,  // a strictly valid "stopped" line was observed
    Malformed,       // malformed/oversized lifecycle line or unsafe stderr
    ChildExit,       // stdout EOF before any valid "stopped" line
    Timeout,         // bounded drain elapsed without a valid "stopped" line
  };

  bool nextStdoutLine(
      std::string& lineOut,
      int timeoutMs,
      HelperDiagnosticCategory timeoutCategory);
  bool drainStderr();
  ShutdownOutcome drainUntilStopped(int timeoutMs);
  bool writeControlLine(const std::string& line);

  HelperSessionConfig config_;
  std::unique_ptr<HelperSessionHandles> handles_;
  HelperSessionState state_ = HelperSessionState::NotStarted;
  HelperDiagnosticCategory lastDiagnostic_ = HelperDiagnosticCategory::None;
  HelperDiagnosticCategory shutdownDiagnostic_ = HelperDiagnosticCategory::None;
  std::string stdoutBuffer_;
  std::string stderrBuffer_;
  bool stdoutEof_ = false;
  bool stderrEof_ = false;
  bool cleaned_ = false;
  std::uint64_t nextRequestId_ = 0;
  unsigned long long stderrDiagnosticCount_ = 0;  // count only; no raw history
};

}  // namespace lvk::tracker
