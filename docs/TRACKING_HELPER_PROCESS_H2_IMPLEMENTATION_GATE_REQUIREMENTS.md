# Tracking Helper Process H2 Implementation Gate Requirements

## Status

Status: docs-only H2 implementation gate requirements under Option B.
Scope: defines what must be true before any future H2 production-runtime implementation PR can be approved or started.

This is a docs-only implementation gate requirements document. This document does not approve implementation. Implementation remains separately gated. A future implementation PR requires a separate owner-approved implementation gate. Default runtime wiring remains unapproved. Production supervisor behavior remains unapproved. Fallback MotionFrame behavior and fallback emission remain unapproved. Production diagnostics-safety policy behavior remains unapproved. MotionFrame schema changes remain unapproved. Runtime behavior is unchanged by this document. Production readiness remains unclaimed. Future readiness claims require separately completed validation evidence.

## Purpose

This document turns the completed Option B production-runtime planning topics into reviewable gate requirements for a possible future implementation decision. It does not authorize code work, runtime wiring, production behavior, or readiness claims. Its purpose is to make the next owner decision explicit: whether to approve a narrow H2 implementation gate.

## Gate Requirement Summary

Before any future H2 implementation PR can be approved or started, a separate owner-approved implementation gate must define:

- exact implementation scope and non-goals;
- exact files, packages, commands, runtime surfaces, and public interfaces allowed to change;
- explicit owner approval for implementation, not only planning;
- Native Core ownership of helper runtime behavior, tracking, camera access, native performance boundaries, and low-level runtime concerns;
- Electron and Web Preview boundary preservation;
- MotionFrame compatibility and no schema change unless separately approved;
- default `lvk-tracker-core` runtime wiring status;
- production supervisor behavior status;
- fallback MotionFrame behavior and fallback emission status;
- diagnostics / stdout / stderr safety policy status;
- validation commands and evidence required before any readiness claim;
- skipped-check rules and local/manual claim limitations.

Listing these requirements does not approve any of those implementation surfaces.

## Required Owner Decision Before Implementation

A future implementation PR may start only after the owner records a separate implementation gate decision that explicitly answers:

- whether implementation is approved at all;
- the exact approved implementation slice;
- the exact excluded surfaces;
- whether the slice is still synthetic-only, Native Core-only, or otherwise bounded;
- whether default `lvk-tracker-core` runtime wiring remains excluded;
- whether production supervisor behavior remains excluded;
- whether fallback MotionFrame emission remains excluded;
- whether production diagnostics-safety policy behavior remains excluded;
- which validation evidence is required before merge and before any readiness claim.

Absent that owner decision, implementation remains unapproved.

## Required Implementation Scope Definition

The implementation gate must name the allowed change surface before code work starts. At minimum, it must specify:

- allowed files and packages;
- disallowed files and packages;
- allowed runtime entry points;
- whether any public command behavior may change;
- whether any build, CI, validation, or packaging command may change;
- whether any dependency may be added, removed, or upgraded;
- whether any generated artifacts or snapshots may change;
- the exact tests or docs that must accompany the slice.

If a surface is not listed as allowed by the owner-approved implementation gate, it must remain unchanged.

## Required Architecture Boundaries

A future implementation gate must preserve these architecture requirements:

- Native Core owns helper runtime behavior, tracking, camera access, native performance boundaries, and low-level runtime concerns.
- Electron owns desktop shell, settings, calibration UI, local config, and native process lifecycle.
- Web Preview consumes MotionFrame only.
- Electron and Web Preview must not gain backend runtime dependencies.
- Shared protocol packages own stable cross-boundary contracts.
- Public `lvk-tracker-core` stdout must remain MotionFrame JSON only unless a separate owner-approved protocol/runtime decision says otherwise.

Electron changes and Web Preview changes remain unapproved unless a future owner decision explicitly includes them.

## Required Privacy and Local-First Boundaries

A future implementation gate must preserve the local-first privacy requirements:

- Camera frames must stay local in v0.1.
- No telemetry is approved.
- No analytics is approved.
- No cloud upload is approved.
- No external frame processing is approved.
- No hidden network calls are approved.
- No new network behavior is approved.
- No helper-owned camera capture is approved.
- No raw frame / pixel / tensor IPC is approved.
- No high-rate raw frame transport is approved.

The implementation gate must include validation evidence requirements showing these boundaries remain true for the approved slice.

## Required MotionFrame Compatibility Boundaries

A future implementation gate must preserve MotionFrame as the stable Native Core to renderer contract:

- MotionFrame schema changes remain unapproved.
- No fallback-specific MotionFrame field, source value, tracking status, or schema version is approved by this document.
- Any future schema change requires separate owner approval, Motion Protocol documentation, producer updates, consumer updates, and compatibility tests in the same approved scope.
- Fallback behavior, if ever separately approved, must be represented using the approved MotionFrame contract and must not require Web Preview to know helper-runtime details.

## Required Diagnostics / Stdout / Stderr Safety Boundaries

A future implementation gate must define diagnostics safety requirements before approving code work:

- public `lvk-tracker-core` stdout remains MotionFrame JSON only;
- helper stdout and helper stderr remain private to Native Core;
- diagnostics must not corrupt public MotionFrame stdout;
- any approved diagnostic capture must be bounded by explicit size, count, and rate limits;
- unsafe diagnostics categories must be classified without exposing sensitive content;
- privacy-safe local summaries, if approved at all, must be local-only;
- production diagnostics-safety policy behavior remains unapproved unless the owner-approved implementation gate explicitly includes it.

No production diagnostics-safety policy engine is approved by this document.

## Required Validation Evidence Before Readiness Claims

Future readiness claims require separately completed validation evidence. A future implementation gate must define the required commands, procedures, environments, expected results, actual results, and skipped-check rules before any readiness claim is allowed.

Required evidence categories include:

- CI-safe checks for the exact approved implementation surface;
- public `lvk-tracker-core` stdout safety validation preserving MotionFrame JSON only;
- helper stdout / stderr privacy validation;
- MotionFrame schema compatibility validation;
- privacy validation confirming no telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior;
- local/manual runtime checks only when actually run on suitable hardware, permissions, GUI session, operating system, and application under test;
- explicit skipped-check reasons;
- clear separation between CI evidence and local/manual evidence.

Documentation-only planning does not complete this validation. POSIX, local/manual, webcam, Electron, OBS, and production runtime readiness claims remain unclaimed.

## Required PR Constraints

A future implementation PR must:

- cite the owner-approved implementation gate;
- stay within the exact approved scope;
- keep unrelated files unchanged;
- include tests or checks required by the gate;
- report skipped checks honestly with reasons;
- avoid readiness claims unless required evidence was completed;
- avoid source, protocol, Electron, Web Preview, dependency, network, telemetry, analytics, cloud, or frame-transport changes unless explicitly approved in the gate;
- preserve runtime behavior outside the approved slice.

## Non-Goals

This PR and document do not approve, implement, or imply approval for:

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
- POSIX / local/manual / webcam / Electron / OBS runtime readiness claims.

## Decisions Still Deferred

The following decisions remain deferred to a future owner-approved implementation gate or later owner decision:

- whether to approve any implementation slice;
- which exact files, packages, and runtime surfaces may change;
- whether default runtime wiring can ever be approved;
- whether production supervisor behavior can ever be approved;
- whether fallback MotionFrame behavior or fallback emission can ever be approved;
- whether a production diagnostics-safety policy engine can ever be approved;
- whether any real control channel, forced termination, restart / backoff, backend, model, runtime, camera, frame transport, Electron, or Web Preview work can ever be approved;
- what validation evidence is sufficient for future readiness claims.

## Recommended Next Step

Recommended next step: owner decision on whether to approve a narrow H2 implementation gate. Until that owner decision is recorded, implementation remains unapproved.

This is only a decision point, not an implementation approval. Do not begin implementation from this document.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime Option B decision](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
- [H2 production-runtime scope and non-goals plan](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 fallback MotionFrame behavior proposal](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Development policy](DEVELOPMENT_POLICY.md)
