# Tracking Helper Process H2 Helper Backend Runtime Decision

## Status

Status: H2 docs-only helper backend / runtime decision document.
Scope: documentation-only decision boundary after the H2 post-synthetic next-scope gate and frame /
data-flow decision.

This document implements nothing. It follows the post-synthetic next-scope gate and the frame /
data-flow decision, and records only what must remain undecided until a separately approved production
H2 backend / runtime scope exists.

This document does **not** select a production helper backend. It does **not** approve any model or
task bundle. It does **not** approve any runtime dependency. It does **not** approve production H2
integration or default `lvk-tracker-core` runtime wiring.

## Decision Summary

Current decision:

- H2 synthetic smoke is complete at the synthetic-smoke level, but production helper backend selection
  remains unapproved.
- No production backend / runtime / model choice has been made.
- No dependency addition is approved.
- No automatic model download is approved.
- No cloud inference or external frame processing is approved.
- Any future backend must preserve local-first operation.
- Any future backend must respect the frame / data-flow decision.
- Native Core remains the only approved camera owner.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.

## Why This Decision Exists

Backend, runtime, and model choices affect privacy, install size, dependency risk, platform support,
validation requirements, and user trust. A production helper backend could introduce native runtime
packages, model files, task bundles, platform-specific binaries, or operational behavior that users
must be able to understand before LVK depends on it.

The H2 synthetic smoke phase did not choose a production backend. It validated bounded synthetic
helper-supervision behavior only, with private helper output and no production runtime wiring.

Selecting a backend before data-flow and validation boundaries are clear could accidentally violate
LVK's local-first requirements. It could also create implicit frame transport, helper-owned camera
capture, raw frame / pixel / tensor IPC, public stdout changes, or unreviewed model and dependency
behavior.

This document prevents accidental dependency or runtime creep by keeping backend selection, model /
task bundling, runtime packaging, and default runtime wiring behind explicit future approval.

## Candidate Backend Categories

These are categories only. This document does not select any category.

### Native C++ helper backend

Questions before approval:

- What dependencies does it require?
- Does it need model files?
- Does it need camera frames, landmarks, or lower-rate semantic inputs?
- Does it preserve local-only processing?
- How is it enabled / disabled?
- How does it fail safely?
- How is public stdout protected?

### Local library backend linked into Native Core

Questions before approval:

- What dependencies does it require?
- Does it need model files?
- Does it need camera frames, landmarks, or lower-rate semantic inputs?
- Does it preserve local-only processing?
- How is it enabled / disabled?
- How does it fail safely?
- How is public stdout protected?

### Local external helper process

Questions before approval:

- What dependencies does it require?
- Does it need model files?
- Does it need camera frames, landmarks, or lower-rate semantic inputs?
- Does it preserve local-only processing?
- How is it enabled / disabled?
- How does it fail safely?
- How is public stdout protected?

### Optional local model / runtime backend

Questions before approval:

- What dependencies does it require?
- Does it need model files?
- Does it need camera frames, landmarks, or lower-rate semantic inputs?
- Does it preserve local-only processing?
- How is it enabled / disabled?
- How does it fail safely?
- How is public stdout protected?

### Mock / synthetic backend for tests

Questions before approval:

- What dependencies does it require?
- Does it need model files?
- Does it need camera frames, landmarks, or lower-rate semantic inputs?
- Does it preserve local-only processing?
- How is it enabled / disabled?
- How does it fail safely?
- How is public stdout protected?

### Explicitly rejected for v0.1 unless separately approved: cloud inference / external frame processing

Questions before any separate approval:

- What dependencies does it require?
- Does it need model files?
- Does it need camera frames, landmarks, or lower-rate semantic inputs?
- Does it preserve local-only processing?
- How is it enabled / disabled?
- How does it fail safely?
- How is public stdout protected?

## Required Future Decisions

The following decisions are required before any implementation begins:

- Backend selection.
- Runtime packaging.
- Model / task bundling.
- Dependency approval.
- Platform support.
- Local validation strategy.
- User-facing enable / disable model.
- Failure / fallback behavior.
- Public stdout safety.
- Helper stdout / stderr privacy.
- Compatibility with the frame / data-flow decision.

## Explicitly Out of Scope

- Adding MediaPipe, Python, ONNX Runtime, or any other runtime dependency.
- Adding model files.
- Downloading model / task bundles.
- Production H2 integration.
- Default `lvk-tracker-core` runtime wiring.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- High-rate frame transport.
- MotionFrame schema changes.
- Electron / Web Preview / Motion Protocol changes.
- Production shutdown / control semantics.
- Restart / backoff.
- Telemetry / analytics / cloud upload / network behavior.
- Cloud inference or external frame processing.

## Acceptance Criteria Before Backend Runtime Implementation

A future implementation gate may start only after:

- the product owner explicitly approves the backend / runtime scope;
- the selected backend category is documented;
- dependency additions are explicitly approved or rejected;
- model / task bundling is explicitly approved or rejected;
- the local-only processing boundary is documented;
- frame / data-flow impact is documented;
- public stdout safety validation is documented;
- helper stdout / stderr privacy is documented;
- fallback behavior is documented;
- local / manual validation requirements are documented;
- no cloud / network behavior is introduced unless explicitly approved.

## Relationship To Other H2 Decisions

- This document does not approve frame transport; it depends on the frame / data-flow decision.
- This document does not approve process lifecycle or shutdown / control semantics.
- This document does not approve Electron UI.
- This document does not approve MotionFrame changes.
- Runtime integration and process lifecycle must remain separate future gates.

## Recommended Next Step

First, perform a read-only review of this decision.

Then choose one narrow next planning direction before any implementation:

- `production-runtime-scope-gate`
- `process-lifecycle-scope-gate`
- `validation-scope-gate`

Do not create those additional documents in this PR. Do not proceed directly to implementation.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
  — post-synthetic next-scope gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
  — frame / data-flow decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
  — handoff for the completed H2 synthetic smoke phase.
- H2 native helper contract: no current document exists in `docs/` with this title.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — design-only pipe framing contract.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — Native helper prototype implementation gate.
- [`docs/TRACKING_BACKEND_EVALUATION.md`](TRACKING_BACKEND_EVALUATION.md)
  — tracking backend evaluation.
- [`docs/TECH_STACK.md`](TECH_STACK.md) — dependency and package-layout reference.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation claim
  rules.
