# Tracking Helper Process H2 Production Runtime Option B Decision

## Status

Status: docs-only owner decision selecting Option B after the H2 production-runtime owner-decision
record.
Scope: records that H2 may enter docs-only production-runtime planning only.

Option B approves docs-only production-runtime planning only. Implementation remains separately
gated. Default runtime wiring remains unapproved. Production readiness remains unclaimed. Runtime
behavior is unchanged by this document.

This document is not a production implementation, production-runtime design, implementation prompt,
or readiness claim.

## Owner Decision

Decision: Option B — Approve Docs-Only Production-Runtime Planning Only.

Meaning:

- H2 may enter docs-only production-runtime planning.
- Future PRs may propose source-grounded production-runtime planning documents.
- Future planning PRs must be source-grounded and must preserve local-first privacy constraints.
- These PRs must remain planning-only unless the owner separately approves implementation.

## What Option B Allows

Future docs-only planning PRs may propose source-grounded plans for:

- helper process supervisor production policy;
- fallback MotionFrame behavior;
- diagnostics / stdout / stderr safety policy;
- local/manual validation plan;
- production runtime scope and non-goals.

These planning candidates do not approve implementation or runtime behavior changes.

## What Option B Does Not Allow

Option B does not approve, implement, or imply approval for:

- production H2 integration;
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
- telemetry;
- analytics;
- cloud upload;
- external frame processing;
- hidden network calls;
- new network behavior;
- POSIX / local/manual / webcam / Electron / OBS runtime readiness claims.

## Required Planning Boundaries

Future planning PRs must:

- remain docs-only unless the owner separately approves implementation;
- preserve Native Core ownership of tracking, camera access, native performance boundaries, and
  low-level runtime concerns;
- preserve Electron ownership of desktop shell, settings, calibration UI, local config, and native
  process lifecycle;
- preserve Web Preview as a MotionFrame-only consumer;
- avoid adding backend runtime dependencies to Electron or Web Preview;
- preserve MotionFrame as the stable contract and avoid schema changes unless separately approved;
- preserve local-first privacy constraints, including no telemetry, analytics, cloud upload,
  external frame processing, hidden network calls, or new network behavior;
- state non-goals and validation expectations explicitly.

## Required Validation Before Any Readiness Claim

Production readiness remains unclaimed. Before any future POSIX, local/manual, webcam, Electron, OBS,
or production runtime readiness claim, a separately approved plan and implementation must define and
complete the required validation, including at minimum:

- CI-safe checks for any approved implementation surface;
- local/manual runtime checks with skipped checks reported honestly;
- public `lvk-tracker-core` stdout safety validation preserving MotionFrame JSON only;
- helper stdout / stderr privacy validation;
- local-first privacy validation confirming no telemetry, analytics, cloud upload, external frame
  processing, hidden network calls, or new network behavior;
- explicit evidence rules for POSIX, webcam, Electron, OBS, and manual runtime claims.

## Out of Scope

This document does not approve or implement production H2 integration, default runtime wiring,
production supervisor behavior, fallback MotionFrame behavior, diagnostics-safety policy behavior,
real camera access, raw frame transport, MotionFrame schema changes, Electron / Web Preview changes,
Motion Protocol changes, dependencies, telemetry, analytics, cloud upload, external frame processing,
hidden network calls, new network behavior, or readiness claims.

## Next Possible PRs

Possible next PRs are planning-only candidates, not implementation approvals:

1. H2 production-runtime scope and non-goals plan
2. H2 helper supervisor policy proposal
3. H2 fallback MotionFrame behavior proposal
4. H2 diagnostics / stdout / stderr safety planning
5. H2 local/manual validation plan

Each candidate must stay source-grounded, docs-only, and explicit that implementation remains
separately gated.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime owner decision record](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 standalone smoke vector phase closeout](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
