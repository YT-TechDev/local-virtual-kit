#pragma once

#include <iosfwd>
#include <string>

namespace lvk::tracker {

enum class HelperRuntimeSmokeCase {
  Normal,
  LaunchFailure,
  NonzeroExit,
  Timeout,
  // Smoke-only: the synthetic helper emits one unsafe stderr diagnostic (lacking
  // the safe "[helper] " prefix) and otherwise completes cleanly. The runtime
  // smoke must FAIL CLOSED -- detect the unsafe child stderr, emit NOTHING to
  // public stdout (no MotionFrame, and deliberately no fallback frame), keep the
  // unsafe child stderr private, and return non-zero. This is smoke-local
  // detection only, NOT a production diagnostics-safety policy engine.
  UnsafeDiagnostic,
  // Smoke-only: observe the synthetic helper lifecycle/ready boundary. The parent
  // launches the synthetic helper through the existing bounded supervisor and
  // confirms, from the PRIVATELY captured helper stdout only, that the helper
  // announced its "ready" lifecycle boundary and reached its clean "stopped"
  // boundary before exiting 0. It emits NOTHING to public stdout (no MotionFrame,
  // and deliberately no fallback frame), keeps helper stdout/stderr private to
  // Native Core, and returns 0 on a clean handshake (non-zero otherwise). This is
  // smoke-local lifecycle observation only, NOT a production handshake, control
  // channel, or supervisor.
  HelperLifecycleHandshake,
  // Smoke-only failure guards for the lifecycle-handshake observation. Each reuses
  // an existing synthetic helper failure mode so the SAME handleLifecycleHandshake
  // observation fails closed before a clean handshake: it emits NOTHING to public
  // stdout (no MotionFrame, and deliberately no fallback frame), keeps helper
  // stdout/stderr private to Native Core, writes only a safe "[helper-runtime-smoke] "
  // parent diagnostic, and returns non-zero. NonzeroExit runs the helper with
  // --fail-after so it exits non-zero before "stopped"; Timeout paces the helper so
  // the bounded smoke timeout fires before "stopped". (The launch-failure vector
  // needs no new case: it reuses HelperLifecycleHandshake with a non-existent helper
  // path.) These are smoke-local observations only, NOT production handshake,
  // control channel, supervisor, or fallback behavior.
  HelperLifecycleHandshakeNonzeroExit,
  HelperLifecycleHandshakeTimeout,
  // Smoke-only failure guard for the lifecycle-handshake observation:
  // missing-ready. The synthetic helper completes cleanly (exits 0, no timeout)
  // but never emits the "ready" lifecycle boundary. The parent observation must
  // FAIL CLOSED -- detect the missing ready, emit NOTHING to public stdout (no
  // MotionFrame, and deliberately no fallback frame), keep helper stdout/stderr
  // private to Native Core, write only a safe "[helper-runtime-smoke] " parent
  // diagnostic, and return non-zero. This is a smoke-local observation only, NOT
  // a production handshake, control channel, supervisor, or fallback behavior.
  HelperLifecycleHandshakeMissingReady,
  // Smoke-only failure guard for the lifecycle-handshake observation:
  // missing-stopped. The synthetic helper emits the "ready" lifecycle boundary
  // and otherwise completes cleanly (exits 0, no timeout), but never emits the
  // "stopped" lifecycle boundary. The parent observation must FAIL CLOSED --
  // detect the missing stopped, emit NOTHING to public stdout (no MotionFrame,
  // and deliberately no fallback frame), keep helper stdout/stderr private to
  // Native Core, write only a safe "[helper-runtime-smoke] " parent diagnostic,
  // and return non-zero. This is a smoke-local observation only, NOT a
  // production handshake, control channel, supervisor, or fallback behavior.
  HelperLifecycleHandshakeMissingStopped,
};

struct HelperRuntimeSmokeOptions {
  std::string helperPath;
  int frameCount = 3;
  HelperRuntimeSmokeCase smokeCase = HelperRuntimeSmokeCase::Normal;
};

// Smoke-only runtime integration path for H1d/H1e. Launches the synthetic helper
// through the existing bounded supervisor, parses only its known compact stdout
// contract in the normal case, maps helper results through the Native
// Core-internal mapper, and writes existing MotionFrame JSON to
// motionFrameOutput. Expected failure smoke cases return 0 after emitting one
// safe fallback MotionFrame; unexpected normal-mode failures remain non-zero.
int runHelperRuntimeSmoke(
    const HelperRuntimeSmokeOptions& options,
    std::ostream& motionFrameOutput,
    std::ostream& diagnosticsOutput);

}  // namespace lvk::tracker
