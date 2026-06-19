# Tracking Helper Process H2 Production Runtime Scope Gate

## Status

Status: docs-only production runtime scope gate.
Scope: documents the approval boundary and required decisions before any production H2 runtime
integration or default `lvk-tracker-core` runtime wiring work can begin.

This document implements nothing. It follows the H2 frame / data-flow decision, helper backend /
runtime decision, and process lifecycle scope gate. Production H2 integration remains unapproved.
Default `lvk-tracker-core` runtime wiring remains unapproved. No backend, runtime, model, or
dependency choice is approved. No Electron, Web Preview, or Motion Protocol changes are approved.

## Why This Gate Exists

Completing the H2 synthetic smoke phase does not imply production readiness. The synthetic smoke
phase validates bounded synthetic helper-process behavior, but it does not decide how H2 should run
in the real product.

Production runtime integration crosses several boundaries at once:

- Native Core runtime behavior.
- Helper process lifecycle.
- Backend / runtime dependencies.
- Data-flow and privacy.
- Safe fallback behavior.
- Public `lvk-tracker-core` stdout safety.
- User-facing enablement and status.

This gate prevents jumping directly from docs / smoke coverage into runtime wiring. LVK's
local-first and privacy requirements remain product requirements: camera frames must stay local in
v0.1, Native Core remains the approved camera owner, helper-owned camera capture remains unapproved,
and no new cloud, telemetry, analytics, external frame processing, hidden network calls, or network
behavior is approved here.

## Current Approved State

- H2 synthetic smoke phase is complete at the synthetic-smoke level.
- The post-synthetic next-scope gate has been added.
- The frame / data-flow decision has been added.
- The helper backend / runtime decision has been added.
- The process lifecycle scope gate has been added.
- No production H2 integration exists.
- No default `lvk-tracker-core` runtime wiring exists.
- No real frame access exists.
- No helper-owned camera capture exists.
- No backend, runtime, model, or dependency selection exists.
- No production process lifecycle policy exists.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.

## Required Decisions Before Production Runtime Work

The following decision areas must be settled before any production runtime work begins. This gate
records the required decision areas but does not answer them.

- Runtime integration model: whether H2 is opt-in, behind an experimental flag, default-off, or
  eligible for future default behavior.
- Runtime selection and fallback: how H2 is selected, disabled, and safely falls back without
  corrupting public MotionFrame output.
- Backend / runtime / model: what backend is allowed and how dependencies, models, or task bundles
  are packaged.
- Frame / data-flow: what data crosses process or package boundaries, if any, while preserving local
  camera-frame ownership and privacy boundaries.
- Process lifecycle: startup, ready, health, shutdown, stop / control, timeout, termination, and
  restart / backoff policy.
- Public protocol: MotionFrame compatibility and no schema change unless a separate scope gate
  explicitly approves one.
- Electron / user-facing scope: settings, calibration, status, warnings, or runtime controls if any
  user-facing exposure is needed.
- Validation: local / manual checks, CI-safe checks, public stdout safety, helper stdout / stderr
  privacy, and local-first privacy checks.

## Explicitly Out of Scope

- Production H2 integration implementation.
- Default runtime wiring.
- Feature flag implementation.
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
- Electron / Web Preview / Motion Protocol changes.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior.
- Cloud inference or external frame processing.

## Acceptance Criteria Before Production Runtime Implementation

A future implementation gate may start only after all of the following are true:

- The product owner explicitly approves production runtime scope.
- Runtime integration model is documented.
- Backend / runtime / model / dependency choice is documented.
- Frame / data-flow impact is documented.
- Process lifecycle policy is documented.
- Fallback behavior is documented.
- Public stdout safety validation is documented.
- Helper stdout / stderr privacy is documented.
- MotionFrame impact is documented.
- Electron / user-facing impact is documented or explicitly rejected.
- Local / manual validation requirements are documented.
- CI-safe checks are documented.
- Local-first / privacy boundaries remain intact.
- No cloud or network behavior is introduced unless explicitly approved.

## Recommended Next Step

Perform a read-only review of this production runtime scope gate. Then choose one narrow planning
direction before implementation:

- `validation-scope-gate`
- `electron-user-facing-scope-gate`
- `runtime-integration-owner-decision`

Do not create those additional documents in this PR. Do not proceed directly to implementation from
this document.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 post-synthetic next-scope gate](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
- [H2 frame / data-flow decision](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
- [H2 helper backend / runtime decision](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md)
- [H2 process lifecycle scope gate](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
- [H2 synthetic smoke phase handoff](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
- [Tracking spec](TRACKING_SPEC.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Architecture](ARCHITECTURE.md)
- [Tech stack](TECH_STACK.md)
- [Local runtime checklist](LOCAL_RUNTIME_CHECKLIST.md)
- [Development policy](DEVELOPMENT_POLICY.md)
