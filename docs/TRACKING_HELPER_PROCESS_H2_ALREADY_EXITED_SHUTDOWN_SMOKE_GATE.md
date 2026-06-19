# Tracking Helper Process H2 Already-Exited Shutdown Smoke Gate

## Status

Status: docs-only implementation gate for a future synthetic-only H2 already-exited shutdown smoke slice.
Scope: documentation-only narrowing for the next possible synthetic shutdown smoke implementation slice.

- This gate selects only a future `shutdown_after_helper_already_exited` synthetic smoke candidate.
- This gate implements nothing.
- This gate does **not** approve production H2 integration or default `lvk-tracker-core` runtime
  wiring.
- This gate does **not** approve forced termination, shutdown timeout, failure-after-stop handling,
  restart / backoff, or production shutdown supervisor behavior.
- This gate grants no real frame access, MotionFrame changes, Electron / Web Preview changes,
  dependencies, telemetry, analytics, cloud upload, external frame processing, or network behavior.
- Camera frames must stay local in v0.1.
- `lvk-tracker-core` public stdout must remain MotionFrame JSON only.
- Helper stdout / stderr must remain private to Native Core.
- This gate does not imply that helper stop / control-channel behavior already exists.

## Why This Gate Exists

The graceful shutdown smoke closeout records that `shutdown_graceful_exit` is now covered at the
synthetic-smoke level only. That slice reconstructs a `stopping` lifecycle label from a private,
test-only helper marker and does not implement a real parent `stop` exchange, production shutdown
handshake, or supervisor shutdown policy.

The next safest candidate is `shutdown_after_helper_already_exited` because it can be scoped as an
idempotency / no-corruption check after the helper has already reached a clean terminal state. It can
verify that a synthetic stop / shutdown observation after clean exit does not corrupt the reconstructed
lifecycle path without claiming production stop semantics.

Timeout / forced termination remains deferred because it risks drifting into production supervisor
semantics: bounded shutdown timeout policy, terminate-on-timeout behavior, safe diagnostics, fallback
meaning, and process ownership all need separate review before implementation. Failure-after-stop
handling and restart / backoff remain similarly unapproved.

## Source-Grounded Current State

- Current code has no real parent-to-child control channel. The H2 smoke uses the existing bounded
  helper process supervisor to launch the synthetic helper, capture private helper stdout / stderr,
  and reconstruct lifecycle paths from captured output, timeouts, and exit status.
- `shutdown_graceful_exit` uses a private synthetic `"stopping"` marker and reconstructs a `stopping`
  lifecycle label from captured helper stdout. It is not a real `stop` message exchange.
- The synthetic helper can already complete cleanly and emit `stopped`; the smoke reconstructs
  `exited` from the clean `stopped` marker plus exit code 0.
- Any future already-exited slice must stay synthetic-smoke / test-only and must not claim production
  stop, shutdown, timeout, forced-termination, fallback, restart, or supervisor semantics.

## Selected Future Slice

Only this future vector is selected by this gate:

- `shutdown_after_helper_already_exited`

Expected behavior idea:

- The helper has already reached a clean terminal state.
- A synthetic stop / shutdown observation after that point must be safe and idempotent.
- It must not corrupt the reconstructed lifecycle.
- It must not introduce fallback, restart / backoff, forced termination, or shutdown timeout behavior.

Suggested expected synthetic path idea:

`not_started -> launching -> waiting_for_ready -> ready -> running -> exited`

If a future implementation needs a smoke-local marker to represent an after-exit stop observation,
that marker must remain private to the smoke path and must not be treated as production IPC.

## Required Future Implementation Shape

A later implementation PR, if accepted, should stay within these boundaries:

- Add only the minimum smoke-local / test-only hook needed to model the already-exited observation.
- Keep any marker private to Native Core smoke code.
- Keep helper stdout / stderr private.
- Keep public `lvk-tracker-core` stdout MotionFrame JSON only.
- Keep the smoke target standalone and not wired into default runtime.
- Add or update only smoke-local code / tests / docs needed for `shutdown_after_helper_already_exited`.
- Keep all constants and markers labeled smoke-local / test-only.
- Avoid new dependencies.
- Avoid broad refactors.

## Explicitly Out of Scope

- `shutdown_timeout_forced_exit`
- `shutdown_after_failure_or_timeout`
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
- `shutdown_after_helper_already_exited` remains the only vector in scope,
- the expected behavior is documented,
- smoke-local / test-only labeling is preserved,
- public stdout safety is preserved,
- helper stdout / stderr privacy is preserved,
- no production runtime wiring is included,
- timeout / forced termination remains out of scope,
- restart / backoff remains out of scope,
- validation commands are identified.

## Recommended Next Step

Do a read-only review of this gate. If accepted, prepare a narrow implementation prompt for only the
`shutdown_after_helper_already_exited` synthetic smoke slice.

Do not recommend direct production runtime wiring. Do not recommend timeout / forced termination
implementation yet.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the implemented `shutdown_graceful_exit` synthetic smoke vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate that selected only `shutdown_graceful_exit` as the first shutdown slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — docs-only shutdown smoke plan listing the broader candidate vector set.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only scope gate recording that helper stop / control behavior is not implemented.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — design-only startup / liveness / shutdown state machine including `stop`, `stopping`, and bounded
  shutdown timeout concepts.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — design-only private pipe framing and control-message examples.
