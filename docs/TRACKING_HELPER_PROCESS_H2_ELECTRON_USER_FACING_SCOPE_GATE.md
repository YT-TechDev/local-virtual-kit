# Tracking Helper Process H2 Electron User-Facing Scope Gate

## Status

Status: docs-only Electron / user-facing scope gate.
Scope: defines decisions and acceptance criteria required before exposing H2 behavior in the desktop shell, settings, calibration, status, local config, or user controls.

This document implements nothing. It follows the [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md) and the [H2 runtime integration owner decision](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md).

Electron UI and user-facing H2 controls are not approved. Production H2 integration and default `lvk-tracker-core` runtime wiring remain unapproved.

## Why This Gate Exists

Exposing H2 to users creates product expectations. A visible desktop control, status label, calibration entry, settings panel, diagnostic view, or enable / disable toggle can imply that H2 is supported, production-ready, locally validated, or safe to rely on.

User-facing controls and status must therefore not imply production readiness before the runtime, validation, fallback, privacy, and product boundaries are explicitly approved.

Electron owns the desktop shell, settings, calibration UI, local configuration, and native process lifecycle only within separately approved scopes. Electron does not own tracking behavior or camera frames.

Any future H2 UI must preserve LVK's local-first and privacy boundaries. It must not create telemetry, analytics, cloud upload, external frame processing, hidden network calls, new network behavior, raw frame exposure, or helper-private diagnostic leaks.

## Current Approved State

- No production H2 implementation exists.
- No default `lvk-tracker-core` runtime wiring exists.
- No Electron UI for H2 exists.
- No H2 settings, calibration, status, diagnostic, or user controls are approved.
- No backend, runtime, model, task-bundle, or dependency selection is approved.
- No real frame access is approved.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.

## Required Future User-Facing Decisions

A future Electron / user-facing implementation gate must answer these questions before implementation begins:

- Whether H2 is visible to users at all.
- Whether H2 is hidden behind a developer, experimental, or otherwise non-default mode.
- Whether H2 has settings, status, diagnostics, calibration, enable / disable controls, or any other user-facing controls.
- What user-facing labels, warnings, and descriptions avoid implying production readiness.
- How failure and fallback states are represented to users without exposing implementation-private details.
- Whether any local runtime validation results or local/manual evidence status must be shown.
- Whether Electron needs any local config changes.
- Whether Electron needs any native process lifecycle controls.
- How helper-private diagnostics are kept out of direct user-facing surfaces unless separately scoped and sanitized.
- How public MotionFrame-only output is preserved.

This gate records decision areas only. It does not answer them.

## Electron Boundary Rules

- Electron may own shell, settings, calibration UI, local config, and native process lifecycle only when separately approved.
- Electron must not own tracking.
- Electron must not own camera capture.
- Electron must not receive raw camera frames.
- Electron must not gain backend runtime dependencies.
- Electron must not bypass Native Core ownership.
- Electron must not expose helper stdout or stderr directly to users unless separately scoped and sanitized.

## Explicitly Out of Scope

- Electron UI implementation.
- Feature flag implementation.
- H2 settings implementation.
- H2 calibration UI implementation.
- Runtime status UI implementation.
- Local config changes.
- Native process lifecycle implementation.
- Production H2 integration.
- Default runtime wiring.
- Backend, model, or runtime selection.
- Real frame access.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- MotionFrame schema changes.
- Web Preview or Motion Protocol changes.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.

## Acceptance Criteria Before User-Facing Implementation

A future implementation gate may start only after all of the following are documented:

- The owner explicitly approves the Electron / user-facing scope.
- Runtime integration status is documented.
- Local runtime validation expectations are documented.
- User-facing labels and warnings are documented.
- Settings, status, diagnostics, calibration, config, and control behavior are documented.
- Failure and fallback user-facing behavior is documented.
- Privacy and local-first boundaries are documented.
- Electron boundary impact is documented.
- MotionFrame impact is documented.
- Telemetry and network behavior remain absent unless separately approved.

## Recommended Next Step

Perform a read-only review of this Electron / user-facing scope gate.

After that review, choose one narrow next planning direction before implementation:

- `first-implementation-gate-draft`
- `local-runtime-manual-checklist`
- `h2-docs-post-gate-closeout`

Do not create those additional docs in this PR. Do not proceed directly to implementation yet.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
- [H2 runtime integration owner decision](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 process lifecycle scope gate](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
- [H2 helper backend / runtime decision](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md)
- [H2 frame / data-flow decision](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
- [Architecture](ARCHITECTURE.md)
- [Local runtime checklist](LOCAL_RUNTIME_CHECKLIST.md)
- [Development policy](DEVELOPMENT_POLICY.md)
- [Tracking spec](TRACKING_SPEC.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
