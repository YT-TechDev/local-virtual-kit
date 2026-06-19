# Tracking Helper Process H2 Failure / Timeout Shutdown Smoke Gate

## Status

Status: docs-only implementation gate for a future synthetic-only H2 `shutdown_after_failure_or_timeout` smoke slice.
Scope: documentation-only narrowing for the next possible synthetic shutdown smoke implementation slice.

- This gate selects only a future `shutdown_after_failure_or_timeout` synthetic smoke candidate.
- This gate implements nothing.
- This gate does **not** approve production H2 integration or default `lvk-tracker-core` runtime
  wiring.
- This gate does **not** approve forced termination, shutdown timeout, restart / backoff, or
  production shutdown supervisor behavior.
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

The next safest candidate is `shutdown_after_failure_or_timeout` because it can be scoped as a
no-corruption / fallback-preservation check. A future smoke can verify that a synthetic stop /
shutdown observation after an already-failed or already-timed-out path does not rewrite failure or
timeout meaning, does not corrupt fallback reconstruction, and does not imply restart / backoff.

`shutdown_timeout_forced_exit` remains deferred because it risks drifting into forced termination,
bounded shutdown timeout policy, terminate-on-timeout behavior, and production supervisor timeout
semantics. Those decisions require separate review and remain unapproved.

## Source-Grounded Current State

- Current code has no real parent-to-child control channel. The H2 smoke uses the existing bounded
  helper process supervisor to launch the synthetic helper, capture private helper stdout / stderr,
  and reconstruct lifecycle paths from captured output, bounded timeouts, and exit status.
- `shutdown_graceful_exit` uses a private synthetic `"stopping"` marker and reconstructs a `stopping`
  lifecycle label from captured helper stdout. It is not a real `stop` message exchange.
- `shutdown_after_helper_already_exited` models the after-exit observation as a smoke-local / test-only
  no-op over the already-terminal clean path. It emits no marker, adds no lifecycle state, and is not
  a real `stop` message exchange.
- Existing failure / fallback and timeout smoke vectors already reconstruct failed or timed-out paths
  and then preserve fallback at the synthetic-smoke level.
- Any future failure / timeout-after-stop slice must preserve the meaning of failure, timeout, and
  fallback. It must not introduce restart / backoff.

## Selected Future Slice

Only this future vector is selected by this gate:

- `shutdown_after_failure_or_timeout`

Expected behavior idea:

- The helper has already entered a failed or timed-out synthetic path.
- A synthetic stop / shutdown observation after that point must not rewrite the failure or timeout
  meaning.
- It must not corrupt fallback reconstruction.
- It must not introduce restart / backoff.
- It must not introduce forced termination or shutdown timeout behavior.

Suggested expected synthetic path ideas:

- Failure path:
  `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`
- Timeout path:
  `not_started -> launching -> waiting_for_ready -> ready -> running -> timed_out -> fallback`

A future implementation may choose one narrow path first if implementing both the failure and timeout
paths at once would become too broad.

## Required Future Implementation Shape

A later implementation PR, if accepted, should stay within these boundaries:

- Add only the minimum smoke-local / test-only hook needed to model the after-failure or after-timeout
  observation.
- Keep any marker private to Native Core smoke code if one is absolutely necessary.
- Keep helper stdout / stderr private.
- Keep public `lvk-tracker-core` stdout MotionFrame JSON only.
- Keep the smoke target standalone and not wired into default runtime.
- Add or update only smoke-local code / tests / docs needed for `shutdown_after_failure_or_timeout`.
- Keep all constants and markers labeled smoke-local / test-only.
- Preserve fallback meaning.
- Avoid new dependencies.
- Avoid broad refactors.

## Explicitly Out of Scope

- `shutdown_timeout_forced_exit`
- forced termination implementation
- shutdown timeout behavior
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
- `shutdown_after_failure_or_timeout` remains the only vector in scope,
- the expected failure / timeout behavior is documented,
- smoke-local / test-only labeling is preserved,
- public stdout safety is preserved,
- helper stdout / stderr privacy is preserved,
- no production runtime wiring is included,
- forced termination and shutdown timeout remain out of scope,
- restart / backoff remains out of scope,
- validation commands are identified.

## Recommended Next Step

Do a read-only review of this gate. If accepted, prepare a narrow implementation prompt for only the
`shutdown_after_failure_or_timeout` synthetic smoke slice.

Do not recommend direct production runtime wiring. Do not recommend timeout / forced termination
implementation yet.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the implemented `shutdown_after_helper_already_exited` synthetic smoke vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate that selected only `shutdown_after_helper_already_exited` as the prior shutdown
  slice.
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
