# Tracking Helper Process H2 Foundation Implementation Gate 2 Decision

## Status

Status: docs-only owner decision for the next narrow H2 foundation implementation gate proposal.
Scope: records the owner-approved future gate boundary for H2 Foundation Implementation Gate 2; this
PR does not implement the gate.

This document follows Option B from the post Foundation Gate 1 boundary assertion owner decision:
draft the next narrow foundation implementation gate. It approves only the future gate boundary, not
implementation. Actual implementation requires a later implementation PR reviewed against this gate.

This document changes no source code, checker behavior, C++ runtime behavior, MotionFrame schema,
Motion Protocol package, Electron surface, Web Preview surface, dependency, network behavior,
telemetry, analytics, cloud upload, external frame processing, hidden network call, new network
behavior, camera behavior, default runtime wiring, production supervisor behavior,
diagnostics-safety policy engine behavior, fallback MotionFrame emission, readiness claim, or
production behavior.

## Owner Decision

The selected next gate is:

**H2 Foundation Implementation Gate 2: next narrow foundation implementation gate proposal.**

This decision records the boundary that a future implementation PR must satisfy. It does not approve
or perform implementation in this PR. The future implementation PR must define exact allowed files
before editing and must be reviewed against this gate before any source-changing work proceeds.

## Preserved Gate State

This decision does not reopen any completed gate or closeout.

- H2 Narrow Implementation Gates 1 through 7 remain **closed** at the synthetic/smoke checker level.
- H2 Foundation Gate 1 inventory/map remains **closed**.
- H2 Foundation Implementation Gate 1 boundary assertion closeout remains **closed**.
- The post Foundation Gate 1 boundary assertion owner decision remains **closed**.

All prior production/default/runtime/protocol/Electron/Web Preview/dependency/network/camera and
readiness non-goals remain preserved.

## Gate 2 Boundary Requirements

A future Gate 2 implementation slice must remain the smallest useful source-grounded slice. It must
preserve default runtime behavior when `--helper-runtime-smoke` is omitted and must preserve the
public/private stream boundaries recorded by the prior gates.

The next implementation slice is bounded as follows unless a later owner decision separately approves
an expansion:

- Native Core/checker bounded.
- Explicit-smoke-only.
- No production/default runtime wiring.
- No Electron or Web Preview changes.
- No MotionFrame or Motion Protocol changes.
- No dependency changes.
- No network behavior changes.
- No camera behavior changes.
- No readiness claims.
- No production supervisor behavior.
- No diagnostics-safety policy engine behavior.
- No fallback MotionFrame emission unless separately approved by a later owner decision.

## Future Implementation PR Requirements

The future implementation PR must include, before editing or as part of its owner-reviewed scope:

- exact allowed files;
- excluded files and surfaces;
- an explanation of why the slice is the smallest useful next implementation;
- a statement of whether the slice is checker-only or source-changing;
- if C++ is required, a justification for why checker/docs-only work is insufficient;
- if `native/tracker-core/src/main.cpp` is required, a justification for why explicit smoke-only
  argument registration cannot be avoided;
- exact validation results;
- honest reporting for skipped checks and the reason each check was skipped.

If a file or surface is not explicitly allowed by the future implementation PR's owner-reviewed
scope, it must remain unchanged.

## Candidate Direction

The recommended next implementation candidate should remain conservative and explicit-smoke-only.
Prefer a Native Core/checker-bounded slice that improves evidence quality or prepares one narrow
helper-runtime foundation boundary.

This decision does not lock in production H2 integration, default helper runtime wiring, production
supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission, or
readiness. If the future implementation candidate cannot be justified from current source, the
implementation worker must stop and propose a smaller gate rather than inventing behavior.

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
- implementation in this PR.

## Validation Requirements for the Future Implementation PR

The future implementation PR must report exact results for all checks it runs. At minimum, it must
run lightweight docs/checker checks appropriate to its scope unless the environment prevents them:

- `git diff --check`;
- `pnpm format:check`;
- checker syntax or targeted checker validation if checker files change;
- any additional source-grounded validation required by the exact future allowed-file scope.

Skipped native/runtime, GUI, webcam, OpenCV, OBS, Electron, or production runtime checks must be
reported honestly and must not be claimed as passed.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 post Foundation Gate 1 boundary assertion decision](TRACKING_HELPER_PROCESS_H2_POST_FOUNDATION_GATE_1_BOUNDARY_ASSERTION_DECISION.md)
- [H2 Foundation Gate 1 boundary assertion closeout](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_BOUNDARY_ASSERTION_CLOSEOUT.md)
- [H2 first foundation implementation gate decision](TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md)
- [H2 Foundation Gate 1 inventory/map](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_INVENTORY_MAP.md)
