# Tracking Helper Process H2 First Implementation Gate Draft

## Status

Status: docs-only first implementation gate draft.
Scope: drafts the approval boundary, candidate scope, exclusions, validation expectations, and owner-approval requirements for a possible future first H2 implementation gate.

This document implements nothing. It follows the H2 post-gate documentation chain closeout review result of **ready with notes**.

This draft does not approve implementation. Production H2 integration and default `lvk-tracker-core` runtime wiring remain unapproved.

## Why This Draft Exists

The H2 documentation chain is coherent enough to draft the first implementation gate after the post-gate closeout review found no blocking issues and returned ready with notes.

Drafting a gate is not the same as approving implementation. This document records what a future first implementation gate would need to satisfy before any code changes begin.

The first implementation, if separately approved later, must be extremely narrow, reviewable, and local-first. It must preserve Native Core ownership, MotionFrame-only public output, helper-private diagnostics, and the current non-approval boundaries.

This draft exists to prevent scope creep before any code changes. It keeps the candidate boundary visible while preserving the requirement for explicit owner approval before implementation.

## Current Approved State

- H2 synthetic smoke phase is complete at the synthetic-smoke level.
- The H2 docs chain closeout review returned ready with notes.
- Production H2 implementation is not approved.
- Default `lvk-tracker-core` helper runtime wiring is not approved.
- No backend, runtime, model, or dependency selection is approved.
- No real frame access is approved.
- No Electron or user-facing implementation is approved.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.

## Candidate First Implementation Boundary

This section describes only a candidate boundary. It does not approve implementation.

The candidate first implementation, if separately approved later, should be limited to the smallest safe Native Core-owned step. It should prove one reviewable boundary without expanding runtime, UI, protocol, dependency, or production readiness claims.

The candidate must:

- remain default-off or otherwise non-default;
- avoid real camera frames;
- avoid helper-owned camera capture;
- avoid backend, model, or runtime selection;
- avoid dependency additions;
- avoid Electron or Web Preview changes;
- avoid MotionFrame schema changes;
- preserve public `lvk-tracker-core` stdout as MotionFrame JSON only;
- preserve helper stdout and stderr as private to Native Core;
- preserve local-first and privacy boundaries.

This draft intentionally does not define exact source files to edit. Any future file scope must be explicitly approved with the implementation gate.

## Explicitly Out of Scope For The First Implementation Gate Draft

- Production H2 integration.
- Default runtime wiring.
- Feature flag implementation.
- Electron UI.
- Settings, calibration, or status controls.
- Backend, model, or runtime implementation.
- Dependency additions.
- Model or task bundling.
- Automatic downloads.
- Real frame access.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- Production process lifecycle implementation.
- Real stop / control channel.
- Production forced termination.
- Restart / backoff.
- MotionFrame schema changes.
- Web Preview or Motion Protocol changes.
- Telemetry, analytics, cloud upload, hidden network calls, or new network behavior.
- Cloud inference or external frame processing.

## Required Owner Approval Before Implementation

A future implementation PR may start only after the owner explicitly approves:

- implementation scope;
- default-off or non-default runtime behavior;
- fallback behavior;
- validation commands;
- local/manual validation limitations;
- source and test areas to touch;
- out-of-scope items;
- merge and readiness criteria.

Without that explicit approval, this draft remains planning only.

## Required Validation For The Future Implementation Gate

A future implementation gate must define expected validation categories before code changes begin:

- CI-safe checks.
- Native build or targeted native smoke checks if source changes are made.
- Public stdout MotionFrame JSON safety.
- Helper stdout and stderr privacy.
- Documentation update consistency.
- Local/manual checks only if explicitly run in an appropriate environment.
- Skipped-check reporting with reasons.

This PR adds no validation scripts and no CI jobs.

## Future PR Shape

A future implementation PR should be shaped as follows:

- Use the smallest useful change.
- Implement one boundary at a time.
- Avoid unrelated refactors.
- Avoid dependency additions unless separately approved.
- Avoid MotionFrame changes unless separately approved.
- Include docs and tests if behavior changes.
- Report exact commands and results.
- Report skipped checks with reasons.

The future PR must not claim production readiness unless that readiness has been separately approved and validated.

## Recommended Next Step

Perform a read-only review of this first implementation gate draft.

After that review, the owner should choose one explicit decision:

- keep planning;
- revise the gate;
- approve a narrowly scoped first implementation prompt.

Do not create implementation prompts in this PR. Do not proceed directly to implementation until the owner explicitly approves it.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 runtime integration owner decision](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md)
- [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
- [H2 Electron / user-facing scope gate](TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 process lifecycle scope gate](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
- [H2 helper backend / runtime decision](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md)
- [H2 frame / data-flow decision](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
- [H2 post-synthetic next-scope gate](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
- [H2 synthetic smoke phase handoff](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
- [Local runtime checklist](LOCAL_RUNTIME_CHECKLIST.md)
- [Development policy](DEVELOPMENT_POLICY.md)
- [Tracking spec](TRACKING_SPEC.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Architecture](ARCHITECTURE.md)
