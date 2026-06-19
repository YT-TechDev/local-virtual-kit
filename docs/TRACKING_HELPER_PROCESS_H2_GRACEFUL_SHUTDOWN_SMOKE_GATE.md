# Tracking Helper Process H2 Graceful Shutdown Smoke Gate

## Status

Status: docs-only implementation gate for a future synthetic-only H2 graceful shutdown smoke slice.
Scope: documentation-only narrowing for the first future shutdown smoke implementation slice.

- This gate implements nothing.
- This gate does **not** approve production H2 integration or default `lvk-tracker-core` runtime
  wiring.
- This gate does **not** approve timeout / forced-termination, already-exited,
  failure / timeout-after-stop, restart / backoff, or production shutdown supervisor behavior.
- This gate grants no real frame access, MotionFrame changes, Electron / Web Preview changes,
  dependencies, telemetry, analytics, cloud upload, external frame processing, or network behavior.
- Camera frames must stay local in v0.1.
- `lvk-tracker-core` public stdout must remain MotionFrame JSON only.
- Helper stdout / stderr must remain private to Native Core.
- This gate does not imply that helper stop / control-channel behavior already exists.

## Why This Gate Exists

The shutdown / control-channel scope gate records that helper stop / control behavior is not
implemented and that shutdown work needs a separate, explicit scope before implementation. The
synthetic shutdown smoke plan then listed multiple candidate future vectors:
`shutdown_graceful_exit`, `shutdown_timeout_forced_exit`, `shutdown_after_helper_already_exited`, and
`shutdown_after_failure_or_timeout`.

This gate narrows the first future implementation to only `shutdown_graceful_exit`. Keeping the first
slice to the graceful path avoids mixing the smallest synthetic shutdown smoke with timeout / forced
exit behavior, already-terminal edge cases, fallback interactions, restart / backoff, or production
supervisor semantics.

Timeout / forced-exit and edge-case vectors are intentionally deferred. They may require separate
policy decisions about bounded shutdown timeout, termination behavior, idempotent stop handling,
fallback meaning, and production supervisor boundaries. Those decisions must not drift into the first
graceful shutdown smoke slice.

## Source-Grounded Current State

- Current code has no parent-to-child control channel. The existing synthetic H2 smoke captures helper
  stdout / stderr and reconstructs lifecycle paths from captured output and bounded timeouts; it does
  not send `stop` or any other runtime control message to the helper.
- Existing H2 smoke lifecycle reconstruction is based on private helper stdout / stderr, not public
  `lvk-tracker-core` stdout.
- Existing stopped output is helper-driven. The synthetic helper's `stopped` line is emitted when the
  helper completes its own synthetic frame loop; it is not a response to a parent stop request.
- `stop`, `stopping`, and bounded shutdown timeout remain design-only concepts in current H2 docs.
  The pipe framing contract and handshake state machine describe them on paper, but this gate does
  not claim they are implemented.

## Selected Future Slice

Only this future vector is selected by this gate:

- `shutdown_graceful_exit`
  - Expected synthetic path idea:
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited`

Clarifications:

- This would be synthetic-only / smoke-local / test-only.
- This would not be production runtime wiring.
- This would not change public `lvk-tracker-core` stdout.
- This would not change MotionFrame.
- This would not touch Electron or Web Preview.
- This would not define production shutdown policy.
- This would not include forced termination or timeout behavior.

## Required Future Implementation Shape

A later implementation PR, if accepted, should stay within these boundaries:

- Add only the minimum synthetic helper / test hook needed to model a graceful stop path.
- Keep any synthetic stop / control marker private to Native Core smoke code.
- Keep helper stdout / stderr private.
- Keep public `lvk-tracker-core` stdout MotionFrame JSON only.
- Keep the smoke target standalone and not wired into default runtime.
- Add or update only smoke-local code / tests / docs needed for `shutdown_graceful_exit`.
- Keep all constants and markers labeled smoke-local / test-only.
- Avoid new dependencies.
- Avoid broad refactors.

## Explicitly Out of Scope

- `shutdown_timeout_forced_exit`
- `shutdown_after_helper_already_exited`
- `shutdown_after_failure_or_timeout`
- forced termination implementation
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
- `shutdown_graceful_exit` remains the only vector in scope,
- the expected path is documented,
- smoke-local / test-only labeling is preserved,
- public stdout safety is preserved,
- helper stdout / stderr privacy is preserved,
- no production runtime wiring is included,
- timeout / forced termination remains out of scope,
- restart / backoff remains out of scope,
- validation commands are identified.

## Recommended Next Step

Do a read-only review of this gate. If accepted, prepare a Claude Code implementation prompt for the
single `shutdown_graceful_exit` synthetic smoke slice.

Do not recommend Codex for the later implementation unless the implementation is extremely small and
isolated. Do not proceed to direct production runtime wiring.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only shutdown / control-channel scope gate that records helper stop / control behavior as
  not implemented.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — docs-only shutdown smoke plan that listed the broader candidate vector set narrowed by this gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — design-only startup / liveness / shutdown state machine including `stop`, `stopping`, and bounded
  shutdown timeout concepts.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — design-only private pipe framing and control-message examples.
