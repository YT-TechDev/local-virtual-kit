# Tracking Helper Process H2 Foundation Gate 1 Decision

## Status

Status: docs-only owner decision for H2 Foundation Implementation Gate 1.
Scope: source-grounded foundation inventory and runtime boundary map only.

This document does not implement runtime behavior. It does not change C++ runtime behavior, checker
behavior, MotionFrame, Motion Protocol, Electron, Web Preview, dependencies, networking, telemetry,
analytics, cloud upload, external frame processing, hidden network calls, or any production H2
integration surface.

## Decision

The H2 foundation implementation planning decision selected the next step as drafting the first
narrow H2 foundation implementation gate. This document records that first gate as:

**H2 Foundation Gate 1: Source-grounded foundation inventory and runtime boundary map.**

Foundation Gate 1 is a documentation-only gate. Its purpose is to prepare the codebase for the first
actual foundation implementation slice by mapping current source surfaces, runtime boundaries, helper
smoke surfaces, public stream contracts, and excluded production surfaces. The gate must identify the
smallest safe foundation implementation slice for a future PR, but it must not implement that slice.

## Closed Narrow Gate State Preserved

H2 Narrow Implementation Gates 1 through 7 remain closed at the synthetic/smoke checker level and are
not reopened by this decision.

Those gates remain evidence for the existing synthetic/smoke checker surface only. Foundation Gate 1
must not reinterpret them as production runtime approval, default helper runtime wiring approval,
production supervisor approval, diagnostics-safety policy approval, fallback MotionFrame emission
approval, or readiness evidence.

## Required Foundation Gate 1 Output

The future Foundation Gate 1 inventory/map must be source-grounded and must cover all of the
following surfaces:

- current Native Core entry points relevant to helper runtime smoke;
- the default runtime path and why it remains unchanged;
- the explicit `--helper-runtime-smoke` path and why it remains smoke-only;
- the public `lvk-tracker-core` stdout/stderr boundary;
- the helper stdout/stderr private boundary;
- MotionFrame and Motion Protocol boundaries;
- the Electron / Web Preview untouched boundary;
- current checker evidence from H2 Narrow Implementation Gates 1 through 7;
- surfaces that remain explicitly out of scope.

The inventory/map must recommend one smallest possible future implementation slice. That
recommendation must remain a recommendation only; it must not implement runtime behavior, approve
runtime behavior, or grant production readiness.

## Required Future Implementation Gate

Any actual foundation implementation after the Foundation Gate 1 inventory/map still requires another
owner-approved implementation gate. That later gate must explicitly define the exact allowed files,
excluded files, runtime surfaces, validation evidence, skipped-check rules, and non-goals before any
implementation PR may begin.

Absent that later owner-approved implementation gate, foundation implementation remains unapproved.

## Explicit Non-Goals

This decision does not approve, implement, or imply approval for:

- production H2 integration;
- default helper runtime wiring;
- default `lvk-tracker-core` H2 runtime wiring;
- production supervisor behavior;
- diagnostics-safety policy engine behavior;
- fallback MotionFrame emission;
- fallback MotionFrame behavior;
- MotionFrame schema changes;
- Motion Protocol changes;
- Electron changes;
- Web Preview changes;
- dependency changes;
- telemetry;
- analytics;
- cloud upload;
- external frame processing;
- hidden network calls;
- new network behavior;
- camera access changes;
- helper-owned camera capture;
- raw frame / pixel / tensor IPC;
- high-rate raw frame transport;
- real parent-to-child control channel;
- production forced termination;
- restart / backoff;
- backend / model / runtime selection;
- local/manual readiness claims;
- webcam readiness claims;
- OBS readiness claims;
- Electron readiness claims;
- production readiness claims;
- foundation implementation.

## Validation Scope

Validation for this PR is limited to lightweight documentation checks. Heavy native builds, runtime
checks, GUI checks, webcam checks, Electron checks, OBS checks, and production runtime checks are not
required for this docs-only decision and must not be reported as passed unless actually run.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 foundation implementation planning decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_PLANNING_DECISION.md)
- [H2 helper runtime zero-frame guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
