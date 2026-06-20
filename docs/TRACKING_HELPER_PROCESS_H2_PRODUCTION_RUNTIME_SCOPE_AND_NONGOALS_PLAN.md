# Tracking Helper Process H2 Production Runtime Scope and Non-Goals Plan

## Status

Status: docs-only H2 production-runtime scope and non-goals plan under Option B.
Scope: defines what future production-runtime planning may cover, what remains out of scope, and what
evidence is required before any future implementation or readiness claim.

This is a planning-only scope and non-goals document. Option B allows docs-only production-runtime
planning only. Implementation remains separately gated. Default runtime wiring remains unapproved.
Production readiness remains unclaimed. Runtime behavior is unchanged by this document.

## Purpose

This document is the first Option B production-runtime planning document. It establishes the allowed
planning boundary for future H2 production-runtime documents without approving production H2
integration, default `lvk-tracker-core` runtime wiring, production supervisor behavior, fallback
MotionFrame behavior, runtime behavior changes, or readiness claims.

Future implementation requires a separate owner-approved implementation gate. Future readiness claims
require separately completed validation evidence.

## Planning Scope Allowed by Option B

Option B permits source-grounded documentation planning only. Future docs-only planning may cover:

- helper process supervisor production policy;
- fallback MotionFrame behavior;
- diagnostics / stdout / stderr safety policy;
- local/manual validation plan;
- production runtime scope and non-goals;
- production runtime evidence and claim rules;
- future implementation gate requirements.

These are planning topics only. Listing a topic here does not approve implementation, default runtime
wiring, production behavior, runtime behavior changes, or readiness claims.

## Production-Runtime Planning Surfaces

Future planning documents may describe proposed boundaries, questions, risks, and required evidence
for these surfaces:

- Native Core ownership of tracking, camera access, native performance boundaries, and low-level
  runtime concerns.
- Electron ownership of desktop shell, settings, calibration UI, local config, and native process
  lifecycle, without adding backend runtime dependencies in Electron.
- Web Preview consumption of MotionFrame only, without backend runtime dependencies.
- Public `lvk-tracker-core` stdout safety, preserving MotionFrame JSON only.
- Helper stdout / stderr privacy, preserving private routing to Native Core.
- MotionFrame compatibility, preserving MotionFrame as the stable Native Core to renderer contract.
- Local-first privacy requirements, including camera frames staying local in v0.1.

## Non-Goals

This PR and document do not approve, implement, or imply approval for:

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

## Decisions Deferred to Later Planning PRs

Later docs-only planning PRs must decide, before any implementation gate can be considered:

- which production supervisor policy is proposed, including startup, health, shutdown, timeout,
  termination, and restart boundaries;
- whether fallback MotionFrame behavior should be proposed, and how it would preserve existing
  MotionFrame compatibility;
- how diagnostics, helper stdout, and helper stderr would remain safe and private without corrupting
  public MotionFrame stdout;
- what local/manual validation evidence is required for webcam, POSIX, Electron, OBS, and runtime
  claims;
- which implementation gate requirements must be met before any code change can begin.

These decisions remain planning-only until a future owner-approved implementation gate exists.

## Required Validation Before Implementation or Readiness Claims

Before any future implementation or readiness claim, a separate plan must require evidence for:

- CI-safe checks relevant to the approved implementation surface;
- local/manual checks only when they actually run on suitable hardware, permissions, GUI session, and
  application under test;
- public `lvk-tracker-core` stdout remaining MotionFrame JSON only;
- helper stdout and stderr remaining private to Native Core;
- MotionFrame schema compatibility;
- no telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior;
- skipped-check reporting with explicit reasons;
- owner approval for the exact implementation or readiness scope being claimed.

Documentation-only planning does not complete this validation.

## Required Privacy / Architecture Boundaries

Future planning must preserve these boundaries:

- Camera frames must stay local in v0.1.
- Native Core owns tracking, camera access, native performance boundaries, and low-level runtime
  concerns.
- Electron owns desktop shell, settings, calibration UI, local config, and native process lifecycle.
- Web Preview consumes MotionFrame only.
- Electron / Web Preview must not gain backend runtime dependencies.
- MotionFrame remains the stable contract and must not be changed casually.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior is approved.

## Next Possible Planning PRs

The next planning candidates are docs-only candidates, not implementation approvals:

1. H2 helper supervisor policy proposal.
2. H2 fallback MotionFrame behavior proposal.
3. H2 diagnostics / stdout / stderr safety planning.
4. H2 local/manual validation plan.
5. H2 implementation gate requirements.

Recommended next planning PR: H2 helper supervisor policy proposal, limited to documentation and
explicitly preserving that production supervisor behavior remains unapproved.

## Out of Scope

This document is not an implementation prompt, production design approval, readiness report,
validation-completion report, dependency decision, backend decision, runtime selection, Electron plan,
Web Preview plan, or Motion Protocol change. It changes no source code, runtime behavior, network
behavior, MotionFrame schema, Electron behavior, Web Preview behavior, dependencies, telemetry,
analytics, cloud upload, or external frame processing.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime Option B decision](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
- [H2 production-runtime owner decision record](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [H2 standalone smoke vector phase closeout](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md)
