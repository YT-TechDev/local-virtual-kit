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
The earlier H2 point-in-time next-step notes have been reconciled. For current phase status,
use this index and the H2 design readiness review. The scoped H2 prototype
implementation-gate is now documented in
[`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md);
any future scoped prototype implementation still requires explicit project-owner approval. No
H2 implementation is approved by this document.

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
9. [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
   — scoped prototype implementation-gate: intended scope, anticipated changed files, and the
   gates a future implementation PR must satisfy (grants no approval).
10. [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)
    — owner decision approving a future synthetic-only scoped prototype PR, bounded by the gate
    (records approval only; implements nothing).
11. [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
    — closeout for the first implemented synthetic-only H2 slice (PR #147,
    `lvk-helper-h2-state-machine-smoke`); records implementation state, not production integration.
12. [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
    — closeout for the startup-timeout synthetic vector (PR #149,
    `startup_timeout_fallback`); records implementation state, not production integration.

Background:

- [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
  — H1 synthetic-prototype closeout review.
- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design and phase boundaries (H0–H3).

## Current H2 Design State

- The H2 design-doc phase is complete.
- The first synthetic-only H2 state-machine smoke is implemented (PR #147):
  `lvk-helper-h2-state-machine-smoke`, a standalone Native Core executable that validates the
  normal / failure / timeout-silence lifecycle state paths using the existing synthetic helper
  and supervisor. See
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md).
- The startup-timeout synthetic vector is implemented (PR #149): the `startup_timeout_fallback`
  case (`not_started -> launching -> waiting_for_ready -> timed_out -> fallback`) added to the
  same smoke, covering a pure startup timeout where `ready` is not emitted before the bounded
  startup timeout. See
  [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md).
- The next gated candidate is a narrowly scoped synthetic-only helper-output error vector group
  (malformed / unknown / oversized helper output); it remains unimplemented and requires its own
  gate before any code is added.
- No production H2 integration exists; the default `lvk-tracker-core` runtime remains unchanged
  (the helper is not wired into it).
- No real frame access, helper-owned camera capture, new dependency, or MotionFrame schema
  change exists.
- Camera ownership, the first IPC direction, the framing contract, the state machine, the
  automated-check goals / test vectors, and the manual-validation claim rules remain **design
  documents**.

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

- **First slice merged:** the first synthetic-only H2 state-machine smoke is implemented and
  merged (PR #147), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md).
  It satisfied the implementation gate
  ([`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md))
  and the owner decision
  ([`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)).
- **Startup-timeout vector merged:** the `startup_timeout_fallback` vector is implemented and
  merged (PR #149), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md).
- **Next safe step:** a future small synthetic-only helper-output error vector planning slice
  (malformed / unknown / oversized helper output), or another docs decision / gate if the scope
  broadens, before any broader integration. Shutdown / control-channel vectors require a separate
  scope decision before implementation.
- No production H2 integration, no default `lvk-tracker-core` runtime wiring, and no real frame
  access until separately scoped and approved. All safety boundaries remain preserved.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  — authoritative latest H2 phase status.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — scoped prototype implementation-gate (intended scope, anticipated changed files, gates).
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)
  — owner decision approving a future synthetic-only scoped prototype PR (bounded by the gate).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147).
- [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
  — closeout for the startup-timeout synthetic vector (PR #149).
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation
  claim rules and reporting template.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
