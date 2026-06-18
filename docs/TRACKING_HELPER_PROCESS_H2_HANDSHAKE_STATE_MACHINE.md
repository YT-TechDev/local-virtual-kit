# Tracking Helper Process H2 Handshake and State Machine

## Status

Status: H2 handshake and state-machine design memo.
Scope: documentation-only design narrowing.
This is not an implementation plan.
This document does not approve H2 implementation, IPC implementation, real frame access, raw
frame / pixel / tensor IPC, high-rate raw frame transport, production backend selection, or H3
production integration.

This memo proposes the helper lifecycle state machine and the startup / shutdown handshake for
the IPC direction selected in
[`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
(a Native Core-owned private parent-child pipe), using the message set defined in
[`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md).

## Summary

- Builds on the pipe framing contract by defining **when** each control / result message is
  exchanged and **what state** Native Core tracks for the helper.
- Proposes a bounded startup handshake, a runtime liveness model, a bounded shutdown
  handshake, and explicit error / timeout transitions that **fail closed**.
- This is a **design direction only**. No IPC, no state machine, and no restart/backoff is
  implemented or approved here.

## Scope

- Covers the helper **lifecycle states**, **transitions**, and the **startup / liveness /
  shutdown** handshake over the private pipe only.
- Excludes any frame transport, backend selection, and any MotionFrame schema change.
- All helper state and message handling stays **Native Core-internal**; it is never public
  MotionFrame.

## State Model

Native Core tracks the helper through these states:

- `not_started` — no helper process exists yet.
- `launching` — Native Core is creating the child process.
- `waiting_for_ready` — child launched; Native Core awaits a `ready` message within the
  bounded startup timeout.
- `ready` — helper announced readiness; able to accept control messages.
- `running` — helper is producing `result` / `heartbeat` messages.
- `stopping` — Native Core sent `stop` and awaits a clean exit within the bounded shutdown
  timeout.
- `exited` — helper process has exited (clean path recorded).
- `failed` — helper failed (launch failure or non-zero exit).
- `timed_out` — a bounded timeout elapsed (startup, shutdown, or liveness silence).
- `fallback` — Native Core has failed closed and is emitting safe fallback MotionFrame.

## Startup Handshake

1. Native Core **creates** the helper child process (`not_started` → `launching`).
2. Native Core starts **bounded reads** of the helper's `stdout` / `stderr`
   (`launching` → `waiting_for_ready`).
3. Native Core **waits for a `ready` message** within a bounded startup timeout.
4. If `ready` arrives (`waiting_for_ready` → `ready`), Native Core may send `configure` and
   `start` control messages (`ready` → `running`).
5. If startup **times out**, the helper **exits**, or the helper emits **malformed or unsafe**
   output, Native Core treats the helper as unavailable and **falls back safely**
   (→ `timed_out` / `failed` → `fallback`).

## Runtime Liveness

- In `running`, the helper emits `heartbeat` or periodic `result` messages.
- Native Core treats **missed heartbeats or prolonged silence** as a helper hang
  (`running` → `timed_out`).
- Native Core **does not block camera capture** indefinitely waiting on the helper.
- Native Core **never accumulates unbounded** helper output (bounded reads, bounded queue per
  the framing contract).
- Native Core **continues producing MotionFrame output** regardless of helper state.

## Shutdown Handshake

1. Native Core sends `stop` (`running` → `stopping`).
2. Native Core waits a **bounded shutdown timeout**.
3. If the helper **exits cleanly**, Native Core records safe status (`stopping` → `exited`).
4. If the helper **does not exit**, Native Core **terminates** it (`stopping` → `exited` via
   forced termination, recorded as a safe diagnostic).
5. `lvk-tracker-core` **public stdout remains MotionFrame JSON only** throughout shutdown.

## Error / Timeout Transitions

- **Malformed JSON line** — drop the line, record a safe diagnostic, continue or mark the
  helper degraded.
- **Unknown message type** — ignore the message, record a safe diagnostic.
- **Oversized line** — reject the line (exceeds the bounded size), record a safe diagnostic.
- **Helper non-zero exit** — mark `failed`, fall back.
- **Timeout / silence** — mark `timed_out`, fall back.
- **Unsafe diagnostics** — treat as a policy violation and **fail closed**.
- **Repeated failures** — a **design-only** bounded restart / backoff option (see Restart /
  Backoff Stance); **not implemented here**.

## State Transition Table

| From                 | Event                                  | To                   | Native Core action                              |
| -------------------- | -------------------------------------- | -------------------- | ----------------------------------------------- |
| `not_started`        | start requested                        | `launching`          | create child process                            |
| `launching`          | child launched                         | `waiting_for_ready`  | begin bounded reads of stdout/stderr            |
| `launching`          | launch failure                         | `failed`             | record safe diagnostic, fall back               |
| `waiting_for_ready`  | `ready` received                       | `ready`              | optionally send `configure`                     |
| `waiting_for_ready`  | startup timeout / exit / unsafe output | `timed_out`/`failed` | mark unavailable, fall back                     |
| `ready`              | `start` sent                           | `running`            | begin consuming `result` / `heartbeat`          |
| `running`            | `result` / `heartbeat` received        | `running`            | map result → MotionFrame; reset liveness window |
| `running`            | missed heartbeats / silence            | `timed_out`          | mark hang, fall back                            |
| `running`            | non-zero exit                          | `failed`             | record safe diagnostic, fall back               |
| `running`            | stop requested                         | `stopping`           | send `stop`, start bounded shutdown timeout     |
| `stopping`           | clean exit                             | `exited`             | record safe status                              |
| `stopping`           | shutdown timeout                       | `exited`             | terminate child, record safe diagnostic         |
| `failed`/`timed_out` | —                                      | `fallback`           | emit safe fallback MotionFrame                  |

## Native Core Responsibilities

- Owns helper **spawn, supervision, timeouts, termination, and fallback**.
- Remains the **only camera owner** and the **only public MotionFrame producer**.
- Performs **bounded reads** of helper output and never accumulates an unbounded backlog.
- Maps the helper's internal `result` into the **existing** MotionFrame fields with **no
  schema change**.
- Emits **safe diagnostics only** and keeps public stdout MotionFrame JSON only.

## Helper Responsibilities

- Announce `ready` once initialized.
- Emit `heartbeat` and/or periodic `result` messages while `running`.
- Honor `stop` and exit promptly.
- **Never open the camera.**
- **Never** emit raw pixels, images, tensors, model contents, sensitive paths, or secrets.
- Keep output **bounded** and on the private channels only.

## Message Relationship to Pipe Framing Contract

State edges use the message types defined in the framing contract:

- Native Core → helper `stdin`: `configure`, `start`, `stop`, `ping`.
- helper → Native Core `stdout`: `ready`, `result`, `heartbeat`, `error`.
- helper → Native Core `stderr`: safe diagnostics only.

All such messages are **design-only examples**, remain **Native Core-internal**, are **not**
public MotionFrame, and must **not** be added to `packages/motion-protocol`.

## Fallback Behavior

- On any helper failure or timeout, Native Core **fails closed** to a safe fallback
  MotionFrame using only current fields: set `tracking.status` to `"lost"` and
  `tracking.confidence` to `0` (or a lowered value), letting the renderer hold/smooth the last
  valid pose (`docs/TRACKING_SPEC.md`, `docs/MOTION_PROTOCOL.md`).
- Renderer-visible behavior remains **MotionFrame-only**; no helper state leaks to the
  renderer.
- Do **not** introduce stale fields such as `face.detected`, `head.*`, or `eyes.blink`; the
  current schema expresses tracking state via `tracking.status` and `tracking.confidence`.
- **No MotionFrame schema change** is introduced.

## Restart / Backoff Stance

- A bounded **restart with backoff** is a **design-only** option for handling repeated helper
  failures.
- It is **not implemented or approved here**. Any restart / backoff policy requires its own
  design and explicit owner approval before implementation.

## Diagnostics Rules

- Diagnostics go to `stderr` as **safe metadata only** (for example current state, latency,
  heartbeat/timeout/restart counts).
- Diagnostics must **never** include raw pixels, images, screenshots, frame dumps, tensors,
  model contents, sensitive filesystem paths, or secrets.

## Security / Privacy Requirements

- **Native Core remains the only camera owner**; helper-owned camera capture remains **not
  approved**. The helper never opens the camera.
- **Native Core remains the only public MotionFrame producer.**
- **Helper `stdout` remains private** to Native Core; **helper `stderr` is safe diagnostics
  only**; **`lvk-tracker-core` public stdout remains MotionFrame JSON only**.
- **Temporary files for frame transport remain rejected** (persistence risk).
- **Loopback sockets remain non-default** new local network behavior requiring explicit
  review.
- **Shared memory / mmap remains deferred** unless a measured high-rate frame-transport need
  is later justified.
- **Electron and Web Preview remain unaware of helper IPC.**
- **MotionFrame schema remains unchanged**, and `packages/motion-protocol` must **not** gain
  helper runtime dependencies.

## What Remains Unapproved

- H2 implementation.
- IPC implementation.
- Real frame access.
- Raw frame / pixel / tensor IPC.
- High-rate raw frame transport.
- Helper-owned camera capture.
- Restart / backoff implementation.
- Production helper backend.
- MediaPipe / Python runtime / ONNX Runtime production approval.
- Model / task bundling.
- MotionFrame schema change.
- Electron / Web Preview / Motion Protocol changes.

## Future Approval Gates

Before any implementation of this state machine:

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
- [ ] automated checks planned
- [ ] manual local validation plan documented

## Next Recommended Step

- The project owner reviews this proposed handshake and state machine.
- The automated-check plan and state-machine test vectors are captured in
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md).
- A future **docs-only** PR may either add a **manual local validation checklist** for the
  state machine, or be a **helper prototype cleanup / docs maintenance PR** (safe cleanup
  only).
- No implementation until explicit owner approval is recorded.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — pipe message / framing contract this state machine uses.
- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first H2 IPC direction (private parent-child pipe).
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — Native Core camera ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates and open questions.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, startup/shutdown (§7), crash/hang (§9), diagnostics (§10).
- [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  — helper-process boundary options and cross-cutting concerns.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
