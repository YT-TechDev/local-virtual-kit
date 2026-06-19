# Tracking Helper Process H2 Runtime Integration Owner Decision

## Status

Status: docs-only owner decision.
Scope: records the owner decision after the H2 validation scope gate and before any production H2 runtime implementation gate.

This document implements nothing. It follows the H2 validation scope gate. Production H2 runtime implementation is not approved. Default `lvk-tracker-core` helper runtime wiring is not approved.

## Owner Decision

Decision: do not start production H2 runtime implementation yet.

H2 remains behind planning and review gates. Synthetic smoke completion does not imply production readiness. The post-synthetic planning gates have been added, but production runtime implementation is still not approved, default `lvk-tracker-core` runtime wiring is still not approved, and the next step remains planning / review rather than implementation.

This owner decision approves none of the following:

- Backend, runtime, model, or dependency selection.
- Production process lifecycle policy.
- Feature flag implementation.
- Electron UI.
- MotionFrame schema change.
- Real frame access.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.

Any future implementation gate requires explicit owner approval after the required decisions and validation expectations are documented.

## Rationale

H2 has crossed from synthetic smoke into production planning scope. The H2 synthetic smoke phase is complete, and several post-synthetic decision gates now exist, including frame / data-flow, helper backend / runtime, process lifecycle, production runtime, and validation scope gates. These gates do not equal implementation approval.

Production runtime integration touches Native Core runtime behavior, process lifecycle, data flow, backend / runtime dependencies, validation evidence, and possibly user-facing controls. It also affects public `lvk-tracker-core` stdout safety and helper stdout / stderr privacy.

LVK's local-first and privacy constraints require explicit owner approval before implementation. Camera frames must stay local in v0.1, Native Core remains the only approved camera owner, helper-owned camera capture remains unapproved, raw frame / pixel / tensor IPC remains unapproved, and no telemetry, cloud upload, external frame processing, hidden network calls, or new network behavior is approved here.

## Conditions Required Before Any Implementation Gate

A future implementation gate may be opened only after all of the following are documented and explicitly reviewed:

- Owner approval for the implementation scope.
- Runtime integration model.
- Backend / runtime / model / dependency choice.
- Frame / data-flow impact.
- Process lifecycle policy.
- Validation expectations.
- Fallback behavior.
- Public stdout safety validation.
- Helper stdout / stderr privacy.
- Local / manual validation limits.
- MotionFrame impact.
- Electron / user-facing impact, or an explicit rejection of user-facing impact.
- Confirmation that local-first / privacy boundaries remain intact.

## Current Approved Work

Only planning and review work is approved:

- Read-only review of this owner decision.
- Docs-only refinement if inconsistencies are found.
- A future local-runtime validation plan.
- A future Electron / user-facing scope gate.
- A future narrowly scoped implementation gate only after explicit owner approval.

## Explicitly Not Approved

This owner decision does not approve:

- Production H2 implementation.
- Default runtime wiring.
- Feature flag implementation.
- Backend / model / runtime implementation.
- Dependency additions.
- Model / task bundling.
- Automatic downloads.
- Real frame access.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- Production process lifecycle implementation.
- Real stop / control channel.
- Production forced termination.
- Restart / backoff.
- MotionFrame schema changes.
- Electron / Web Preview / Motion Protocol changes.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.
- Cloud inference / external frame processing.

## Recommended Next Step

Perform a read-only review of this owner decision. Then choose one narrow planning direction before implementation:

- `local-runtime-validation-plan`
- `electron-user-facing-scope-gate`
- `first-implementation-gate-draft`

Do not create those additional documents in this PR. Do not proceed directly to implementation from this document.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
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
