# Tracking Helper Process H2 Synthetic Shutdown Smoke Plan

## Status

Status: docs-only synthetic shutdown smoke plan for a future H2 helper shutdown slice.
Scope: documentation-only planning; this implements nothing.

- This plan does **not** approve shutdown / control implementation.
- This plan does **not** approve production H2 integration or default `lvk-tracker-core` runtime wiring.
- This plan grants no real frame access, MotionFrame changes, Electron / Web Preview changes,
  dependencies, telemetry, analytics, cloud upload, external frame processing, or network behavior.
- Camera frames must stay local in v0.1.
- `lvk-tracker-core` public stdout must remain MotionFrame JSON only.
- Helper stdout / stderr must remain private to Native Core.
- This plan does not define production supervisor semantics and does not imply that helper stop /
  control-channel behavior already exists.

## Why This Plan Exists

The completed H2 synthetic smoke group covered the one-way captured-output lifecycle and helper-output
error vectors at the synthetic-smoke level. The shutdown / control-channel scope gate then recorded
that the implemented smoke does not establish parent-to-child shutdown behavior and listed the
decisions that must be settled before any helper `stop` / control-channel implementation begins.

This document narrows the first possible synthetic shutdown smoke slice before any code is written. It
records a small, smoke-local / test-only planning shape that could later validate shutdown / control
decisions without approving production H2 integration, default runtime wiring, or real camera / frame
access.

## Source-Grounded Current State

- Current code has no parent-to-child control channel. The existing smoke captures private helper
  stdout / stderr and reconstructs lifecycle paths from captured output and bounded timeouts; it does
  not send `stop` or any other control message to the helper.
- Current synthetic helper behavior is command-line-option driven. The helper does not expose a
  `stdin` command loop for runtime control.
- The existing H2 smoke reconstructs lifecycle paths from private helper stdout / stderr rather than
  from public `lvk-tracker-core` stdout.
- The existing `stopped` helper line is helper-driven. It is emitted when the synthetic helper
  completes its own frame loop; it is not a response to a parent `stop` request.
- `stop`, `stopping`, and bounded shutdown timeout remain design-only concepts in the current H2 docs.
  They are described by the pipe framing contract and handshake state-machine documents, but no source
  implements them today.

## Chosen Planning Decisions for the Future Synthetic Smoke

These are intended decisions for a future smoke-local / test-only implementation, not approval to
implement them in this PR:

- **Shutdown ownership:** use a test-only parent-owned synthetic shutdown attempt.
- **Control shape:** a synthetic-only `stop` control path may be modeled, but it must remain private to
  Native Core and must not affect public stdout.
- **Graceful before forced:** a future smoke may model graceful stop first, then bounded forced
  termination as a test-only fallback.
- **Timeout behavior:** use a smoke-local bounded shutdown timeout; do not define a production
  supervisor timeout.
- **Fallback interaction:** stop during already failed / timed-out states must not corrupt fallback
  reconstruction.
- **Private diagnostics:** shutdown diagnostics remain helper / private Native Core diagnostics only.
- **Public stdout safety:** `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- **Restart / backoff separation:** restart / backoff remains out of scope.
- **Validation strategy:** future validation is synthetic-smoke-only and must not require real camera /
  frame access.

## Candidate Smoke Vectors

These are candidate future vectors only. They are not implemented by this plan.

- `shutdown_graceful_exit`
  - Expected synthetic path idea:
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited`
- `shutdown_timeout_forced_exit`
  - Expected synthetic path idea:
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> exited`
  - This path is smoke-local / test-only and must not be treated as production supervisor semantics.
- `shutdown_after_helper_already_exited`
  - Expected behavior: stop request is safe / idempotent and does not corrupt the reconstructed
    lifecycle.
- `shutdown_after_failure_or_timeout`
  - Expected behavior: stop request does not change the meaning of fallback and does not introduce
    restart / backoff behavior.

## Explicit Out of Scope

- production H2 integration
- default `lvk-tracker-core` runtime wiring
- real shutdown / control implementation
- restart / backoff
- backend / model / runtime selection
- real camera / frame access
- raw frame / pixel / tensor IPC
- high-rate frame transport
- MotionFrame schema changes
- Electron / Web Preview / Motion Protocol changes
- general stdout / stderr streaming framework
- production size / rejection / backpressure policy
- production supervisor shutdown policy
- new dependencies
- telemetry / analytics / cloud upload / network behavior

## Required Invariants

- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout / stderr remain private to Native Core.
- Shutdown / control diagnostics must not leak into public stdout.
- Any test-only stop / control marker must be clearly labeled synthetic / smoke-local.
- Any future implementation must not require Electron / Web Preview runtime dependencies.
- Camera frames stay local.
- No production behavior may be inferred from smoke-local constants or synthetic markers.

## Acceptance Criteria Before Implementation

A future implementation PR may only start after:

- this plan is reviewed,
- the candidate vector list is accepted,
- the implementation remains synthetic-only,
- expected paths are documented,
- validation commands are identified,
- public stdout safety is preserved,
- no production runtime wiring is included,
- restart / backoff remains out of scope.

## Recommended Next Step

Do a read-only review of this plan and confirm whether the candidate vectors and invariants are the
right smallest safe shutdown smoke slice. Do not implement shutdown / control behavior in the same PR
as this plan. Do not proceed to direct production runtime wiring or production H2 integration from this
plan.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only gate that records decisions required before helper shutdown / control-channel
  implementation.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed-only startup / liveness / shutdown state machine, including `stop`, `stopping`, and
  bounded shutdown timeout concepts.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — designed-only private pipe framing and control-message examples.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the final helper-output error vector in the completed synthetic smoke group.
