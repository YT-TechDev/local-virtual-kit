# Tracking Helper Process H2 Local Runtime Validation Plan

## Status

Status: docs-only local runtime validation plan.
Scope: defines local/manual validation expectations needed before any future H2 production runtime implementation gate can be considered.

This document implements nothing. It follows the [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md) and the [H2 runtime integration owner decision](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md).

Local runtime validation is not yet complete. Production H2 integration remains unapproved.

## Why This Plan Exists

CI and headless checks can provide useful evidence for documentation formatting, native builds, protocol compatibility, and synthetic helper smoke behavior. They cannot prove local webcam behavior, OS camera permission behavior, Electron GUI behavior, OBS / browser-source behavior, hardware availability, or hardware-specific performance.

Local runtime validation must therefore remain separate from CI-safe validation. This plan defines what must be checked later on an appropriate local machine; it does not claim that those checks have already passed.

## Current Approved State

- H2 synthetic smoke is complete at the synthetic-smoke level.
- The H2 docs chain closeout review returned ready with notes.
- Production H2 implementation is not approved.
- Default `lvk-tracker-core` helper runtime wiring is not approved.
- No local/manual production runtime validation has been completed.
- No real frame access validation has been completed.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.

## Local Validation Categories

Future local validation must define and record evidence for these categories when they are in an explicitly approved scope:

- Native Core local launch behavior.
- Public stdout MotionFrame JSON behavior.
- Helper stdout / stderr privacy behavior.
- Camera / webcam permission behavior, if a future approved scope uses camera access.
- Electron launch and native process lifecycle behavior, if a future approved scope exposes runtime controls.
- OBS / browser-source compatibility, if affected.
- OS-specific process lifecycle behavior.
- Performance and responsiveness observations.
- Failure / fallback behavior.
- No hidden network behavior.

## Required Evidence For Each Local Check

Every future local/manual check must record:

- Command or manual procedure.
- Environment.
- OS.
- Hardware / camera availability, if relevant.
- Expected result.
- Actual result.
- Whether the check passed, failed, or was skipped.
- Reason for skipped checks.
- Whether any camera frames, logs, or diagnostics were produced.

## Privacy / Local-First Checks

Future local validation must confirm:

- Camera frames stay local.
- No cloud upload occurs.
- No external frame processing occurs.
- No telemetry or analytics involving frame data is added.
- No hidden network calls are added.
- Helper stdout and stderr remain private to Native Core.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- No raw frame / pixel / tensor IPC exists unless explicitly approved by a future scope.

## Public Stdout Validation Plan

Future evidence must prove:

- Public `lvk-tracker-core` stdout is MotionFrame JSON only.
- Diagnostics do not corrupt public stdout.
- Helper stdout and stderr do not leak to public stdout.
- Fallback uses existing MotionFrame fields.
- Malformed helper / private messages do not leak to public stdout.

## Local Runtime Validation Matrix

| Area                           | Environment required                                 | CI-safe?                       | Local/manual?                    | Evidence required                                | Current status                          |
| ------------------------------ | ---------------------------------------------------- | ------------------------------ | -------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Docs / format checks           | Repository checkout with Node tooling                | Yes                            | No                               | Exact command and result                         | Planned / run per PR as applicable      |
| Native build                   | Native toolchain and source checkout                 | Yes, if configured             | Optional local confirmation      | Command, toolchain, OS, result                   | Not run by this docs-only plan          |
| Synthetic helper smoke         | Synthetic helper and smoke executable                | Yes, if configured             | Optional local confirmation      | Command, case coverage, result                   | Complete at synthetic-smoke level       |
| Public stdout MotionFrame JSON | Runtime under test and stdout capture                | Partly, if checker exists      | Yes for production runtime claim | Command, captured output policy, result          | Not validated for production H2 runtime |
| Helper stdout / stderr privacy | Runtime under test with helper diagnostics           | Partly, if checker exists      | Yes for production runtime claim | Procedure, captured channels, result             | Not validated for production H2 runtime |
| Local camera permission        | Local machine with camera and OS permission UI       | No                             | Yes                              | OS, camera, permission state, result             | Not complete                            |
| Electron runtime UI            | Local GUI session with Electron app                  | No                             | Yes                              | Procedure, screenshots or notes, result          | Not complete                            |
| OBS / browser-source           | Local OBS or equivalent browser-source environment   | No                             | Yes                              | URL, source settings, observation, result        | Not complete                            |
| No hidden network behavior     | Runtime under test and network observation method    | Partly, if static checks exist | Yes for local runtime claim      | Procedure, observed connections, result          | Not complete                            |
| Failure / fallback behavior    | Runtime under test and approved failure trigger      | Partly, if synthetic           | Yes for local runtime claim      | Trigger, expected MotionFrame fallback, result   | Not complete for production runtime     |
| Performance observation        | Local hardware representative enough for observation | No                             | Yes                              | Hardware, workload, responsiveness notes, result | Not complete                            |

## Evidence Claim Rules

- Do not claim a local check passed unless it actually ran locally.
- Do not claim camera / webcam / Electron / OBS validation from Codex, headless CI, or any environment without the required hardware, permissions, GUI session, and application under test.
- Report skipped checks with reasons.
- Separate CI evidence from local/manual evidence.
- Avoid production readiness claims from docs-only PRs.

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
- Process lifecycle implementation.
- Electron / Web Preview / Motion Protocol changes.
- MotionFrame schema changes.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.

## Acceptance Criteria Before Any Implementation Gate

A future implementation gate may start only after:

- Owner explicitly approves implementation scope.
- Required local/manual checks are documented.
- CI-safe checks are documented.
- Skipped-check policy is documented.
- Privacy / local-first evidence expectations are documented.
- Public stdout validation is documented.
- Helper stdout / stderr privacy validation is documented.
- MotionFrame impact is documented.
- Local runtime limitations are documented.

## Recommended Next Step

Perform a read-only review of this local runtime validation plan. Then choose one narrow next planning direction before implementation:

- `electron-user-facing-scope-gate`
- `first-implementation-gate-draft`
- `local-runtime-manual-checklist`

Do not create those additional documents in this PR. Do not proceed directly to implementation yet.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [H2 runtime integration owner decision](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md)
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
