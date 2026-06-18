# Tracking Helper Process H2 Prototype Implementation-Gate

## Status

Status: H2 prototype implementation-gate specification.
Scope: documentation-only gate definition; no new design decisions.
This document does not approve H2 implementation, IPC implementation, test implementation,
restart / backoff implementation, real frame access, raw frame / pixel / tensor IPC, high-rate
raw frame transport, production backend selection, dependency / model / runtime packaging, or
any MotionFrame schema change. It selects no backend, authorizes no code, and records no
project-owner approval. It performs no manual local validation and claims none.

This document is the single place a future scoped H2 prototype implementation PR must be
checked against **before** any code is written. The design rationale already lives in the
merged H2 design docs; this document does not restate those decisions, it defines the gate
that applies them per-PR.

## Purpose

The H2 design-doc phase is complete (design preparation, ownership decision, IPC decision,
pipe framing contract, handshake / state machine, state-machine test vectors, manual local
validation checklist, design readiness review, and docs index). The gate criteria for any
future implementation currently exist only as two embedded checklists inside the design
readiness review.

This document consolidates those criteria into one authoritative implementation-gate
artifact so that a future scoped H2 prototype PR has a single, referenceable control point
that defines:

- the smallest intended prototype scope (in design terms only),
- the anticipated changed files (an estimate, not an authorization), and
- every gate that must be satisfied before implementation may begin.

## Relationship to Prior H2 Docs

- Design rationale stays in the source docs and is **not** duplicated here.
- The implementation and validation gate checklists below mirror those embedded in
  [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  and are intended as the place to **apply** them per-PR.
- For navigation and current phase status, see
  [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md).
- This document introduces no new design decision, no new IPC choice, and no new protocol
  field.

## Proposed Scoped Prototype Boundary

Described as intended scope only. **This is a description, not an approval to build it.**

A first scoped H2 prototype, if and only if the project owner later approves it, would be the
smallest slice that exercises the already-designed pipe framing and helper state machine
using **synthetic** data only:

- Exercise the Native Core-owned **private parent-child pipe** and the UTF-8
  newline-delimited JSON framing already defined in
  [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md).
- Exercise the startup / liveness / shutdown **state machine** and fail-closed fallback
  defined in
  [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md),
  against the representative vectors in
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md).
- Use **synthetic** payloads only — **no camera, no real frames, no pixels, no tensors**.
- Keep the helper outside the default tracker runtime (smoke-only), as the current bounded
  primitive already is.

Explicitly **outside** even this first scoped prototype:

- No camera capture in the helper.
- No real frame / pixel / tensor transport.
- No high-rate raw frame transport.
- No restart / backoff implementation.
- No production backend, model, or runtime.
- No MotionFrame schema change.
- No new dependency.
- No new network behavior.

## Expected Changed Files (anticipated, not authorized)

This is an **estimate** to scope a future PR. A real implementation PR must confirm the
actual touch points against the current source; this list authorizes nothing.

- `native/tracker-core/src/helper_process_supervisor.h` — the existing bounded, pipe-based,
  smoke-only supervisor primitive (see
  [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  §2), which is intentionally not wired into the default tracker runtime.
- A co-located native smoke test exercising the state machine vectors (synthetic only).

Any change beyond these would require its own scope statement and review. The PR should stay
small and reviewable per `docs/AGENTS.md`.

## Implementation Gate Checklist

A future scoped H2 prototype implementation PR may proceed only when **all** of the following
hold:

- [ ] explicit project-owner approval recorded
- [ ] exact implementation scope documented
- [ ] expected changed files listed and confirmed against current source
- [ ] no raw frames unless separately approved
- [ ] no camera access in the helper
- [ ] no MotionFrame schema change
- [ ] no dependencies unless separately approved
- [ ] fallback behavior preserved
- [ ] public stdout remains MotionFrame JSON only
- [ ] helper stdout / stderr remain private
- [ ] automated checks planned
- [ ] manual local validation plan documented

## Validation Gate Checklist

Mirrors the manual local validation checklist
([`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md)):

- [ ] validation performed only on a local developer machine
- [ ] no validation claimed from Codex / headless CI / cloud
- [ ] safe evidence only (no raw pixels / images / tensors / paths / secrets / private payloads)
- [ ] fallback uses only current MotionFrame fields (`tracking.status`, `tracking.confidence`)
- [ ] public stdout remains MotionFrame JSON only throughout

## Safety Boundaries Preserved

These boundaries are preserved and are not altered by this document:

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

## What This Document Does NOT Do

- Does not approve H2 implementation.
- Does not approve IPC implementation.
- Does not approve test implementation.
- Does not approve restart / backoff implementation.
- Does not approve real frame access.
- Does not approve raw frame / pixel / tensor IPC or high-rate raw frame transport.
- Does not approve helper-owned camera capture.
- Does not select or approve a production backend, model, or runtime.
- Does not add a dependency.
- Does not change the MotionFrame schema.
- Does not change Electron / Web Preview / Motion Protocol behavior.
- Does not record project-owner approval.
- Does not perform or claim manual local validation.

## Required Owner Decision Before Implementation

Any scoped H2 prototype implementation requires **explicit project-owner approval recorded in
a later PR**. This implementation-gate document does not grant that approval, select a
backend, or authorize any code, dependency, real frame access, or schema change. Until that
approval is recorded, the H2 phase remains design-only and no implementation may begin.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  — authoritative latest H2 phase status and the source gate checklists.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates, frame-ownership options, and open questions.
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — Native Core camera ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first H2 IPC direction (private parent-child pipe).
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
