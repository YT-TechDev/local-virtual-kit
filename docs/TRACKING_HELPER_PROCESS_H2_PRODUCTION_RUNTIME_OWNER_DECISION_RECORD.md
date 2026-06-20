# Tracking Helper Process H2 Production Runtime Owner Decision Record

## Status

Status: docs-only owner-decision record / decision request after the H2 production-runtime planning
gate.
Scope: records the pending owner decision about whether LVK should enter H2 production-runtime
planning.

This document does not choose an option, approve production-runtime planning, approve production
implementation, approve default runtime wiring, or claim production readiness.

## Purpose

The H2 standalone synthetic-smoke vector phase is closed, and the production-runtime planning gate is
now the active boundary. This record makes the required owner decision explicit without entering
production-runtime planning.

Only the project owner can choose whether H2 remains blocked, moves into docs-only
production-runtime planning, or is deferred.

## Current Default Decision State

Until the owner explicitly records a decision elsewhere:

- production-runtime planning is not approved;
- production implementation is not approved;
- default `lvk-tracker-core` runtime wiring is not approved;
- production helper process supervisor behavior is not approved;
- production fail-closed fallback MotionFrame behavior is not approved;
- all production behavior remains gated.

## Decision Required from Owner

The owner must explicitly choose one of the decision options below before any H2
production-runtime planning starts. This document is only the decision record / request; it does not
select an option.

## Decision Options

### Option A: Keep Production-Runtime Planning Blocked

Meaning:

- No production-runtime planning starts yet.
- Only docs-only decision clarification remains allowed.
- No implementation is approved.

### Option B: Approve Docs-Only Production-Runtime Planning Only

Meaning:

- Future PRs may propose production-runtime plans.
- Future PRs may include source-grounded planning docs for supervisor policy, fallback MotionFrame
  behavior, and local/manual validation.
- Implementation remains separately gated and is still not approved.
- Default runtime wiring is still not approved.
- Production readiness is still not claimed.

### Option C: Defer H2 Production-Runtime Planning

Meaning:

- H2 production-runtime planning is intentionally deferred.
- Future H2 work should remain limited to maintenance, docs clarification, or explicitly approved
  non-production work.
- No implementation is approved.

## What Each Option Would Allow

- Option A would allow only additional docs-only decision clarification that does not enter
  production-runtime planning.
- Option B would be allowed only if the owner explicitly chooses it; it would allow planning-only,
  source-grounded production-runtime documents while keeping implementation, default runtime wiring,
  readiness claims, and production behavior separately gated.
- Option C would preserve H2 production-runtime planning as deferred work and limit future H2 changes
  to maintenance, docs clarification, or explicitly approved non-production work.

## What Remains Forbidden

Unless and until the owner records a later explicit approval, this document does not approve or imply
approval for:

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
- telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior;
- POSIX / local/manual / webcam / Electron / OBS runtime readiness claims.

## Required Validation Before Any Readiness Claim

Production readiness must not be claimed unless a future owner-approved plan first defines and a
future approved implementation completes the required validation. That validation must include, at
minimum:

- CI-safe checks for any approved implementation surface;
- local/manual runtime checks with skipped checks reported honestly;
- public `lvk-tracker-core` stdout safety validation preserving MotionFrame JSON only;
- helper stdout / stderr privacy validation;
- local-first privacy validation confirming no telemetry, analytics, cloud upload, external frame
  processing, hidden network calls, or new network behavior;
- explicit evidence rules for POSIX, webcam, Electron, OBS, and manual runtime claims.

## Out of Scope

This document is not a production-runtime plan, implementation prompt, supervisor policy, fallback
MotionFrame policy, backend / runtime selection, validation-completion report, readiness claim, or
owner approval for implementation. It changes no source code, runtime behavior, MotionFrame schema,
dependencies, Electron behavior, Web Preview behavior, camera access, IPC behavior, telemetry,
analytics, cloud upload, external frame processing, hidden network calls, or network behavior.

## Next Possible PRs

Before the owner chooses an option, the next possible PRs remain limited to docs-only decision
clarification that does not enter production-runtime planning.

If the owner explicitly chooses Option B, future PRs may propose docs-only, source-grounded
production-runtime planning documents. Implementation remains separately gated.

If the owner chooses Option A or Option C, future H2 work remains limited by that decision.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 standalone smoke vector phase closeout](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md)
- [H2 owner-decision gate](TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
