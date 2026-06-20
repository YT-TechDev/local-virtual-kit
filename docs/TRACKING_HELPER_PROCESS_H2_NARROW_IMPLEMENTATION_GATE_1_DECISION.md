# Tracking Helper Process H2 Narrow Implementation Gate 1 Decision

## Status

Status: owner decision approving the first narrow H2 implementation gate after the Option B docs-only planning chain.
Scope: documentation-only decision record for a future narrow implementation PR.

This document does not implement anything. Runtime behavior outside the approved synthetic-only implementation slice remains unchanged.

## Owner Decision

Decision: Approve H2 Narrow Implementation Gate 1 — Synthetic-only helper output safety hardening.

This owner decision approves only H2 Narrow Implementation Gate 1: Synthetic-only helper output safety hardening. This decision authorizes a future narrow implementation PR only within the approved scope.

## Approved Narrow Implementation Gate

The approved gate is deliberately small and limited to a source-grounded, synthetic-only Native Core helper supervision safety hardening slice.

This gate follows the Option B docs-only planning chain and is the first approved narrow implementation gate after the H2 production-runtime planning documents. It does not approve broad H2 implementation, production H2 integration, or default `lvk-tracker-core` runtime wiring.

## Approved Implementation Scope

A future implementation PR may cover only a narrow synthetic-only Native Core helper supervision safety hardening slice.

Approved planning intent for that future implementation PR:

- strengthen synthetic helper output safety handling;
- keep helper stdout and stderr private to Native Core;
- prevent helper diagnostics from corrupting public `lvk-tracker-core` stdout;
- add or improve CI-safe synthetic smoke coverage for malformed, oversized, high-volume, or unsafe helper output, only if source-grounded and within existing synthetic helper / smoke boundaries;
- keep child output capture bounded, local, and private;
- preserve the current MotionFrame schema;
- preserve local-first privacy boundaries;
- keep the implementation small and reviewable.

## Allowed Future Implementation Surfaces

The future implementation PR may touch only source-grounded Native Core synthetic helper supervision and smoke surfaces, such as:

- existing helper process supervisor source / header files, including `native/tracker-core/src/helper_process_supervisor.cpp` and `native/tracker-core/src/helper_process_supervisor.h`;
- existing helper process supervision smoke files, including `native/tracker-core/src/helper_process_supervision_smoke.cpp`;
- existing synthetic helper / smoke fixture files if required for CI-safe synthetic cases, including `native/tracker-core/src/synthetic_helper_main.cpp`, `native/tracker-core/src/helper_h2_state_machine_smoke.cpp`, `native/tracker-core/src/helper_runtime_smoke.cpp`, and `native/tracker-core/src/helper_runtime_smoke.h`;
- minimal build / test configuration only if required to wire the synthetic smoke check;
- directly relevant docs updates for the implemented slice.

If a future implementation agent names additional files, those files must exist and must be directly required by the approved synthetic-only implementation slice.

## Required Implementation Boundaries

The future implementation PR must preserve these boundaries:

- Default runtime wiring remains unapproved.
- Production supervisor behavior remains unapproved.
- Fallback MotionFrame behavior and fallback emission remain unapproved.
- Production diagnostics-safety policy behavior remains unapproved.
- MotionFrame schema changes remain unapproved.
- Electron and Web Preview changes remain unapproved.
- Public `lvk-tracker-core` stdout must remain MotionFrame JSON only.
- Helper stdout and helper stderr must remain private to Native Core.
- Child output capture must remain bounded, local, and private.
- Camera frames must stay local in v0.1.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior may be added.
- Runtime behavior outside the approved synthetic-only implementation slice remains unchanged.
- Production readiness remains unclaimed.

## Required Validation Before Merge

The future implementation PR must report exact commands and results.

At minimum, it must run relevant CI-safe checks such as:

- formatting / diff checks available in the repo;
- relevant native build checks if available;
- relevant synthetic helper supervision smoke checks if available;
- any newly added or modified synthetic smoke checks.

Do not require local / manual webcam, Electron GUI, OBS, OS camera permission, or production runtime validation for this first gate.

CI-safe synthetic checks can support the narrow implementation claim. They do not prove production readiness. They do not prove local / manual readiness. They do not prove webcam, Electron, or OBS readiness.

## Required Reporting From Implementation Agent

The future implementation agent must report:

- the branch used;
- the files changed;
- the exact implementation slice completed;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that the change stayed docs / Native Core synthetic-only as applicable;
- confirmation that no production implementation, default runtime wiring, production supervisor behavior, production diagnostics-safety policy engine, fallback MotionFrame emission, readiness claim, MotionFrame schema change, Electron / Web Preview behavior, dependencies, telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior was added.

## Explicitly Unapproved Items

This owner decision does not approve, implement, or imply approval for:

- production H2 integration;
- default `lvk-tracker-core` runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- production fail-closed fallback MotionFrame emission;
- any fallback MotionFrame emission;
- real parent-to-child control channel;
- production forced termination;
- restart / backoff;
- backend / model / runtime selection;
- real camera access;
- helper-owned camera capture;
- raw frame / pixel / tensor IPC;
- high-rate raw frame transport;
- MotionFrame schema changes;
- Electron changes;
- Web Preview changes;
- Motion Protocol changes;
- new dependencies;
- telemetry;
- analytics;
- cloud upload;
- external frame processing;
- hidden network calls;
- new network behavior;
- POSIX / local / manual / webcam / Electron / OBS runtime readiness claims;
- production readiness claims.

## Readiness Claim Policy

Production readiness remains unclaimed. Future readiness claims require separately completed validation evidence.

The approved first gate can produce only a narrow implementation claim for source-grounded synthetic helper output safety hardening if the future implementation PR completes and reports its required CI-safe validation. It cannot claim production readiness, local / manual readiness, webcam readiness, Electron readiness, OBS readiness, or broad H2 runtime readiness.

## Recommended Next Step

Create a Claude Code implementation prompt for H2 Narrow Implementation Gate 1: Synthetic-only helper output safety hardening.

The next implementation work should be a narrow implementation PR, preferably handled by Claude Code, and must stay within this owner-approved gate.

## Cross-references

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime Option B decision](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
- [H2 production-runtime scope and non-goals plan](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 fallback MotionFrame behavior proposal](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Development policy](DEVELOPMENT_POLICY.md)
