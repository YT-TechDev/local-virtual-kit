# Tracking Helper Process H2 Forced-Exit Shutdown Smoke Gate

## Status

Status: docs-only implementation gate for a future synthetic-only H2 `shutdown_timeout_forced_exit` smoke slice.
Scope: documentation-only narrowing for the next possible synthetic shutdown smoke implementation slice.

- This gate selects only a future `shutdown_timeout_forced_exit` synthetic smoke candidate.
- This gate implements nothing.
- This gate does **not** approve production H2 integration or default `lvk-tracker-core` runtime
  wiring.
- This gate does **not** implement or approve production forced termination, production shutdown
  timeout behavior, production shutdown timeout policy, restart / backoff, or production supervisor
  shutdown semantics.
- This gate grants no real frame access, MotionFrame changes, Electron / Web Preview changes,
  dependencies, telemetry, analytics, cloud upload, external frame processing, or network behavior.
- Camera frames must stay local in v0.1.
- `lvk-tracker-core` public stdout must remain MotionFrame JSON only.
- Helper stdout / stderr must remain private to Native Core.
- This gate does not imply that helper stop / control-channel behavior already exists.

## Why This Gate Exists

The graceful shutdown smoke closeout records that `shutdown_graceful_exit` is covered at the
synthetic-smoke level only. That slice reconstructs a `stopping` lifecycle label from a private,
test-only helper marker and does not implement a real parent `stop` exchange, production shutdown
handshake, or supervisor shutdown policy.

The already-exited shutdown smoke closeout records that `shutdown_after_helper_already_exited` is
covered at the synthetic-smoke level only. That slice models a smoke-local, idempotent after-exit stop
observation as a no-op over an already-terminal clean path; it does not add a marker, a new lifecycle
state, or a real `stop` exchange.

The failure / timeout shutdown smoke closeout records that `shutdown_after_failure_or_timeout` is
covered at the synthetic-smoke level only. That slice preserves existing failure, timeout, and
fallback meaning after a smoke-local / test-only after-fallback stop observation; it does not add a
marker, a new lifecycle state, a real `stop` exchange, forced termination, shutdown timeout behavior,
or restart / backoff.

Those previous shutdown smoke vectors are now covered only at the synthetic-smoke / test-only level.
`shutdown_timeout_forced_exit` is the remaining candidate, but it is riskier because the timeout /
forced-exit terminology can drift into production process termination policy, cross-platform forced
kill semantics, or production supervisor shutdown behavior.

This gate exists to prevent that accidental drift. A future implementation, if approved, must stay
synthetic-only and smoke-local.

## Source-Grounded Current State

- Current code has no real parent-to-child control channel. The H2 smoke uses the existing bounded
  helper process supervisor to launch the synthetic helper, capture private helper stdout / stderr,
  and reconstruct lifecycle paths from captured output, bounded smoke behavior, and exit status.
- Previous shutdown observations are smoke-local / test-only observations. They are not real parent
  `stop` message exchanges and do not establish production shutdown / control-channel behavior.
- Existing timeout cases use bounded synthetic smoke behavior and must not be confused with
  production shutdown timeout behavior or production shutdown timeout policy.
- No production supervisor shutdown semantics are currently approved.
- No default `lvk-tracker-core` runtime wiring exists for H2.

## Selected Future Candidate

Only this future vector is selected by this gate:

- `shutdown_timeout_forced_exit`

Expected behavior idea:

- A synthetic helper models a shutdown that does not complete gracefully within a bounded smoke-local
  timeout.
- The smoke observes a forced-exit style terminal outcome at the synthetic-smoke level only.
- The reconstructed lifecycle must remain bounded and explicit.
- The case must not define production process termination policy.
- The case must not define cross-platform forced termination semantics.
- The case must not add restart / backoff.
- The case must not wire into default runtime.

Suggested path idea, if the future implementation can model it without production semantics:

`not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> fallback`

Caution: if source inspection later shows this path would require production supervisor changes, real
process termination policy, cross-platform forced-kill behavior, or a real control channel,
implementation must stop and return to design review.

## Required Future Implementation Shape

A later implementation PR, if accepted, should stay within these boundaries:

- Add only the minimum smoke-local / test-only hook needed to model the synthetic timeout /
  forced-exit observation.
- Keep any marker private to Native Core smoke code if one is absolutely necessary.
- Keep helper stdout / stderr private.
- Keep public `lvk-tracker-core` stdout MotionFrame JSON only.
- Keep the smoke target standalone and not wired into default runtime.
- Add or update only smoke-local code / tests / docs needed for `shutdown_timeout_forced_exit`.
- Keep all constants and markers labeled smoke-local / test-only.
- Avoid new dependencies.
- Avoid broad refactors.
- Avoid production supervisor behavior changes.
- Avoid cross-platform termination policy decisions.

## Explicitly Out of Scope

- production forced termination
- production shutdown timeout policy
- production supervisor shutdown semantics
- restart / backoff
- production H2 integration
- default `lvk-tracker-core` runtime wiring
- backend / model / runtime selection
- real camera / frame access
- raw frame / pixel / tensor IPC
- high-rate frame transport
- MotionFrame schema changes
- Electron / Web Preview / Motion Protocol changes
- general stdout / stderr streaming framework
- production size / rejection / backpressure policy
- new dependencies
- telemetry / analytics / cloud upload / network behavior

## Acceptance Criteria Before Code Implementation

A future code PR may start only after:

- this gate is reviewed,
- `shutdown_timeout_forced_exit` remains the only vector in scope,
- the expected synthetic behavior is documented,
- smoke-local / test-only labeling is preserved,
- public stdout safety is preserved,
- helper stdout / stderr privacy is preserved,
- no production runtime wiring is included,
- no production forced termination policy is included,
- no production shutdown timeout policy is included,
- restart / backoff remains out of scope,
- validation commands are identified,
- the implementation plan explicitly states whether it needs helper-only behavior,
  smoke-runner-only behavior, or supervisor behavior.

## Recommended Next Step

Do a read-only review of this gate. If accepted, prepare a narrow Plan Mode implementation prompt for
only the `shutdown_timeout_forced_exit` synthetic smoke slice.

Do not recommend direct production runtime wiring. Do not recommend production forced termination or
production shutdown timeout behavior.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the implemented `shutdown_after_failure_or_timeout` synthetic smoke vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate that selected only `shutdown_after_failure_or_timeout` as the prior shutdown
  slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the implemented `shutdown_after_helper_already_exited` synthetic smoke vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the implemented `shutdown_graceful_exit` synthetic smoke vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — docs-only shutdown smoke plan listing the broader candidate vector set.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only scope gate recording that helper stop / control behavior is not implemented.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — design-only startup / liveness / shutdown state machine including `stop`, `stopping`, bounded
  shutdown timeout, failure, timeout, and fallback concepts.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — design-only private pipe framing, channel roles, and control-message examples.
