# Tracking Helper Process H2 Pipe Framing Contract

## Status

Status: H2 pipe framing contract design memo.
Scope: documentation-only design narrowing of the Native Core-owned private parent-child pipe
message / framing contract.
This is not an implementation plan.
This document does not approve H2 implementation, IPC implementation, real frame access, raw
frame / pixel / tensor IPC, high-rate raw frame transport, production backend selection, or H3
production integration.

This memo proposes the message / framing contract for the IPC direction selected in
[`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
(a Native Core-owned private parent-child pipe). It builds on the ownership decision in
[`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
(Native Core owns camera capture) and the gates in
[`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md).

## Summary

- The first H2 IPC direction is a Native Core-owned private parent-child pipe carrying
  compact control and result messages.
- This memo proposes a **line-framed JSON contract** for that pipe: framing rules, channel
  roles, message envelope and types, bounds, and error/timeout/fallback handling.
- This is a **design direction only**. No IPC is implemented and nothing is approved for
  real frame access or production.

## Scope

- Covers only the **control**, **result/status**, and **diagnostics** framing on the private
  pipe between Native Core (parent/supervisor) and a synthetic helper (child).
- Excludes any frame transport, any backend selection, and any MotionFrame schema change.
- The helper result shape described here is **Native Core-internal** and is mapped by Native
  Core into the existing MotionFrame; it is never a second public producer.

## Framing Rules

- **UTF-8, newline-delimited JSON.** One JSON object per line (`\n`-terminated).
- **No multi-line JSON messages** — each message is a single line.
- **No binary payloads.**
- **No raw frame bytes.**
- **No base64-encoded images or tensors.**
- **No file paths that reveal sensitive local details.**
- **No unbounded message accumulation.**
- **Bounded message size** is a design requirement: messages exceeding a defined byte limit
  are rejected (see Error and Timeout Handling).
- **Bounded queue** is a design requirement: the reader never grows an unbounded backlog
  (see Bounds and Backpressure).

## Channel Roles

- **Native Core → helper `stdin`:** private **control messages only**.
- **helper → Native Core `stdout`:** private **structured result / status messages only**;
  remains private to Native Core and is never forwarded to public output.
- **helper → Native Core `stderr`:** **safe diagnostics only**; never raw data.
- **`lvk-tracker-core` public `stdout`:** **MotionFrame JSON only**.

This mirrors the existing pipe-based supervision primitive, which already captures the
child's `stdout`/`stderr` as private Native Core data
(`native/tracker-core/src/helper_process_supervisor.h`).

## Message Direction

| Channel                          | Direction            | Allowed content                                  |
| -------------------------------- | -------------------- | ------------------------------------------------ |
| helper `stdin`                   | Native Core → helper | private control messages only                    |
| helper `stdout`                  | helper → Native Core | private structured result / status messages only |
| helper `stderr`                  | helper → Native Core | safe diagnostics only (never raw data)           |
| `lvk-tracker-core` public stdout | Native Core → system | MotionFrame JSON only                            |

## Message Envelope

The following is an **ILLUSTRATIVE design-only** envelope. It is **Native Core-internal**, is
**not** MotionFrame, and must **not** be added to `packages/motion-protocol`:

```jsonc
// ILLUSTRATIVE ONLY — one compact JSON object per line, Native Core-internal helper IPC.
{ "type": "ready", "v": 1, "tsMs": 0 }
```

- `type` — message kind (see Control Messages / Helper Result Messages).
- `v` — helper-IPC envelope version (helper-internal; independent of MotionFrame
  `schemaVersion`).
- `tsMs` — helper-side timestamp in milliseconds.

## Control Messages

Native Core → helper `stdin` (design-only examples; helper-internal, not MotionFrame):

- `configure` — supply bounded, non-sensitive configuration for the synthetic run.
- `start` — begin producing synthetic results.
- `stop` — request graceful stop; Native Core waits a bounded time before terminating.
- `ping` — liveness probe; the helper is expected to answer (e.g. with `heartbeat`).

## Helper Result Messages

helper → Native Core `stdout` (design-only examples; helper-internal, not MotionFrame):

- `ready` — the helper is initialized and able to accept control messages.
- `result` — a compact **internal** tracking result. Native Core maps/normalizes/smooths it
  into the **existing** MotionFrame fields (`tracking`, `face`, `eyes`, `mouth`) with **no
  schema change**.
- `heartbeat` — periodic liveness signal.
- `error` — a structured, safe error status (no raw data).

The `result` shape stays Native Core-internal. Full landmark arrays or a complete blendshape
set are **not** approved for MotionFrame; any richer expression protocol is a separate,
intentional MotionFrame schema proposal and is out of scope here.

## Diagnostics Rules

- Diagnostics go to `stderr` as **safe metadata only** (for example helper status, latency,
  has-result / lost counts, restart count, timeout count).
- Diagnostics must **never** include raw pixels, images, screenshots, frame dumps, tensors,
  model contents, sensitive filesystem paths, or secrets.

## Bounds and Backpressure

- **Bounded message size:** each line must stay within a defined byte limit.
- **Bounded queue:** Native Core reads the latest result and never accumulates an unbounded
  backlog.
- If results ever outpace consumption, prefer **coalesce-to-latest** or **drop-oldest**; the
  helper must not block Native Core, and Native Core must not block camera capture.
- **No raw frame transport** is in scope; there are no frame buffers to manage in this
  contract.

## Error and Timeout Handling

Native Core defines bounded handling for each failure mode and **fails closed** to safe
fallback MotionFrame behavior:

- **Malformed JSON line** — drop the line, count it as a safe diagnostic, do not crash.
- **Unknown message type** — ignore the message, record a safe diagnostic.
- **Oversized message** — reject the line (exceeds the bounded size), record a safe
  diagnostic.
- **Timeout** — if `ready`/`heartbeat`/`result` does not arrive within a bounded window,
  treat the helper as unavailable.
- **Helper exit** — detect process exit (including non-zero exit) within a bounded window.
- **Helper silence** — treat prolonged silence (missed heartbeats) as a hang.

In every failure mode, Native Core records safe diagnostics only and applies the fallback
below. `lvk-tracker-core` public stdout continues to emit MotionFrame JSON only.

## Fallback Behavior

- On any helper failure, Native Core continues producing a **safe fallback MotionFrame**
  using only current fields: set `tracking.status` to `"lost"` and lower/zero
  `tracking.confidence`, letting the renderer hold/smooth the last valid pose
  (`docs/TRACKING_SPEC.md`, `docs/MOTION_PROTOCOL.md`).
- Renderer-visible behavior remains entirely through MotionFrame. No helper state leaks to
  the renderer.
- **No MotionFrame schema change** is introduced. Do not introduce `face.detected`, `head.*`,
  or `eyes.blink`; the current schema expresses tracking state via `tracking.status` and
  `tracking.confidence`.

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
- Production helper backend.
- MediaPipe / Python runtime / ONNX Runtime production approval.
- Model / task bundling.
- MotionFrame schema change.
- Electron / Web Preview / Motion Protocol changes.

## Future Approval Gates

Before any implementation of this contract:

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

- The project owner reviews this proposed pipe framing contract.
- A future **docs-only** PR may add a startup / shutdown handshake and helper state-machine
  memo built on this contract.
- No implementation until explicit owner approval is recorded.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first H2 IPC direction (private parent-child pipe).
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — Native Core camera ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates, IPC options (§5), and open questions.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, IPC stance (§5), startup/shutdown (§7), crash/hang (§9), diagnostics
  (§10), security checklist (§11).
- [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  — helper-process boundary options and IPC tradeoffs (§6).
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
