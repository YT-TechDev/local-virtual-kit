# Tracking Helper Process H2 Design Preparation

## Status

Status: H2 design preparation memo.
Scope: design questions and approval gates only.
This document does not approve H2 implementation, real frame access, production backend
selection, or H3 production integration.

This memo prepares a future H2 design review by defining the decisions and proof points
required before any real frame, pixel, or tensor crosses the helper boundary. It is **not**
an implementation plan and selects nothing. For the H1 status it builds on, see
[`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
and [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md).
For the design and phase boundaries, see
[`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
and [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md).

## 1. Summary

- H1 is ready for project-owner closeout as a **non-camera synthetic helper prototype**
  (H1a–H1e complete).
- H2 is the future phase in which a helper might need **local frame access** — real camera
  frames, pixels, or tensors crossing the process boundary.
- H2 is **blocked** until a design proof is reviewed and explicitly approved by the project
  owner.
- This document defines the gates and open questions only. It approves no implementation,
  no IPC, no frame access, and no backend.

## 2. H2 Problem Statement

- H1 proved process lifecycle, internal-result mapping into the existing MotionFrame shape,
  runtime smoke (normal path), and failure/timeout fallback — all using **synthetic** data,
  with no camera, model, raw frames, pixels, or tensors. The current supervisor
  (`native/tracker-core/src/helper_process_supervisor.h`) is a bounded, pipe-based,
  smoke-only primitive that is intentionally not wired into the default tracker runtime.
- H2 would only be considered if a future helper backend **genuinely needs** real frames,
  pixels, or tensors to produce tracking results. If a backend can be driven by Native Core
  in-process or with compact derived values only, H2 is not required.
- Real frame access changes the risk profile substantially. It introduces concerns around
  privacy, persistence, buffering/backpressure, crash and hang handling, IPC security,
  platform-specific behavior, performance under load, and diagnostics safety that the
  synthetic H1 prototype never had to face.

## 3. Non-Negotiable H2 Gates

Every item below must hold and be demonstrated before any H2 implementation lands:

- [ ] Local-only operation (no network egress of frames).
- [ ] No upload.
- [ ] No telemetry.
- [ ] No analytics.
- [ ] No external frame processing.
- [ ] No raw frame persistence.
- [ ] No temporary files for frame transport.
- [ ] Safe diagnostics only (no raw pixels/images/paths/secrets).
- [ ] Bounded backpressure (no unbounded buffering).
- [ ] Crash / hang behavior defined.
- [ ] Platform-specific IPC security defined.
- [ ] MotionFrame schema unchanged unless separately proposed and reviewed.
- [ ] Electron / Native Core / Web Preview / Motion Protocol boundaries preserved.
- [ ] Explicit project-owner approval recorded before implementation.

## 4. Frame Ownership Options

Documented for evaluation; **no option is approved for implementation in this PR**.

- **Option A — Native Core owns camera capture and sends bounded frame data to the helper.**
  Native Core keeps camera ownership (its current default) and passes only bounded,
  rate-limited frame data across the boundary. Keeps a single camera owner; cost is moving
  frame data through IPC.
- **Option B — Helper owns camera capture.** The helper opens the webcam itself. This moves
  camera ownership out of Native Core and creates the strongest local-first exposure (a
  second component touching raw frames).
- **Option C — No real-frame helper for now.** Stay with Native Core-only tracking and do
  not give any helper real frame access; revisit only if a concrete backend need appears.

Recommended stance:

- Prefer **Native Core camera ownership by default** (Option A or C).
- **Helper-owned camera capture (Option B) remains not approved** unless a later design
  proves it is both safer and simpler than Native Core ownership.
- No option is approved for implementation in this PR.

For the ownership decision, see
[`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md).

## 5. IPC Options to Evaluate

High-level evaluation only; **no IPC option is approved by this PR**.

- **stdin/stdout JSON** — already LVK's convention for control messages and compact result
  data (stdout = newline-delimited JSON, stderr = safe diagnostics). Not suitable for
  high-rate raw frame transport.
- **OS pipes** — private parent/child communication; matches the current smoke supervisor's
  pipe capture. Needs a defined backpressure and framing scheme for any larger payloads.
- **Named pipes** — viable local IPC (especially on Windows) but needs a cross-platform
  abstraction (Windows named pipes vs POSIX FIFOs/Unix domain sockets) and access control.
- **Shared memory / mmap** — more plausible for high-rate raw frames, but heavier to
  implement correctly (synchronization, lifetime, cleanup) and not a default.
- **Loopback sockets restricted to `127.0.0.1`** — easy and language-agnostic, but this is
  **new local network behavior** that requires explicit review and strict `127.0.0.1`
  binding.
- **Temporary files** — not appropriate for frame transport (persistence risk).

Required stance:

- **Temporary files for frame transport remain rejected** due to persistence risk.
- **Loopback sockets are new local network behavior** and require explicit review before
  use; restrict strictly to `127.0.0.1` if ever adopted.
- **High-rate raw frame transfer requires bounded backpressure and platform-specific
  security** before any code lands.
- **No IPC option is approved by this PR.**

## 6. Backpressure Requirements

- No unbounded queues.
- Bounded queue only.
- Drop oldest or coalesce to the latest frame.
- The helper must not block camera capture indefinitely.
- The native side must keep producing a safe MotionFrame fallback if the helper stalls.
- No frame persistence.

## 7. Crash / Timeout / Fallback Requirements

- Helper **crash** (process exit) must be detected within a bounded window.
- Helper **timeout / hang** (missed liveness) must be detected within a bounded window.
- The fallback MotionFrame policy must remain safe — for example lower
  `tracking.confidence`, set `tracking.status = "lost"`, and let the renderer hold/smooth
  the last valid pose (`docs/TRACKING_SPEC.md`).
- **Restart / backoff must be separately designed and reviewed before any production use**;
  it is out of scope for H2 preparation.
- Safe diagnostics only.
- No raw helper output on `lvk-tracker-core` stdout (tracker stdout stays MotionFrame JSON
  only).

## 8. Diagnostics and Privacy Requirements

- Diagnostics on **stderr only**.
- **Safe metadata only.**
- Allowed examples:
  - helper status
  - latency
  - dropped-frame count
  - restart count
  - timeout count
- Forbidden examples:
  - raw pixels
  - images
  - screenshots
  - frame dumps
  - tensors
  - model contents
  - sensitive filesystem paths
  - secrets

## 9. MotionFrame and Protocol Boundary

- H2 **should not change MotionFrame by default**.
- Any MotionFrame schema change must be a **separate, intentional protocol proposal** with
  its own review (`docs/MOTION_PROTOCOL.md`).
- The helper internal result shape remains **Native Core-internal** and must not become
  public MotionFrame.
- `packages/motion-protocol` must remain framework-independent and must **not** gain helper
  runtime dependencies.

## 10. H2 Design Review Questions

Open questions to resolve in a future H2 design decision:

1. Given the recorded decision that Native Core owns camera capture (see
   [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)),
   how does that ownership model constrain the future IPC design for the Native Core →
   helper frame handoff?
2. Which IPC method best satisfies local-only and platform-security requirements?
3. What is the maximum frame size and rate that H2 must handle?
4. What backpressure policy is acceptable?
5. What fallback behavior should the renderer see when the helper is unavailable?
6. How will H2 prove no persistence?
7. What diagnostics are allowed?
8. What platform-specific security differences exist for Windows / macOS / Linux?
9. What checks can be automated before manual local runtime validation?
10. What manual local validation is required, and who runs it?

## 11. H2 Approval Checklist

A future H2 implementation PR may proceed only when all of the following are true:

- [ ] Design PR reviewed.
- [ ] Owner approval recorded.
- [ ] Threat / privacy review completed.
- [ ] IPC method selected.
- [ ] Platform security documented.
- [ ] Bounded backpressure documented.
- [ ] Crash / timeout fallback documented.
- [ ] No-persistence proof documented.
- [ ] Automated checks defined.
- [ ] Manual local validation plan defined.
- [ ] Non-goals confirmed.

## 12. Explicit Non-Goals

- No code changes.
- No H2 implementation.
- No raw frame access approval.
- No IPC implementation.
- No backend selection.
- No production helper backend.
- No MediaPipe production approval.
- No Python runtime production approval.
- No model / task bundling approval.
- No Electron / Web Preview dependency.
- No MotionFrame schema change.

## 13. Next Recommended Step

- The project owner reviews this H2 design preparation memo.
- The frame ownership decision is now captured separately in
  [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  (prefer Native Core camera ownership), so it is no longer an open choice for the next PR.
- The next PR should be either:
  - an **H2 IPC decision PR**, still **docs-only**, that evaluates bounded local IPC
    candidates for a future Native Core → helper frame handoff, or
  - a **helper prototype cleanup / docs maintenance PR** (safe cleanup only).
- No implementation until explicit owner approval is recorded.

The first H2 IPC direction is now captured in
[`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
(prefer a Native Core-owned private parent-child pipe).

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
  — H1 closeout review and next candidate work.
- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, phases H0–H3, and H2 entry gates (§13).
- [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  — helper-process boundary options, raw-frame IPC stance (§5), and IPC tradeoffs (§6).
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
