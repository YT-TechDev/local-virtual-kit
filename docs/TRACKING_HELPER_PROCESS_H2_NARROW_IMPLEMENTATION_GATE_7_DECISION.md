# Tracking Helper Process H2 Narrow Implementation Gate 7 Decision

## Status

Status: docs-only owner decision for H2 Narrow Implementation Gate 7.
Scope: records the owner's post-Gate-6 Option B choice and approves only a future narrow
synthetic/smoke-only checker implementation gate for review.

This document proposes the future Gate 7 boundary only. It does not implement runtime behavior,
change C++ runtime behavior, change MotionFrame, change Motion Protocol, change Electron or Web
Preview, add dependencies, add network behavior, or make readiness claims.

## Owner Decision

The owner selected Option B from the post-Gate-6 owner decision boundary: approve drafting a future
narrow implementation gate document for review.

This decision approves only H2 Narrow Implementation Gate 7 as a future narrow synthetic/smoke-only
checker implementation proposal. It does not approve production H2 integration, default helper
runtime wiring, production supervisor behavior, diagnostics-safety policy engine behavior, fallback
MotionFrame emission, H2 foundation implementation planning, or any readiness claim.

## Closed Gate State

H2 Narrow Implementation Gates 1 through 6 remain complete and closed and are not reopened by this
document:

- Gate 1: bounded private capture / high-volume child output safety.
- Gate 2: explicit smoke-path isolation / default-runtime guard.
- Gate 3: unsafe-diagnostic fail-closed on the public stdout path.
- Gate 4: explicit failure-case public stdout guards.
- Gate 5: helper runtime normal-path public stream guard coverage.
- Gate 6: helper runtime normal-path frame-count variation public stream guard coverage.

The Gate 7 proposal must build only on the existing explicit helper runtime normal/success smoke
path. It must not reinterpret or expand closed Gates 1 through 6.

## Gate 7 Definition

Gate 7 is defined as: **Helper runtime normal-path zero-frame public stream guard coverage**.

The intended future implementation slice must remain synthetic/smoke-only and checker-only. It may
extend the existing explicit helper runtime normal/success smoke coverage to the source-supported
zero-frame normal/success edge case:

```txt
lvk-tracker-core --helper-runtime-smoke <helper> --frames 0
```

This proposed coverage is intended to prove only the public stream boundary for the explicit
zero-frame smoke path. It is not production runtime behavior and is not default helper runtime
wiring.

## Required Source Confirmation

Before implementation, the future implementation agent must confirm from current source that
`--frames 0` is supported by the current helper smoke path. At minimum, inspect the current checker
and helper smoke source as needed, including:

- `tools/check-helper-runtime-integration.mjs` for the existing validation path, marker sets, public
  stdout / stderr checks, and current normal-path guards.
- `native/tracker-core/src/helper_runtime_smoke.cpp` only as needed to confirm how the explicit
  `--helper-runtime-smoke` path passes `--frames N` to the synthetic helper and how it validates the
  requested result count.
- `native/tracker-core/src/synthetic_helper_main.cpp` only as needed to confirm that zero is an
  accepted `--frames` value and that the zero-frame loop emits no synthetic result lines.

If current source does not support the zero-frame normal/success path, Gate 7 implementation must not
be added until the owner reviews a separate source-grounded adjustment proposal.

## Allowed Future Implementation Scope

Allowed future implementation under Gate 7:

- update the existing helper runtime integration checker to add normal-path public stream guard
  assertions for `--frames 0` only;
- keep the evidence on the explicit `lvk-tracker-core --helper-runtime-smoke <helper> --frames 0`
  normal/success path only;
- reuse existing public stream marker-deny checks where possible;
- keep helper stdout and helper stderr private to Native Core;
- keep public `lvk-tracker-core` stdout free of helper output and fallback output for the zero-frame
  success case.

The preferred implementation is checker-only. The future implementation must not change C++ runtime
behavior unless source inspection proves a tiny checker-only harness adjustment is unavoidable and
the implementation PR separately justifies that adjustment. Any such adjustment must still be
synthetic/smoke-only and must not affect default runtime behavior.

## Required Zero-Frame Assertions

The future checker evidence for `--frames 0` must assert all of the following:

- exit status `0`;
- exactly `0` non-empty public stdout lines;
- no MotionFrame, fallback frame, helper lifecycle marker, helper diagnostic, unsafe child output,
  raw child stderr, child stdout JSON form, policy / error text, or smoke-only marker on public
  stdout;
- public stderr may be empty;
- every non-empty public stderr line must start with `[helper-runtime-smoke] `;
- public stderr, even behind the safe parent prefix, must not include helper lifecycle markers,
  helper diagnostics, unsafe child output, raw child stderr, child stdout JSON forms, policy / error
  text, or smoke-only markers.

These assertions must preserve the public stream boundary: helper stdout and helper stderr remain
private to Native Core.

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
- production readiness claims;
- H2 foundation implementation planning;
- H2 foundation implementation.

## Relationship to H2 Foundation Planning

Gate 7 is intended as the last small synthetic/smoke checker gate before the owner considers moving
into H2 foundation implementation planning. Gate 7 must not itself approve that foundation
implementation planning or any foundation implementation work. Any such planning remains a future
owner decision after Gate 7.

## Required Reporting From Future Implementation Agent

The future implementation agent must report:

- the branch used;
- the files changed;
- source confirmation that `--frames 0` is supported by the current helper smoke path;
- confirmation that the implementation stayed synthetic/smoke-only and checker-only unless a tiny
  smoke-harness adjustment was separately justified;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that no production H2 integration, default helper runtime wiring, production
  supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission,
  MotionFrame / Motion Protocol change, Electron / Web Preview change, dependency, telemetry,
  analytics, cloud upload, external frame processing, hidden network call, new network behavior,
  readiness claim, H2 foundation implementation planning approval, or H2 foundation implementation
  approval was added.

## Recommended Next Step

After this decision PR merges, create a future implementation prompt for H2 Narrow Implementation
Gate 7: Helper runtime normal-path zero-frame public stream guard coverage.

Do not proceed directly to production H2 integration, default helper runtime wiring, production
supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission, H2
foundation implementation planning, H2 foundation implementation, or any readiness claim.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 post-Gate-6 owner decision boundary](TRACKING_HELPER_PROCESS_H2_POST_GATE_6_OWNER_DECISION.md)
- [H2 Narrow Implementation Gate 6 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md)
- [H2 helper runtime normal-path frame-count guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
