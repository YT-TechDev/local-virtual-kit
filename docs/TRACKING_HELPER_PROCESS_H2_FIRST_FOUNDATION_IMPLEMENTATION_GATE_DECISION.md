# Tracking Helper Process H2 First Foundation Implementation Gate Decision

## Status

Status: docs-only owner decision for the first narrow H2 foundation implementation gate.
Scope: approves only a future implementation gate document for one explicit-smoke-only foundation
boundary assertion slice. This PR does not implement the slice.

This document changes no source code, checker behavior, C++ runtime behavior, MotionFrame schema,
Motion Protocol package, Electron surface, Web Preview surface, dependency, network behavior,
telemetry, analytics, cloud upload, external frame processing, hidden network call, new network
behavior, default runtime wiring, production supervisor behavior, production diagnostics-safety
policy behavior, fallback MotionFrame emission, readiness claim, or foundation behavior.

## Owner Decision

H2 Narrow Implementation Gates 1 through 7 remain closed at the synthetic/smoke checker level and
are not reopened by this decision.

H2 Foundation Gate 1 is complete. Its source-grounded inventory/map recorded the current Native Core
default-runtime and explicit `--helper-runtime-smoke` boundaries, public/private stdout/stderr
contracts, MotionFrame / Motion Protocol and Electron / Web Preview exclusions, and the smallest
recommended future foundation implementation slice.

The selected first narrow foundation implementation gate is:

**H2 Foundation Implementation Gate 1: explicit-smoke-only foundation boundary assertion.**

This decision approves only that future implementation gate. It does not approve implementation in
this PR. The future implementation PR may begin only after this gate decision is reviewed and merged,
and it must remain inside the exact scope recorded here.

## Future Implementation Slice

The future implementation slice is limited to a Native Core-only, explicit-smoke-only foundation
boundary assertion with CI-safe checker/gate evidence.

The slice must be:

- **Native Core-only**;
- **explicit-smoke-only**;
- limited to CI-safe checker/gate evidence;
- invoked only through a new or existing explicit `--helper-runtime-smoke` foundation boundary mode;
- isolated from production/default runtime wiring;
- isolated from Electron and Web Preview;
- isolated from MotionFrame and Motion Protocol changes;
- isolated from dependency, network, telemetry, analytics, cloud upload, external frame processing,
  hidden network call, new network behavior, and camera behavior changes.

The slice must not change default runtime behavior when `--helper-runtime-smoke` is omitted.

## Required Allowed-File Definition Before Editing

The future implementation PR must define exact allowed files before editing. Suggested allowed areas
may include only:

- `tools/check-helper-runtime-integration.mjs`;
- `native/tracker-core/src/helper_runtime_smoke.cpp`;
- `native/tracker-core/src/main.cpp` only if an explicit smoke-only argument registration is
  unavoidable;
- docs closeout/index files.

If a file or surface is not explicitly allowed by the future implementation PR's owner-reviewed
scope, it must remain unchanged.

## Required Excluded Files and Surfaces

The future implementation PR must exclude:

- Electron app files;
- Web Preview files;
- `packages/motion-protocol` schema/type files;
- production runtime wiring;
- camera source behavior;
- default tracker runtime path;
- production supervisor logic;
- production diagnostics-safety policy engine;
- fallback MotionFrame emission;
- dependency manifests unless explicitly re-approved by the owner.

## Required Boundary Preservation

The future implementation must preserve:

- helper stdout/stderr as a private Native Core boundary;
- public stdout/stderr safety boundaries;
- default runtime path behavior when `--helper-runtime-smoke` is omitted;
- H2 Narrow Implementation Gates 1 through 7 checker evidence.

The future implementation must not reinterpret Gates 1 through 7 as production runtime approval,
default helper runtime wiring approval, production supervisor approval, diagnostics-safety policy
approval, fallback MotionFrame approval, or readiness evidence.

## Required Validation Evidence

The future implementation PR must report exact validation results for:

- `git diff --check`;
- `pnpm format:check`;
- `node --check tools/check-helper-runtime-integration.mjs`;
- the full integration checker only if native binaries are available.

Skipped native/runtime checks must be reported honestly with reasons. Heavy native builds, runtime
checks, GUI checks, webcam checks, Electron checks, OBS checks, and production runtime checks are not
required by this gate unless a future owner-approved implementation scope explicitly requires them.

## Readiness Claims Remain Unapproved

Readiness claims remain unapproved. This decision does not approve local/manual readiness claims,
webcam readiness claims, OBS readiness claims, Electron readiness claims, production readiness
claims, or H2 foundation readiness claims.

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
- readiness claims;
- foundation implementation in this PR.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 Foundation Gate 1 inventory/map](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_INVENTORY_MAP.md)
- [H2 Foundation Gate 1 decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_DECISION.md)
- [H2 foundation implementation planning decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_PLANNING_DECISION.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
