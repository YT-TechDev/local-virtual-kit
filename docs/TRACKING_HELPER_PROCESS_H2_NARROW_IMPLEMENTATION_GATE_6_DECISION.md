# Tracking Helper Process H2 Narrow Implementation Gate 6 Decision

## Status

Status: docs-only owner decision for H2 Narrow Implementation Gate 6.
Scope: records the owner's post-Gate-5 Option B choice and approves only drafting a future narrow
synthetic/smoke-only checker implementation gate for review.

This document does not implement runtime behavior. It does not change C++ runtime behavior,
MotionFrame, Motion Protocol, Electron, Web Preview, dependencies, network behavior, or readiness
claims.

## Owner Decision

The owner selected Option B from the post-Gate-5 owner decision boundary: approve drafting a future
narrow implementation gate document for review.

This decision approves only H2 Narrow Implementation Gate 6 as a future narrow synthetic/smoke-only
checker implementation proposal. It does not approve production H2 integration, default helper
runtime wiring, production supervisor behavior, diagnostics-safety policy engine behavior, fallback
MotionFrame emission, or any readiness claim.

## Closed Gate State

H2 Narrow Implementation Gates 1 through 5 remain complete and closed and are not reopened by this
document:

- Gate 1: bounded private capture / high-volume child output safety.
- Gate 2: explicit smoke-path isolation / default-runtime guard.
- Gate 3: unsafe-diagnostic fail-closed on the public stdout path.
- Gate 4: explicit failure-case public stdout guards.
- Gate 5: helper runtime normal-path public stream guard coverage.

The Gate 6 proposal must build only on the existing explicit helper runtime normal/success smoke
path. It must not reinterpret or expand closed Gates 1 through 5.

## Gate 6 Definition

Gate 6 is defined as: **Helper runtime normal-path frame-count variation public stream guard
coverage**.

The intended future implementation slice must remain synthetic/smoke-only and checker-only. It may
extend the existing explicit helper runtime normal/success smoke coverage beyond the current
`--frames 3` case by adding CI-safe public stream guard evidence for additional source-grounded frame
counts, if the current source supports those counts.

## Required Source Confirmation

Before selecting exact frame counts, the future implementation agent must inspect the current checker
and helper runtime smoke source, including:

- `tools/check-helper-runtime-integration.mjs` for the existing validation path, marker sets, public
  stdout / stderr checks, and the current `--frames 3` normal-path guard.
- `native/tracker-core/src/helper_runtime_smoke.cpp` only as needed to confirm how the explicit
  `--helper-runtime-smoke` path passes `--frames N` to the synthetic helper and whether the desired
  counts are source-supported.

The future implementation must choose only small, CI-safe, source-grounded frame counts. If source
inspection does not support a proposed count, that count must not be added.

## Allowed Future Implementation Scope

Allowed future implementation under Gate 6:

- update the existing helper runtime integration checker to add normal-path public stream guard
  assertions for selected additional `--frames N` cases;
- reuse the existing native MotionFrame JSON validation path and existing marker sets where possible;
- keep the evidence on the explicit `lvk-tracker-core --helper-runtime-smoke <helper> --frames N`
  normal/success path only;
- keep helper stdout and helper stderr private to Native Core;
- keep public `lvk-tracker-core` stdout MotionFrame JSON only.

The preferred implementation is checker-only. The future implementation must not change C++ runtime
behavior unless source inspection proves a tiny checker-only harness adjustment is unavoidable and the
implementation PR separately justifies that adjustment. Any such adjustment must still be
synthetic/smoke-only and must not affect default runtime behavior.

## Required Public Stdout Assertions

For each selected frame count `N`, the future checker evidence must assert all of the following for
public stdout:

- exit status `0`;
- exactly `N` non-empty public stdout lines for `--frames N`;
- every public stdout line parses as native MotionFrame JSON through the existing validation path;
- no helper lifecycle markers;
- no helper diagnostics;
- no unsafe child output;
- no raw child stderr;
- no child stdout JSON forms;
- no policy / error text leaking on public streams.

These assertions must preserve the public stream boundary: helper stdout and helper stderr remain
private to Native Core.

## Required Public Stderr Assertions

For each selected frame count `N`, public stderr assertions must preserve the Gate 5 safe-parent-prefix
behavior:

- public stderr may be empty;
- every non-empty public stderr line must use the safe parent `[helper-runtime-smoke] ` prefix;
- public stderr, even behind the safe parent prefix, must not include helper lifecycle markers,
  helper diagnostics, unsafe child output, raw child stderr, child stdout JSON forms, or policy /
  error text.

## Non-goals / Still Unapproved

This decision does not approve, implement, or imply approval for:

- production H2 integration;
- default helper runtime wiring;
- default `lvk-tracker-core` H2 runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine behavior;
- fallback MotionFrame emission;
- new fallback MotionFrame behavior;
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
- production readiness claims.

## Required Reporting From Future Implementation Agent

The future implementation agent must report:

- the branch used;
- the files changed;
- the exact selected frame counts and source confirmation used to select them;
- confirmation that the implementation stayed synthetic/smoke-only and checker-only unless a tiny
  smoke-harness adjustment was separately justified;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that no production H2 integration, default helper runtime wiring, production
  supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission,
  MotionFrame / Motion Protocol change, Electron / Web Preview change, dependency, telemetry,
  analytics, cloud upload, external frame processing, hidden network call, new network behavior, or
  readiness claim was added.

## Recommended Next Step

After this decision PR merges, create a future implementation prompt for H2 Narrow Implementation
Gate 6: Helper runtime normal-path frame-count variation public stream guard coverage.

Do not proceed directly to production H2 integration, default helper runtime wiring, production
supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission, or any
readiness claim.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 post-Gate-5 owner decision boundary](TRACKING_HELPER_PROCESS_H2_POST_GATE_5_OWNER_DECISION.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 Narrow Implementation Gate 5 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md)
- [H2 helper runtime normal stream guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
