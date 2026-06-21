# Tracking Helper Process H2 Foundation Implementation Planning Decision

## Status

Status: docs-only owner decision for H2 foundation implementation planning after H2 Narrow
Implementation Gate 7.
Scope: records the owner-approved planning boundary for drafting the first H2 foundation
implementation gate.

This document approves planning for the first H2 foundation implementation gate only. It does not
approve foundation implementation, production H2 integration, default helper runtime wiring,
production supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame
emission, MotionFrame or Motion Protocol changes, Electron or Web Preview changes, dependency
changes, new network behavior, or readiness claims.

## Owner Decision

H2 Narrow Implementation Gates 1 through 7 are closed at the synthetic/smoke checker level. Gates 1
through 7 remain closed and are not reopened by this decision.

The owner intent after Gate 7 is to move toward **H2 foundation implementation planning**. This next
phase is planning for the first H2 foundation implementation gate, not direct implementation and not
production H2 integration.

Any future foundation implementation still requires a separate owner-approved implementation gate that
is reviewed and merged before implementation work starts. That future gate must define exact scope,
allowed files, excluded files, validation evidence, non-goals, and all runtime boundaries.

## Candidate Foundation Planning Topics

The next owner-facing planning options are:

- **Option A: source-grounded foundation inventory and current-runtime boundary map.** This would
  document the current source surfaces, existing runtime boundaries, and candidate smallest foundation
  seams without approving code changes.
- **Option B: draft the first narrow H2 foundation implementation gate.** This would produce the
  separate gate document required before any foundation implementation can be considered.
- **Option C: pause H2 and move to another LVK area.** This would leave H2 foundation implementation
  planning inactive until the owner reopens it.

Recommended direction: **Option B** is the owner-intended next direction. This recommendation does not
approve implementation. Actual foundation implementation remains unapproved until a future gate
document is reviewed, merged, and explicitly authorizes the exact implementation slice.

## First Foundation Implementation Gate Requirements

The first H2 foundation implementation gate must choose the smallest useful foundation slice and avoid
production/default wiring. It must identify, before any implementation begins:

- exact files allowed to change;
- exact files excluded from change;
- whether any C++ runtime behavior changes are allowed;
- whether Electron remains untouched;
- whether MotionFrame remains untouched;
- whether Motion Protocol remains untouched;
- whether diagnostics, fallback, supervisor, and default runtime wiring remain excluded;
- validation commands and required evidence;
- skipped-check rules and how skipped checks must be reported;
- privacy and local-first constraints.

If the future gate does not explicitly allow a file, behavior, or runtime surface, that file,
behavior, or surface remains excluded.

## Still Unapproved

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
- dependency additions, removals, or upgrades;
- telemetry;
- analytics;
- cloud upload;
- external frame processing;
- hidden network calls;
- new network behavior;
- local/manual runtime readiness claims;
- webcam readiness claims;
- OBS readiness claims;
- Electron readiness claims;
- production readiness claims;
- foundation implementation.

## Privacy and Local-First Boundary

The planning boundary preserves LVK local-first constraints. Camera frames must remain local. No
telemetry, analytics, cloud upload, external frame processing, hidden network call, or new network
behavior is approved. Any future implementation gate must include privacy evidence requirements for
its exact approved slice.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md)
  — Gate 7 closeout recording the zero-frame helper runtime public stream guard at the
  synthetic/smoke checker level only.
- [`docs/TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md`](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
  — requirements for any future owner-approved H2 implementation gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
