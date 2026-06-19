# Tracking Helper Process H2 Synthetic Smoke Phase Handoff

## Status

Status: H2 synthetic smoke phase handoff.
Scope: documentation-only handoff after the H2 synthetic shutdown smoke group was completed and
reviewed as ready.

This document records the current completed synthetic-smoke state only. It implements nothing and does
not approve production H2 integration or default `lvk-tracker-core` runtime wiring.

This document also does not approve real frame access, helper-owned camera capture, production
shutdown / control, production forced termination, production shutdown timeout policy, restart /
backoff, MotionFrame changes, Electron / Web Preview changes, dependencies, telemetry, analytics,
cloud upload, external frame processing, or network behavior.

## Final Readiness Review Result

- **Judgment:** ready
- **Blocking issues:** none
- **Scope:** latest main after PR #168

The final readiness review confirmed docs / source alignment for the H2 synthetic shutdown smoke group
and found no blockers to closing that group at the synthetic-smoke level. No production runtime
behavior was approved.

## Completed Synthetic Smoke Coverage

The H2 synthetic smoke phase now covers the following groups at the synthetic-smoke level:

- Normal lifecycle
- Failure / fallback
- Ready / running silence timeout
- Startup timeout before ready
- Unknown helper-output message
- Malformed helper-output line
- Oversized helper-output line
- `shutdown_graceful_exit`
- `shutdown_after_helper_already_exited`
- `shutdown_after_failure_or_timeout`
- `shutdown_timeout_forced_exit`

## Shutdown Synthetic Smoke Group Closeout

The completed shutdown synthetic smoke group consists of four vectors:

- `shutdown_graceful_exit`
  - Expected path:
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited`
  - Uses a private marker to reconstruct `stopping`; there is no real stop exchange.
- `shutdown_after_helper_already_exited`
  - Expected path:
    `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`
  - Models a smoke-local idempotent no-op after an already-terminal path.
- `shutdown_after_failure_or_timeout`
  - Expected paths:
    - `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`
    - `not_started -> launching -> waiting_for_ready -> ready -> running -> timed_out -> fallback`
  - Models a smoke-local idempotent no-op over already-terminal fallback paths.
- `shutdown_timeout_forced_exit`
  - Expected path:
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> exited`
  - Terminal state is `exited`, not `fallback`.
  - `timed_out` is a reconstructed synthetic shutdown-timeout observation, not a real supervisor
    timeout.
  - No real forced kill occurs.
  - Private marker ordering is asserted as:
    `ready -> result -> stopping -> shutdown-timeout -> stopped`.

## Boundaries Preserved

- Synthetic-only.
- No camera access.
- No real frames, pixels, tensors, images, or model payloads.
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No high-rate frame transport.
- No default `lvk-tracker-core` runtime wiring.
- No production H2 integration.
- No real parent-to-child control channel.
- No production forced termination.
- No production shutdown timeout policy.
- No production supervisor shutdown semantics.
- No restart / backoff.
- No MotionFrame schema change.
- No Electron / Web Preview / Motion Protocol change.
- No new dependencies.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior.
- Helper stdout / stderr remain private to Native Core.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.

## What Remains Unapproved

- Production H2 integration.
- Default `lvk-tracker-core` helper runtime wiring.
- Real helper stop / control-channel implementation.
- Production process lifecycle / shutdown policy.
- Production forced termination.
- Production shutdown timeout policy.
- Restart / backoff.
- Backend / model / runtime selection.
- Real camera / frame access.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- MotionFrame schema changes.
- Electron / Web Preview integration changes.
- New dependencies.
- Telemetry / analytics / cloud upload / network behavior.

## Recommended Next Step

1. First, perform a read-only review of this handoff PR.
2. Then, create a separate docs-only next-scope gate before any production H2 work.

Suggested future gate name:
`docs/TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md`.

Do not proceed directly to production runtime wiring. Do not begin immediate production shutdown /
control implementation. Do not add real frame access yet.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the initial H2 synthetic state-machine smoke.
- [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
  — closeout for the startup-timeout synthetic vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md)
  — closeout for the unknown helper-output message vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the malformed helper-output line vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the oversized helper-output line vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_graceful_exit` vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_after_helper_already_exited` vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_after_failure_or_timeout` vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_timeout_forced_exit` vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — shutdown / control-channel scope gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — synthetic shutdown smoke plan.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
