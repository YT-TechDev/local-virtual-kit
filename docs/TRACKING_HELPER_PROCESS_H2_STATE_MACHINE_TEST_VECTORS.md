# Tracking Helper Process H2 State Machine Test Vectors

## Status

Status: H2 state-machine automated-check plan and test-vector design memo.
Scope: documentation-only design narrowing.
This is not an implementation plan, and no tests are implemented in this PR.
This document does not approve H2 implementation, IPC implementation, test implementation,
restart / backoff implementation, real frame access, raw frame / pixel / tensor IPC, high-rate
raw frame transport, production backend selection, or H3 production integration.

This memo proposes what future automated checks should assert for the helper state machine and
gives representative **design-only** test vectors. It builds on
[`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
and the message set in
[`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md).

## Summary

- Describes the **goals** a future automated check suite should satisfy for the designed
  startup / liveness / shutdown / error-handling state machine.
- Provides representative **design-only test vectors** in a docs-only format.
- This is a **design direction only**. No tests, no IPC, and no state machine are implemented
  or approved here.

## Scope

- Covers automated-check **goals** and **test-vector definitions** for the designed state
  machine only.
- Excludes any frame transport, backend selection, MotionFrame schema change, and any actual
  test code.
- All test vectors and helper messages stay **Native Core-internal**; they are never public
  MotionFrame.

## Automated Check Goals

A future automated check suite should validate that:

1. The designed state machine has **deterministic transitions** for normal startup.
2. **Startup timeout** falls back safely.
3. **Helper launch failure** falls back safely.
4. **Malformed JSON** does not crash Native Core.
5. **Unknown message types** are ignored with safe diagnostics.
6. **Oversized messages** are rejected with safe diagnostics.
7. **Missed heartbeat / helper silence** transitions to `timed_out` then `fallback`.
8. **Helper non-zero exit** transitions to `failed` then `fallback`.
9. **Shutdown timeout** terminates the helper and records safe diagnostics.
10. **Unsafe diagnostics** are treated as a policy violation / fail closed.
11. Public `lvk-tracker-core` stdout remains **MotionFrame JSON only**.
12. Helper `stdout` / `stderr` are **not forwarded** to public stdout.
13. **Fallback** uses only current MotionFrame fields.

## Test Vector Format

Test vectors are **design-only**, **Native Core-internal**, **not** MotionFrame, and must
**not** be added to `packages/motion-protocol`. Each vector may include:

- `id` — stable identifier.
- `name` — short human-readable name.
- `initial_state` — starting state-machine state.
- `input_events` — ordered events (control sends, helper messages, timeouts, exits).
- `expected_state_path` — ordered states the machine should pass through.
- `expected_public_stdout` — what `lvk-tracker-core` public stdout should contain (MotionFrame
  JSON only).
- `expected_private_diagnostics` — safe stderr metadata expectations (no raw data).
- `expected_fallback` — fallback MotionFrame expectation, if any.
- `non_goals` — what the vector explicitly does not assert.

```yaml
# ILLUSTRATIVE ONLY — design-only, Native Core-internal. Not MotionFrame. Not a test file.
id: example_vector
name: illustrative example
initial_state: not_started
input_events: [start_requested, "helper:ready", start_sent]
expected_state_path: [launching, waiting_for_ready, ready, running]
expected_public_stdout: motionframe_json_only
expected_private_diagnostics: safe_metadata_only
expected_fallback: none
non_goals: [no_real_frames, no_backend, no_schema_change]
```

## Startup Test Vectors

- `normal_startup_ready_running` — `not_started` → `launching` → `waiting_for_ready` →
  `ready` → `running` after `ready` arrives within the startup timeout; public stdout stays
  MotionFrame JSON only; no fallback.
- `startup_timeout_fallback` — no `ready` within the bounded startup timeout →
  `waiting_for_ready` → `timed_out` → `fallback`; safe diagnostics; fallback MotionFrame
  emitted.
- `launch_failure_fallback` — child fails to launch → `launching` → `failed` → `fallback`;
  safe diagnostics; fallback MotionFrame emitted.

## Runtime Liveness Test Vectors

- `heartbeat_missed_timeout_fallback` — in `running`, heartbeats / `result` messages stop →
  `running` → `timed_out` → `fallback`; Native Core keeps producing MotionFrame; no unbounded
  buffering.
- Note: a steady stream of `heartbeat` or `result` messages keeps the machine in `running`
  (the liveness window resets on each valid message).

## Shutdown Test Vectors

- `graceful_shutdown_exited` — `stop` sent, helper exits within the shutdown timeout →
  `running` → `stopping` → `exited`; safe status recorded; public stdout MotionFrame JSON only
  throughout.
- `shutdown_timeout_forced_termination` — `stop` sent, helper does not exit → `running` →
  `stopping` → `exited` via forced termination; safe diagnostic recorded.

## Error / Timeout Test Vectors

- `malformed_json_line_safe_drop` — a malformed line is dropped, recorded as a safe
  diagnostic; Native Core does not crash; state continues (or marks helper degraded).
- `unknown_message_type_safe_ignore` — an unknown `type` is ignored with a safe diagnostic;
  no state corruption.
- `oversized_message_reject` — a line exceeding the bounded size is rejected with a safe
  diagnostic.
- `helper_nonzero_exit_failed_fallback` — helper exits non-zero → `failed` → `fallback`; safe
  diagnostics; fallback MotionFrame emitted.

## Diagnostics Safety Test Vectors

- `unsafe_diagnostics_fail_closed` — if the helper emits unsafe content (raw pixels, images,
  tensors, model contents, sensitive paths, secrets), Native Core treats it as a **policy
  violation** and **fails closed** to fallback; the unsafe content is never forwarded to
  public stdout.

## Fallback MotionFrame Expectations

- Native Core must **fail closed** to safe fallback MotionFrame behavior.
- Fallback uses only current MotionFrame fields:
  - `tracking.status`
  - `tracking.confidence`
- Prefer `tracking.status = "lost"` and `tracking.confidence = 0` (or a lowered value) for
  helper failure.
- Do **not** introduce stale fields — no `face.detected`, no `head.yaw`, no `eyes.blink`.
- Renderer-visible behavior remains **MotionFrame-only**.
- `public_stdout_motionframe_only` — across all vectors, `lvk-tracker-core` public stdout must
  contain MotionFrame JSON only; helper `stdout` / `stderr` must never appear on public stdout.

## Out-of-Scope Checks

The following are explicitly **not** asserted by these vectors and remain future work:

- Real camera or real frame checks.
- Backend or model checks.
- Performance or high-rate frame-transport checks.
- Restart / backoff behavior checks.
- Cross-platform IPC security proofs.

## What Remains Unapproved

- H2 implementation.
- IPC implementation.
- Test implementation.
- Restart / backoff implementation.
- Real frame access.
- Raw frame / pixel / tensor IPC.
- High-rate raw frame transport.
- Helper-owned camera capture.
- Production helper backend.
- MediaPipe / Python runtime / ONNX Runtime production approval.
- Model / task bundling.
- MotionFrame schema change.
- Electron / Web Preview / Motion Protocol changes.

## Future Approval Gates

Before implementing any of these checks or tests:

- [ ] owner approval recorded
- [ ] local-only operation proven
- [ ] no upload
- [ ] no telemetry
- [ ] no analytics
- [ ] no external frame processing
- [ ] no raw frame persistence
- [ ] bounded backpressure documented
- [ ] crash / hang behavior documented
- [ ] safe diagnostics only
- [ ] platform-specific IPC security documented
- [ ] no MotionFrame schema change
- [ ] manual local validation plan documented

## Next Recommended Step

- The project owner reviews this automated-check plan and the test vectors.
- A future **docs-only** PR may add a **manual local validation checklist** for the state
  machine, or a helper prototype cleanup / docs maintenance PR.
- No implementation until explicit owner approval is recorded.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and state machine these vectors exercise.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — pipe message / framing contract and message types.
- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first H2 IPC direction (private parent-child pipe).
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — Native Core camera ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates and open questions.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, startup/shutdown (§7), crash/hang (§9), diagnostics (§10).
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
