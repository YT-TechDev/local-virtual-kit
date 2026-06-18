# Tracking Helper Process H2 Design Readiness Review

## Status

Status: H2 design-doc phase closeout / readiness review memo.
Scope: documentation-only design closeout.
This is not an implementation plan.
This document does not approve H2 implementation, IPC implementation, test implementation,
restart / backoff implementation, real frame access, raw frame / pixel / tensor IPC, high-rate
raw frame transport, production backend selection, or H3 production integration, and it performs
no manual local validation.

This memo reviews the completed H2 design-doc phase and states whether the design is ready for
a possible future scoped prototype. Any scoped H2 prototype implementation requires explicit
project-owner approval in a later PR; this memo does not grant it.

## Summary

- The H2 design-doc phase is complete: design preparation, ownership decision, IPC decision,
  pipe framing contract, handshake / state machine, state-machine test vectors, and manual
  local validation checklist are all merged.
- This memo summarizes those artifacts, states what is and is not ready, reaffirms the safety
  boundaries, and defines the implementation and validation gates that must be satisfied before
  any code is written.
- This is a **design closeout / readiness review only**. Nothing is implemented and nothing is
  approved for implementation here.

## Scope

- Reviews the H2 **design artifacts and gates** only.
- Excludes implementation, tests, manual validation runs, backend selection, and any MotionFrame
  schema change.

## Design Artifacts Reviewed

| Artifact                      | PR   | What it established                                                            |
| ----------------------------- | ---- | ------------------------------------------------------------------------------ |
| H2 design preparation         | #132 | Gates, frame-ownership options, and open questions for any real frame access.  |
| H2 ownership decision         | #133 | Prefer Native Core camera ownership; helper-owned camera capture not approved. |
| H2 IPC decision               | #134 | First IPC direction = a Native Core-owned private parent-child pipe.           |
| H2 pipe framing contract      | #135 | UTF-8 newline-delimited JSON framing, channel roles, bounds, safe diagnostics. |
| H2 handshake / state machine  | #136 | Startup / liveness / shutdown states, transitions, and fail-closed fallback.   |
| H2 state-machine test vectors | #137 | Automated-check goals and representative design-only test vectors.             |
| H2 manual local validation    | #138 | Manual local validation checklist and safe-evidence / claim rules.             |

## Decisions Captured

- Native Core remains the camera owner; the helper never opens the camera directly.
- The first IPC direction to evaluate is a Native Core-owned **private parent-child pipe**.
- The pipe carries compact newline-delimited JSON with defined channel roles and safe
  diagnostics.
- The helper lifecycle is modeled as a startup / liveness / shutdown **state machine** with
  fail-closed fallback.
- Automated-check goals and representative test vectors are defined for that state machine.
- Manual local validation claim rules are defined (local-only; safe evidence only).

## Safety Boundaries Preserved

- **Native Core remains the only camera owner** and the **only public MotionFrame producer**.
- **Helper stdout remains private** to Native Core; **helper stderr is safe diagnostics only**.
- **`lvk-tracker-core` public stdout remains MotionFrame JSON only.**
- **Temporary files for frame transport remain rejected.**
- **Loopback sockets remain non-default** new local network behavior.
- **Shared memory / mmap remains deferred.**
- **Electron and Web Preview remain unaware of helper IPC.**
- **MotionFrame schema remains unchanged**, and `packages/motion-protocol` must **not** gain
  helper runtime dependencies.

## What Is Ready

- Design documents now define the preferred **ownership** direction.
- Design documents now define the first **IPC** direction to evaluate.
- Design documents now define **framing rules, channel roles, and safe diagnostics**.
- Design documents now define **startup / liveness / shutdown** state behavior.
- Design documents now define representative **automated-check goals and test vectors**.
- Design documents now define future **manual local validation** claim rules.

## What Is Not Ready

- No H2 prototype is implemented.
- No IPC implementation is available.
- No tests are implemented.
- No manual local validation has been performed.
- No real frame access is approved.
- No production backend is selected.
- No dependency / model / runtime packaging is approved.
- No restart / backoff implementation is approved.

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

## Required Owner Decision Before Implementation

Any scoped H2 prototype implementation requires **explicit project-owner approval recorded in a
later PR**. This readiness review does not grant that approval, select a backend, or authorize
any code, dependency, real frame access, or schema change.

## Implementation Gate Checklist

Before any scoped H2 prototype implementation PR:

- [ ] explicit project-owner approval recorded
- [ ] exact implementation scope documented
- [ ] expected changed files listed
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

Mirrors the manual local validation checklist (`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md`):

- [ ] validation performed only on a local developer machine
- [ ] no validation claimed from Codex / headless CI / cloud
- [ ] safe evidence only (no raw pixels / images / tensors / paths / secrets / private payloads)
- [ ] fallback uses only current MotionFrame fields (`tracking.status`, `tracking.confidence`)
- [ ] public stdout remains MotionFrame JSON only throughout

## Risks and Open Questions

- The IPC framing and bounds are designed but **not yet implementation-validated**.
- **Platform-specific IPC security** must still be proven at implementation time.
- **Restart / backoff** remains design-only and is not implemented.
- **Real backend selection** remains open and is an H3 concern, not resolved here.
- There is **no runtime or performance evidence** yet; the design assumes a synthetic helper.

## Recommended Next Step

- **Option A:** a helper prototype cleanup / docs maintenance PR (safe cleanup only).
- **Option B:** only if the project owner explicitly approves, prepare a separate **scoped H2
  prototype implementation-gate prompt** that documents exact scope, changed files, and the
  gates above.
- **Do not implement H2 in this PR.**

For an H2 docs navigation / status index, see
[`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md).

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates and open questions.
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
- [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
  — H1 synthetic-prototype closeout review.
- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design and phase boundaries (H0–H3).
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation claim
  rules and reporting template.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
