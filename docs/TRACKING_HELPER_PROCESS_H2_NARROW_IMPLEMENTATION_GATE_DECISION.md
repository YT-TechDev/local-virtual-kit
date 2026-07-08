# Tracking Helper Process H2 Narrow Implementation Gate Decision

## Status

Status: docs-only owner decision for issue #407.
Scope: records the project owner's Option B decision to approve only a narrow future H2
implementation gate for a small, reviewable Native Core helper-runtime slice.

This document implements nothing. It does not change source code, runtime behavior, MotionFrame,
Motion Protocol, Electron, Web Preview, dependencies, telemetry, network behavior, or readiness
claims. The future implementation must be separately executed in a later PR and must stay within the
exact gate recorded here.

## Recorded Owner Decision

For issue #407, the project owner selected **Option B: Approve a narrow H2 implementation gate for a
small, reviewable Native Core helper-runtime slice**.

This decision approves only a narrow future implementation gate. It does not approve broad production
H2 integration, default `lvk-tracker-core` runtime wiring, production readiness, or any runtime
behavior in this PR.

## Approved Future Gate

The approved future gate may allow one small, reviewable Native Core-only helper-runtime
implementation slice in a later PR. That later PR must:

- cite this decision record;
- define the exact files, commands, runtime surfaces, and validation evidence it changes;
- remain Native Core-only unless the owner explicitly expands the gate later;
- be CI-safe and synthetic-helper-oriented for the first slice;
- avoid default `lvk-tracker-core` production runtime wiring unless explicitly approved later;
- preserve public `lvk-tracker-core` stdout as MotionFrame JSON only;
- keep helper stdout and helper stderr private to Native Core;
- preserve MotionFrame schema compatibility;
- preserve the Electron and Web Preview boundaries;
- report skipped local/manual checks with exact reasons;
- avoid production readiness claims.

If a future implementation surface is not explicitly allowed by the later implementation PR's scoped
gate, it remains excluded.

## Constraints Preserved By This Gate

The future narrow implementation gate must preserve these constraints:

- Native Core-only unless explicitly expanded later.
- CI-safe / synthetic-helper-oriented first slice.
- No default `lvk-tracker-core` production runtime wiring unless explicitly approved later.
- No real camera access.
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No MotionFrame schema changes.
- No Electron changes.
- No Web Preview changes.
- No Motion Protocol changes.
- No new dependencies.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior.
- No POSIX / local/manual / webcam / Electron / OBS runtime readiness claims.

## Still Out of Scope

This PR and decision record do not approve, implement, or imply approval for:

- production H2 integration;
- runtime implementation in this PR;
- source code changes;
- default `lvk-tracker-core` runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- production fail-closed fallback MotionFrame emission;
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
- telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior;
- production readiness claims.

## Production Readiness

Production readiness is not claimed. Future readiness claims require separately completed validation
evidence for the exact approved implementation surface, including CI-safe checks, privacy boundaries,
public stdout safety, helper stdout / stderr privacy, MotionFrame compatibility, and explicit skipped
local/manual check reasons.

## Recommended Next Step

After this docs-only decision merges, the next task may be a separately reviewed implementation prompt
for the approved narrow Native Core helper-runtime slice. That prompt must keep the implementation
small, source-grounded, CI-safe, synthetic-helper-oriented, and within the constraints above.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 production-runtime owner decision record](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md)
- [H2 production-runtime scope and non-goals plan](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 fallback MotionFrame behavior proposal](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
