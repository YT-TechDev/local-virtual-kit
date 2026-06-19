# Tracking Helper Process H2 Validation Scope Gate

## Status

Status: docs-only validation scope gate.
Scope: defines the validation, evidence, CI-safe, local/manual, privacy, and public stdout boundaries
required before any production H2 runtime integration or implementation work can begin.

This document implements nothing. It follows the H2 production runtime scope gate. No production H2
runtime validation is approved as complete.

This document does not approve production H2 integration, default runtime wiring, backend / runtime /
model selection, process lifecycle behavior, Electron UI, MotionFrame changes, telemetry, cloud upload,
external processing, hidden network calls, or new network behavior.

## Why This Gate Exists

Production H2 work cannot be accepted only by documentation or synthetic smoke results. The H2
synthetic smoke phase is useful evidence for bounded synthetic helper-process behavior, but it does
not prove production runtime behavior, real camera-frame handling, local hardware behavior, Electron
GUI behavior, OS permission behavior, or product readiness.

Validation claims must be split between CI-safe / headless checks and local / manual hardware checks.
Codex, headless CI, and other non-local environments must not claim webcam, OpenCV, hardware,
Electron GUI, OBS, or OS camera permission behavior unless those checks actually ran in an environment
with the required hardware, permissions, GUI session, and application under test.

Public stdout safety and local-first / privacy boundaries also need explicit validation evidence before
any production H2 runtime work. In particular, public `lvk-tracker-core` stdout must remain
MotionFrame JSON only, helper stdout / stderr must remain private to Native Core, and camera frames
must stay local in v0.1.

## Current Approved Validation State

- H2 synthetic smoke coverage exists at the synthetic-smoke level.
- CI and Native CI can validate docs, build, and smoke-style checks when those checks are configured.
- Existing local/manual claim rules remain in [Local runtime checklist](LOCAL_RUNTIME_CHECKLIST.md) and
  [Development policy](DEVELOPMENT_POLICY.md).
- No production runtime validation exists yet.
- No real frame access validation exists yet.
- No helper-owned camera capture validation exists, because helper-owned camera capture remains
  unapproved.
- No default runtime wiring validation exists, because default runtime wiring remains unapproved.

## CI-Safe Validation Categories

Future work may consider the following categories CI-safe if they are implemented and can run in a
headless environment. This PR does not add any checks, scripts, jobs, or command changes.

- Docs link / format checks.
- TypeScript / package checks.
- Native build checks.
- Dependency-free synthetic helper checks.
- Process supervision smoke using a synthetic helper.
- Public stdout MotionFrame JSON checker.
- Helper stdout / stderr privacy checks.
- No-network / static guard checks, if available.
- MotionFrame schema compatibility checks.

## Local / Manual Validation Categories

The following checks require local/manual evidence and must not be claimed from Codex or headless CI
unless they actually ran in a suitable environment:

- Webcam / camera permission behavior.
- OpenCV or OS camera access.
- Electron app launch and UI behavior.
- OBS / browser-source behavior.
- Hardware / performance observation.
- Actual local runtime with real camera frames.
- OS-specific process lifecycle behavior.
- User-facing settings / calibration behavior, if ever added.

## Privacy / Local-First Validation Requirements

Future validation evidence must preserve and explicitly report the following boundaries:

- Camera frames stay local.
- No cloud upload occurs.
- No external frame processing occurs.
- No telemetry or analytics involving frame data is added.
- No hidden network calls are added.
- Helper stdout and stderr remain private to Native Core.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Raw frame / pixel / tensor IPC remains absent unless explicitly approved by a separate future scope
  decision.
- Default runtime behavior remains unchanged unless explicitly approved by a separate future scope
  decision.

## Public Stdout Safety Validation

Future production H2 validation must answer these questions before public runtime behavior is claimed:

- How do we prove public `lvk-tracker-core` stdout is only MotionFrame JSON?
- How do helper stdout and stderr stay private to Native Core?
- How are diagnostics routed safely without corrupting public stdout?
- How are malformed helper messages prevented from leaking to public stdout?
- How is fallback represented using existing MotionFrame fields?

## Evidence Claim Rules

- Do not claim a check passed unless the exact command or check was run.
- Do not claim local/manual validation from Codex, headless CI, or another non-local environment unless
  the check actually ran there with the required hardware, permissions, GUI session, and application
  under test.
- Report skipped checks with reasons.
- Distinguish CI evidence from local/manual evidence.
- Include command names, environment limits, and results in PR bodies.
- Avoid claiming production readiness from documentation-only PRs.

## Explicitly Out of Scope

- Adding validation scripts.
- Adding CI jobs.
- Changing build or test commands.
- Production H2 integration.
- Default runtime wiring.
- Feature flag implementation.
- Backend / model / runtime selection.
- Real frame access.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- Production process lifecycle implementation.
- Electron / Web Preview / Motion Protocol changes.
- MotionFrame schema changes.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior.

## Acceptance Criteria Before Production Runtime Implementation

A future implementation gate may start only after validation expectations are documented for:

- CI-safe checks.
- Local/manual checks.
- Public stdout safety.
- Helper stdout / stderr privacy.
- Local-first / privacy behavior.
- Runtime fallback behavior.
- MotionFrame compatibility.
- Environment-specific limitations.
- Skipped-check reporting.
- Owner-approved scope.

## Recommended Next Step

Perform a read-only review of this validation scope gate. Then choose one narrow planning direction
before implementation:

- `runtime-integration-owner-decision`
- `electron-user-facing-scope-gate`
- `local-runtime-validation-plan`

Do not create those additional documents in this PR. Do not proceed directly to implementation from
this document.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
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
