# Tracking Helper Process H2 Foundation Implementation Planning Decision

## Status

Status: docs-only owner decision boundary for H2 foundation implementation planning.
Scope: records the post-Gate-7 planning boundary and requirements for drafting the first H2
foundation implementation gate.

This document approves **planning** for the first H2 foundation implementation gate. It does not
approve implementation, production H2 integration, default helper runtime wiring, production
supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission,
MotionFrame / Motion Protocol changes, Electron / Web Preview changes, dependencies, network
behavior, or readiness claims.

## Owner Decision

H2 Narrow Implementation Gates 1 through 7 are closed at the synthetic/smoke checker level. Gates 1
through 7 remain closed and are not reopened by this document.

After Gate 7, the owner intends to move toward **H2 foundation implementation planning**. The next
phase is H2 foundation implementation planning, not production H2 integration and not direct
foundation implementation.

This decision approves only the planning boundary needed to draft the first H2 foundation
implementation gate. Any future foundation implementation still requires a separate owner-approved
implementation gate that is reviewed and merged before implementation starts.

## Closed Gate State Preserved

The closed narrow implementation gates remain intact:

- Gate 1: bounded private capture / high-volume child output safety.
- Gate 2: explicit smoke-path isolation / default-runtime guard.
- Gate 3: unsafe-diagnostic fail-closed on the public stdout path.
- Gate 4: explicit failure-case public stdout guards.
- Gate 5: helper runtime normal-path public stream guard coverage.
- Gate 6: helper runtime normal-path frame-count variation public stream guard coverage.
- Gate 7: helper runtime normal-path zero-frame public stream guard coverage.

This document does not reinterpret those gates, reopen their scope, or convert their
synthetic/smoke checker evidence into production-runtime approval.

## Next Phase Boundary

The next active H2 boundary is **H2 foundation implementation planning**.

This boundary may be used to prepare a future owner-reviewed implementation gate. It must not be
used to make code changes, wire production runtime behavior, expose user-facing H2 behavior, or make
readiness claims.

## Candidate Planning Topics

The candidate planning topics for the next gate are:

- **Option A:** source-grounded foundation inventory and current-runtime boundary map.
- **Option B:** draft the first narrow H2 foundation implementation gate.
- **Option C:** pause H2 and move to another LVK area.

Recommended next direction: **Option B**, draft the first narrow H2 foundation implementation gate.
This recommendation does not approve implementation. Actual implementation remains unapproved until
a future gate document is reviewed, merged, and explicitly approved by the owner.

## Requirements for the First Foundation Implementation Gate

The first foundation implementation gate must choose the smallest useful foundation slice and avoid
production/default wiring. It must identify all of the following before any implementation begins:

- exact files allowed to change;
- exact files excluded;
- whether any C++ runtime behavior changes are allowed;
- whether Electron remains untouched;
- whether MotionFrame and Motion Protocol remain untouched;
- whether diagnostics, fallback behavior, supervisor behavior, and default wiring remain excluded;
- validation commands and required evidence;
- skipped-check rules;
- privacy and local-first constraints.

The gate must also include exact scope, non-goals, allowed files, excluded files, validation
evidence, and owner-approved exclusions. If a surface is not explicitly allowed by that future gate,
it must remain unchanged.

## Still Unapproved

This document does not approve, implement, or imply approval for:

- production H2 integration;
- default helper runtime wiring;
- default `lvk-tracker-core` H2 runtime wiring;
- production supervisor behavior;
- diagnostics-safety policy engine behavior;
- fallback MotionFrame emission;
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
- local/manual readiness claims;
- webcam readiness claims;
- OBS readiness claims;
- Electron readiness claims;
- production readiness claims;
- direct foundation implementation.

## Required Reporting From the Future Gate-Drafting Agent

The future gate-drafting agent must report:

- the branch used;
- the files changed;
- confirmation that Gates 1 through 7 remain closed and are not reopened;
- confirmation that the work is planning-only and docs-only unless a later owner-approved gate says
  otherwise;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that no production H2 integration, default helper runtime wiring, production
  supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission,
  MotionFrame / Motion Protocol change, Electron / Web Preview change, dependency, telemetry,
  analytics, cloud upload, external frame processing, hidden network call, new network behavior,
  readiness claim, or foundation implementation was added.

## Recommended Next Step

Draft the first narrow H2 foundation implementation gate as a docs-only PR. The gate must preserve
the smallest useful foundation slice, avoid production/default wiring, and keep implementation
unapproved until the future gate document is reviewed, merged, and explicitly owner-approved.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 Narrow Implementation Gate 7 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_7_DECISION.md)
- [H2 helper runtime zero-frame guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 helper runtime normal-path frame-count guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md)
