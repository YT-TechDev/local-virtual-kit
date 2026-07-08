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
  // Smoke-only failure guard for the lifecycle-handshake observation:
  // malformed-ready. The synthetic helper emits a "ready" line with an invalid
  // schema version (schemaVersion:10 instead of 1) and otherwise completes
  // cleanly (exits 0, no timeout, emits the "stopped" boundary). The value 10
  // is chosen to directly exercise exact-boundary matching: a bare
  // "schemaVersion":1 substring would incorrectly match "schemaVersion":10.
  // The parent observation must FAIL CLOSED -- detect the malformed ready line,
  // emit
  // NOTHING to public stdout (no MotionFrame, and deliberately no fallback
  // frame), keep helper stdout/stderr private to Native Core, write only a safe
  // "[helper-runtime-smoke] " parent diagnostic, and return non-zero. This is a
  // smoke-local observation only, NOT a production handshake, control channel,
  // supervisor, or fallback behavior.
  HelperLifecycleHandshakeMalformedReady,
  // Smoke-only failure guard for the lifecycle-handshake observation:
  // ready-timeout. The synthetic helper is launched with --delay-ready-ms set
  // well above the bounded lifecycle-handshake smoke timeout, so it never emits
  // the "ready" lifecycle boundary before the supervisor terminates it. This is
  // a genuine startup/ready timeout at the H2 supervisor boundary -- distinct
  // from HelperLifecycleHandshakeTimeout, whose paced helper already emits
  // "ready" (and a result) before its bounded timeout fires, modeling
  // post-ready silence rather than a missing ready boundary. The parent
  // observation must FAIL CLOSED -- detect the supervisor timeout, emit
  // NOTHING to public stdout (no MotionFrame, and deliberately no fallback
  // frame), keep helper stdout/stderr private to Native Core, write only a
  // safe "[helper-runtime-smoke] " parent diagnostic, and return non-zero.
  // This is a smoke-local observation only, NOT a production handshake,
  // control channel, supervisor, or fallback behavior.
  HelperLifecycleHandshakeReadyTimeout,
  // Smoke-only failure guard for the NORMAL helper-runtime smoke parse path:
  // malformed-result-schema. The synthetic helper emits one "result" line with an
  // invalid schema version (schemaVersion:10 instead of 1) before its normal
  // result frames and otherwise completes cleanly (emits ready, valid result
  // frames, the "stopped" line, and exits 0). The value 10 is chosen to directly
  // exercise exact-boundary matching: a bare "schemaVersion":1 substring would
  // incorrectly match "schemaVersion":10, so before the exact-boundary fix the
  // parser would wrongly accept the malformed result line and map it to a
  // MotionFrame. The normal parse path must FAIL CLOSED -- reject the malformed
  // result line, emit NOTHING to public stdout (no MotionFrame, and deliberately
  // no fallback frame), keep helper stdout/stderr private to Native Core, write
  // only a safe "[helper-runtime-smoke] " parent diagnostic, and return non-zero.
  // This is smoke-local parse hardening only, NOT a production parser, backend, or
  // runtime.
  MalformedResultSchema,
  // Smoke-only failure guard for the NORMAL helper-runtime smoke parse path:
  // malformed-stopped-schema. The synthetic helper emits its "stopped" lifecycle
  // boundary line with an invalid schema version (schemaVersion:10 instead of 1)
  // in place of the normal stopped line, and otherwise completes cleanly (emits
  // ready, then -- with --frames 0 -- no result frames, then the malformed stopped
  // line, and exits 0). The value 10 is chosen to directly exercise exact-boundary
  // matching: a bare "schemaVersion":1 substring would incorrectly match
  // "schemaVersion":10. The normal parse path must FAIL CLOSED -- reject the
  // malformed stopped line via the shared exact-boundary check, emit NOTHING to
  // public stdout (no MotionFrame, and deliberately no fallback frame), keep helper
  // stdout/stderr private to Native Core, write only a safe "[helper-runtime-smoke] "
  // parent diagnostic, and return non-zero. Running it with --frames 0 keeps the
  // rejection ahead of any mapped result frame, so exactly zero public stdout lines
  // are produced. This is smoke-local parse hardening only, NOT a production parser,
  // backend, or runtime.
  MalformedStoppedSchema,
  // Smoke-only failure guard for the NORMAL helper-runtime smoke parse path:
  // malformed-ready-schema. The synthetic helper emits its "ready" lifecycle
  // boundary line with an invalid schema version (schemaVersion:10 instead of 1)
  // in place of the normal ready line, and otherwise completes cleanly (emits
  // -- with --frames 0 -- no result frames, then the "stopped" line, and exits
  // 0). The value 10 is chosen to directly exercise exact-boundary matching: a
  // bare "schemaVersion":1 substring would incorrectly match "schemaVersion":10.
  // Unlike HelperLifecycleHandshakeMalformedReady, which routes the same helper
  // mode through the lifecycle-handshake observation, this case runs the NORMAL
  // parse path. That path already rejects invalid "ready" lines: the ready line
  // is the first line parsed, so the rejection lands before any result frame is
  // mapped. The parse path must FAIL CLOSED -- reject the malformed ready line
  // via the shared exact-boundary check, emit NOTHING to public stdout (no
  // MotionFrame, and deliberately no fallback frame), keep helper stdout/stderr
  // private to Native Core, write only a safe "[helper-runtime-smoke] " parent
  // diagnostic, and return non-zero. Running it with --frames 0 keeps exactly
  // zero public stdout lines. This is smoke-local parse hardening only, NOT a
  // production parser, backend, or runtime.
  MalformedReadySchema,
  // Smoke-only guard for the NORMAL helper-runtime smoke parse path:
  // unknown-stdout-line. The synthetic helper emits one extra well-formed helper
  // line carrying an unknown "type" ("unknown-synthetic") immediately after the
  // "ready" line, and otherwise completes cleanly (emits -- with --frames 0 -- no
  // result frames, then the "stopped" line, and exits 0). On the normal parse
  // path the unknown line matches none of the recognized "ready"/"result"/
  // "stopped" branches, so it reaches the terminal unknown-line branch. The parse
  // path must FAIL CLOSED -- reject the unrecognized line as a parse error, emit
  // NOTHING to public stdout (no MotionFrame, and deliberately no fallback frame),
  // keep helper stdout/stderr private to Native Core, write only a safe
  // "[helper-runtime-smoke] " parent diagnostic ("unknown line type"), and return
  // non-zero. With --frames 0 the unknown line is the second line parsed, so the
  // rejection lands before any result frame could be mapped and exactly zero
  // public stdout lines are produced. This locks the current normal parse-path
  // boundary: unknown helper stdout cannot leak helper output, emit a fallback
  // MotionFrame, or silently fall through. This is smoke-local parse hardening
  // only, NOT a production parser, backend, or runtime.
  UnknownStdoutLine,
  // Smoke-only guard for the NORMAL helper-runtime smoke parse path:
  // malformed-stdout-line. The synthetic helper emits one short, intentionally
  // invalid helper-output line ("{\"type\":\"malformed-synthetic\" this-is-not-
  // valid-helper-json") immediately after the "ready" line, and otherwise
  // completes cleanly (emits -- with --frames 0 -- no result frames, then the
  // "stopped" line, and exits 0). Unlike unknown-stdout-line, whose line is a
  // WELL-FORMED helper object carrying an unrecognized "type", this line is
  // deliberately malformed (missing delimiters and a closing brace). On the
  // normal parse path the malformed line still matches none of the recognized
  // "ready"/"result"/"stopped" branches, so it reaches the SAME terminal
  // unknown-line branch. The parse path must FAIL CLOSED -- reject the malformed
  // line as a parse error, emit NOTHING to public stdout (no MotionFrame, and
  // deliberately no fallback frame), keep helper stdout/stderr private to Native
  // Core, write only a safe "[helper-runtime-smoke] " parent diagnostic ("unknown
  // line type"), and return non-zero. With --frames 0 the malformed line is the
  // second line parsed, so the rejection lands before any result frame could be
  // mapped and exactly zero public stdout lines are produced. This locks the
  // current normal parse-path boundary: a malformed helper stdout line cannot
  // leak helper output, emit a fallback MotionFrame, or silently fall through.
  // This is smoke-local parse hardening only, NOT a production parser, backend,
  // or runtime.
  MalformedStdoutLine,
  // Smoke-only guard for the NORMAL helper-runtime smoke parse path:
  // bounded-oversized-stdout-line. The synthetic helper emits its existing
  // bounded oversized helper-output line (the "oversized-synthetic" marker plus
  // a few KB of safe filler, via --emit-oversized-line) immediately after the
  // "ready" line, and otherwise completes cleanly (emits -- with --frames 0 --
  // no result frames, then the "stopped" line, and exits 0). The line is
  // deliberately bounded to a few KB (not multi-MB) so this stays deterministic
  // and memory-safe; it is a smoke-only fixture, NOT a production line-size
  // policy or streaming parser test. On the normal parse path the oversized line
  // carries none of the recognized "ready"/"result"/"stopped" type markers, so
  // it reaches the SAME terminal unknown-line branch as UnknownStdoutLine and
  // MalformedStdoutLine. The parse path must FAIL CLOSED -- reject the oversized
  // line as a parse error, emit NOTHING to public stdout (no MotionFrame, and
  // deliberately no fallback frame), keep helper stdout/stderr private to Native
  // Core, write only a safe "[helper-runtime-smoke] " parent diagnostic ("unknown
  // line type"), and return non-zero. With --frames 0 the oversized line is the
  // second line parsed, so the rejection lands before any result frame could be
  // mapped and exactly zero public stdout lines are produced. This locks the
  // current normal parse-path boundary only: it does not implement or claim a
  // production line-size policy, streaming parser behavior, buffer management
  // policy, memory-pressure mitigation, or oversized-line recovery behavior. This
  // is smoke-local parse hardening only, NOT a production parser, backend, or
  // runtime.
  BoundedOversizedStdoutLine,
  // Smoke-only guard for the NORMAL helper-runtime smoke parse path:
  // synthetic-adapter. The synthetic helper emits its normal "ready" line,
  // then, for each result frame, one of three deterministic adapter-style
  // value patterns cycling by frame index (in-range, out-of-range, and
  // exact-boundary), via --emit-adapter-values, then its normal "stopped"
  // line, and exits 0. This proves the synthetic helper/adapter boundary at
  // the value level: the normal parse path (parseResultLine) must parse each
  // pattern's numeric text and createTrackingSampleFromHelperResult must
  // clamp out-of-range values while preserving in-range and boundary values,
  // through LIVE captured helper stdout -- distinct from
  // lvk-helper-result-mapping-smoke, which calls the mapper directly on
  // hand-built structs and never parses live helper stdout text. It emits one
  // mapped MotionFrame JSON line per result frame on public stdout (same
  // shape as the Normal case), keeps helper stdout/stderr private to Native
  // Core, and returns 0 on success. This is smoke-local adapter/value-mapping
  // observation only, NOT a production backend, model, or runtime.
  SyntheticAdapter,
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
