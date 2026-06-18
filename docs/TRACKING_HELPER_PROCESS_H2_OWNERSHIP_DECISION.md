# Tracking Helper Process H2 Ownership Decision

## Status

Status: H2 ownership design decision memo.
Decision: prefer Native Core camera ownership for future H2 evaluation.
Scope: documentation-only design narrowing.
This document does not approve H2 implementation, real frame access, IPC implementation,
production backend selection, or H3 production integration.

This memo narrows the H2 ownership direction before any implementation work begins. It is
**not** an implementation plan and selects no IPC mechanism or backend. It builds on the
options enumerated in
[`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
§4.

## 1. Summary

- H1 validated the synthetic helper-process mechanics — lifecycle, supervision, internal
  result mapping, runtime smoke, and fallback — **without any camera, model, or raw
  frames** (see
  [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)).
- H2 design preparation identified **frame ownership** as a key decision and listed
  Options A/B/C without choosing.
- This memo records the preferred ownership direction for future H2 evaluation:
  - Native Core remains the camera owner.
  - Helper-owned camera capture remains **not approved**.
  - Any future helper frame access must be bounded, local-only, non-persistent, and
    separately approved.
- This memo **does not approve implementation**.

## 2. Decision

**Decision: Prefer Native Core camera ownership by default.**

- Native Core remains the **only** component that opens and owns the camera.
- A future helper, **if approved**, may receive bounded local frame data from Native Core.
- The helper must **not** independently open the webcam/camera in H2 unless a later design
  proves it is safer and is explicitly approved.
- This decision narrows **ownership only**; it does not select an IPC mechanism or a
  backend.

## 3. Rationale

Native Core camera ownership is the safer default because it:

- Keeps a **single camera owner**, reducing permission and lifecycle complexity.
- Keeps camera access inside **Native Core**, which already owns the tracking pipeline and
  MotionFrame output (`docs/ARCHITECTURE.md`, `docs/TRACKING_SPEC.md`).
- Preserves the existing Electron / Web Preview / Motion Protocol boundaries.
- Reduces the risk of helper-specific camera-permission behavior differing across operating
  systems.
- Keeps helper stdout private and `lvk-tracker-core` stdout MotionFrame-only.
- Makes fallback behavior easier to **centralize** in Native Core.
- Avoids giving an experimental helper direct webcam access too early.

## 4. Alternatives Considered

| Option | Description                                                                                         | Decision             | Reason                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| A      | Native Core owns camera capture and sends bounded local frame data to the helper if later approved. | Preferred candidate  | Single camera owner; clearer lifecycle and fallback control.                                    |
| B      | Helper owns camera capture.                                                                         | Not approved         | Expands raw frame access and permission surface; harder to reason about local-first guarantees. |
| C      | No real-frame helper; stay Native Core-only.                                                        | Still valid fallback | Safest if no backend requires helper-side frame access.                                         |

## 5. Boundary Implications

- **Native Core:**
  - owns camera capture
  - owns tracking pipeline coordination
  - owns fallback MotionFrame behavior
  - remains the sole public MotionFrame producer
- **Helper:**
  - does not own the camera
  - may only receive frame data after future explicit approval
  - emits private helper results to Native Core only
- **Electron:**
  - no helper frame access
  - no direct frame transport
  - still manages app shell / settings / calibration / native process lifecycle
- **Web Preview:**
  - consumes MotionFrame only
  - no helper awareness
- **Motion Protocol:**
  - unchanged
  - no helper runtime dependencies

## 6. IPC Stance

No IPC implementation is selected yet.

- This PR **does not approve any frame transport IPC**.
- **Temporary files for frame transport remain rejected** (persistence risk).
- **Loopback sockets remain new local network behavior** requiring explicit review.
- **stdin/stdout JSON** remains suitable only for compact control/result messages, **not**
  high-rate raw frame transport.
- Any future frame transport must prove:
  - local-only operation
  - no persistence
  - bounded backpressure
  - crash / hang behavior
  - safe diagnostics
  - platform-specific security

## 7. Backpressure and Fallback Stance

- Any future Native Core → helper frame handoff must be **bounded**.
- No unbounded frame queues.
- Prefer a **coalesce-to-latest** or **drop-oldest** policy.
- Native Core must continue producing a safe fallback MotionFrame if the helper stalls,
  crashes, or times out.
- Renderer-visible behavior should remain through MotionFrame only.

## 8. What Remains Unapproved

- H2 implementation
- real frame access
- raw frame / pixel / tensor IPC
- IPC implementation
- helper-owned camera capture
- production helper backend
- MediaPipe production approval
- Python runtime production approval
- ONNX Runtime production approval
- model / task bundling
- MotionFrame schema change
- Electron / Web Preview / Motion Protocol changes

## 9. Future Approval Gates

Before any H2 implementation PR:

- [ ] owner approval recorded
- [ ] IPC design selected in a docs PR
- [ ] local-only proof documented
- [ ] no-persistence proof documented
- [ ] bounded backpressure documented
- [ ] crash / timeout fallback documented
- [ ] platform-specific IPC security documented
- [ ] diagnostics allowlist / denylist documented
- [ ] automated checks planned
- [ ] manual local validation plan documented

## 10. Next Recommended Step

- The next PR should be an **H2 IPC decision PR, still docs-only**.
- It should evaluate a short list of local IPC candidates for a bounded Native Core →
  helper frame handoff.
- It must still **not** implement raw frame access.

Suggested next PR title: `docs: add helper H2 IPC decision`.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates, frame ownership options (§4), and open questions.
- [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
  — H1 closeout review and next candidate work.
- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, phases H0–H3, and H2 entry gates.
- [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  — helper-process boundary options and raw-frame IPC stance.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
