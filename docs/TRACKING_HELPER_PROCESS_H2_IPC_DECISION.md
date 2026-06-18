# Tracking Helper Process H2 IPC Decision

## Status

Status: H2 IPC design decision memo.
Decision: prefer a Native Core-owned private parent-child pipe as the first H2 IPC direction
to evaluate.
Scope: documentation-only design narrowing.
This document does not approve H2 implementation, real frame access, raw frame / pixel /
tensor IPC, IPC implementation, production backend selection, or H3 production integration.

This memo narrows the first H2 IPC direction after the ownership decision. It is **not** an
implementation plan and approves no IPC code. It builds on
[`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
(Native Core camera ownership) and the IPC options enumerated in
[`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
§5 and [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
§6.

## Summary

- The H2 ownership decision established that Native Core remains the camera owner and the
  helper must not open the camera directly.
- This memo narrows the **first H2 IPC direction to evaluate** to a **Native Core-owned
  private parent-child pipe** approach (compact stdin/stdout/stderr channels owned by Native
  Core).
- This is a **design direction only**. No IPC is implemented, no real frame access is
  approved, and no backend is selected.

## Decision

**Decision: Prefer a Native Core-owned private parent-child pipe as the first H2 IPC
direction.**

- The helper's `stdin` / `stdout` / `stderr` are treated as **private Native Core-owned
  helper channels**:
  - helper **stdout remains private** to Native Core (never forwarded to public output);
  - helper **stderr remains safe diagnostics only**;
  - `lvk-tracker-core` **public stdout remains MotionFrame JSON only**.
- This direction is for compact control and result messages, consistent with the existing
  pipe-based smoke supervisor.
- **No high-rate raw frame transport is approved** in this PR.
- **No raw frame / pixel / tensor IPC is approved** in this PR.
- This decision narrows the **IPC direction only**; it selects no implementation and no
  backend.

## Rationale

A Native Core-owned private parent-child pipe is the safest first direction because it:

- Matches LVK's existing convention — the current helper supervision already captures
  private child `stdout`/`stderr` over pipes with no temporary files
  (`native/tracker-core/src/helper_process_supervisor.h`).
- Is the simplest cross-platform private channel and needs no new local network behavior.
- Keeps camera ownership and fallback **centralized in Native Core**, which already owns the
  tracking pipeline and MotionFrame output.
- Keeps `lvk-tracker-core` public stdout as MotionFrame JSON only and helper output private.
- Avoids the heavier machinery (and failure modes) of shared memory / mmap for a first
  direction.
- Keeps Electron and Web Preview **unaware** of any helper IPC.

## Alternatives Considered

| Option                                                            | Decision                  | Reason                                                                                           |
| ----------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| Native Core-owned private parent-child pipe (stdin/stdout/stderr) | Preferred first direction | Matches existing convention; simplest private cross-platform channel; no new network behavior.   |
| Named pipes                                                       | Possible later            | Viable local IPC, but needs a cross-platform abstraction and access-control handling.            |
| Loopback sockets (`127.0.0.1`)                                    | Not default               | New local network behavior; requires explicit review before any use.                             |
| Shared memory / mmap                                              | Deferred                  | Heavier to implement correctly; revisit only if measured high-rate frame transport justifies it. |
| Temporary files                                                   | Rejected                  | Persistence risk; not appropriate for frame transport.                                           |

## IPC Boundary Implications

- **Native Core** owns the IPC channel and remains the **only public MotionFrame producer**.
- **Helper** emits private results to Native Core only; it does not produce public output.
- **Electron and Web Preview remain unaware of helper IPC**; Electron still owns the app
  shell / settings / calibration / native process lifecycle; Web Preview consumes MotionFrame
  only.
- **Motion Protocol remains unchanged** and gains no helper runtime dependencies;
  `packages/motion-protocol` stays framework-independent.

## Backpressure and Framing Requirements

- Use compact, newline-delimited JSON for control and result messages (the existing
  convention).
- Any channel use must be **bounded** — no unbounded queues.
- If frame data is ever added later (separately approved), prefer **coalesce-to-latest** or
  **drop-oldest**; the helper must not block camera capture indefinitely, and Native Core
  must keep producing a safe fallback MotionFrame if the helper stalls.
- **No raw frame transport is approved here.**

## Diagnostics and Privacy Requirements

- Diagnostics on **stderr only**, **safe metadata only**.
- Helper `stdout`/`stderr` must **not leak** raw pixels, images, tensors, filesystem paths,
  secrets, or model contents.
- `lvk-tracker-core` **stdout remains MotionFrame JSON only**.

## Platform Security Requirements

- A private parent-child pipe inherits the operating system's process isolation between the
  Native Core parent and the helper child.
- Any future channel beyond a private parent-child pipe (for example named pipes or loopback
  sockets) must define **platform-specific IPC security** (loopback-only binding, pipe ACLs,
  or equivalent) before any code lands.

## What Remains Unapproved

- H2 implementation.
- Real frame access.
- Raw frame / pixel / tensor IPC.
- IPC implementation.
- High-rate raw frame transport.
- Loopback sockets as a default.
- Shared memory / mmap.
- Temporary files for frame transport.
- Production helper backend.
- MediaPipe / Python runtime / ONNX Runtime production approval.
- Model / task bundling.
- MotionFrame schema change.
- Electron / Web Preview / Motion Protocol changes.

## Future Approval Gates

If real frame handoff is later approved, the channel must prove, before any code lands:

- [ ] local-only operation
- [ ] no upload
- [ ] no telemetry
- [ ] no analytics
- [ ] no external frame processing
- [ ] no raw frame persistence
- [ ] bounded backpressure
- [ ] crash / hang behavior defined
- [ ] safe diagnostics
- [ ] platform-specific IPC security
- [ ] no MotionFrame schema change

In addition: owner approval recorded, automated checks planned, and a manual local
validation plan documented.

## Next Recommended Step

- The project owner reviews this first H2 IPC direction.
- A future H2 design PR may detail the **pipe message / framing contract** (message types,
  bounds, error handling), still **docs-only**.
- No implementation until explicit owner approval is recorded.

The proposed pipe message / framing contract is captured in
[`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md).

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — Native Core camera ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates, IPC options (§5), and open questions.
- [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  — helper-process boundary options and IPC tradeoffs (§6).
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, IPC stance (§5), and security checklist (§11).
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
