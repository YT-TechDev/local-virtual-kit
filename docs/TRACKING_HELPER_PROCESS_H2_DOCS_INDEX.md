# Tracking Helper Process H2 Docs Index

## Status

Status: H2 design-doc navigation / status index.
Scope: documentation-only navigation summary; no new design decisions.
This document does not approve H2 implementation, IPC implementation, real frame access, or any
backend.

## Purpose

This index is the single place to find the H2 helper-process design documents, their reading
order, the current design state, and the one authoritative next step.

The H2 design **readiness review** is the authoritative latest phase status:
[`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md).
Each individual document also has its own "Next Recommended Step" that reflects that document's
point in time; for the current phase status and next step, prefer this index and the readiness
review.

## H2 Docs Reading Order

1. [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
   — H2 design gates, frame-ownership options, and open questions.
2. [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
   — prefer Native Core camera ownership; helper-owned capture not approved.
3. [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
   — first IPC direction: a Native Core-owned private parent-child pipe.
4. [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
   — UTF-8 newline-delimited JSON framing, channel roles, bounds, safe diagnostics.
5. [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
   — startup / liveness / shutdown states, transitions, and fail-closed fallback.
6. [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
   — automated-check goals and representative design-only test vectors.
7. [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md)
   — manual local validation checklist and safe-evidence / claim rules.
8. [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
   — H2 design-doc phase closeout / readiness review (authoritative latest status).

Background:

- [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
  — H1 synthetic-prototype closeout review.
- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design and phase boundaries (H0–H3).

## Current H2 Design State

- The H2 design-doc phase is complete.
- No H2 prototype is implemented.
- Camera ownership, the first IPC direction, the framing contract, the state machine, the
  automated-check goals / test vectors, and the manual-validation claim rules are all defined
  in **documentation only**.

## Safety Boundaries

These boundaries are preserved across all H2 docs:

- Native Core remains the only camera owner.
- The helper must not open the camera.
- Native Core remains the only public MotionFrame producer.
- Helper stdout remains private to Native Core.
- Helper stderr is safe diagnostics only.
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- MotionFrame schema remains unchanged.
- `packages/motion-protocol` must not gain helper runtime dependencies.
- No raw frame / pixel / tensor IPC is approved.
- No high-rate raw frame transport is approved.
- No helper-owned camera capture is approved.
- No new network behavior is approved.
- Temporary files for frame transport remain rejected.
- Loopback sockets remain non-default.
- Shared memory / mmap remains deferred.

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

## Next Recommended Step

- **Next safe step:** helper prototype cleanup / docs maintenance.
- **Implementation path:** only under explicit project-owner approval, prepare a separate
  scoped H2 prototype implementation-gate prompt.
- No implementation until explicit owner approval is recorded.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  — authoritative latest H2 phase status.
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation
  claim rules and reporting template.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
