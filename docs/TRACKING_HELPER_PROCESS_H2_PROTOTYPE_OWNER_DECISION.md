# Tracking Helper Process H2 Prototype Owner Decision

## Status

Status: H2 scoped prototype owner decision.
Scope: documentation-only decision record.

This document records the **project-owner approval** required before a future scoped H2
prototype implementation PR may begin. It approves _starting that future PR_ within strict
limits; it does **not** implement H2, IPC, tests, or any runtime behavior, and it performs no
manual local validation. Approval is bounded by the existing implementation-gate document
([`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md))
and limited to **synthetic-only** prototype work.

## Decision

- **Approved:** a future PR may begin the scoped H2 prototype implementation **after this
  decision PR is merged**.
- The future implementation PR **must satisfy**
  [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md).
- Approval is **limited to synthetic-only prototype work**. It grants no real frame access, no
  backend selection, and no schema change.
- This decision does not itself authorize any code; it authorizes the _start_ of a future
  scoped PR that must still meet every gate and safety boundary below.

## Approved Future Scope

The future implementation PR may evaluate **only**:

- A Native Core-owned **helper child-process lifecycle prototype**.
- A Native Core-owned **private parent-child pipe** (the first IPC direction already decided).
- **UTF-8 newline-delimited JSON framing** as defined in
  [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md).
- **Startup / liveness / shutdown** state-machine behavior as defined in
  [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md).
- **Synthetic helper messages only** — no camera, no real frames, no pixels, no tensors.
- **Fallback behavior** that preserves the current public MotionFrame output rules
  ([`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md)).
- **Targeted automated checks** for the state-machine and framing behavior, consistent with
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md).

## Not Approved

This decision does **not** approve:

- real camera frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate raw frame transport
- production backend selection
- MediaPipe / Python runtime / ONNX Runtime production approval
- model or task bundling
- restart / backoff implementation unless separately scoped
- new dependencies unless separately approved
- telemetry
- analytics
- cloud upload
- new network behavior
- MotionFrame schema changes
- Electron / Web Preview / Motion Protocol changes
- manual local validation execution in this PR

## Safety Boundaries

Reaffirmed and unchanged by this decision:

- Camera frames must stay local.
- v0.1 must not send camera frames to external servers.
- Native Core owns camera capture.
- The helper must not open the camera.
- Native Core remains the only public MotionFrame producer.
- Helper stdout / stderr remain private to Native Core.
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- MotionFrame schema remains unchanged.
- `packages/motion-protocol` must not gain helper runtime dependencies.
- No telemetry / analytics / cloud upload / new network behavior.

## Required Gates for the Future Implementation PR

The future scoped H2 prototype implementation PR must:

- reference this owner decision document
- reference
  [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
- list exact changed files
- keep implementation scope synthetic-only
- add no dependencies unless separately approved
- preserve fallback behavior
- preserve public stdout as MotionFrame JSON only
- include targeted automated checks if tests are implemented
- document any checks not run
- not claim manual local validation unless performed on a local developer machine

## Verification for This PR

- This PR is **documentation-only**.
- No runtime, OBS, webcam, native hardware, or manual local validation is performed or claimed.
- The only check expected for this docs-only change is `pnpm format:check`
  ([`docs/DEVELOPMENT_POLICY.md`](DEVELOPMENT_POLICY.md) §4).

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — the implementation gate this decision binds to.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  — H2 design-doc phase closeout / readiness review.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — pipe message / framing contract.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and helper state machine.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check plan and test vectors.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md)
  — manual local validation checklist.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
