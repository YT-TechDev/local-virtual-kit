# Tracking Helper Process H2 Post-Ordering Next-Scope Gate

## Status

Status: docs-only next-scope gate after H2 synthetic smoke ordering hardening.
Scope: defines the review required before any production-runtime, runtime-integration, or default-runtime H2 planning.

This document implements nothing and approves no production H2 work.

## Purpose

The H2 synthetic smoke ordering hardening phase is closeable as synthetic-only work. This gate records the next decision boundary before LVK moves toward any production runtime or runtime-integration planning.

The next step must be a read-only scope review, not implementation.

## Current Closed Phase

The ordering hardening closeout is recorded in [H2 ordering hardening closeout](TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md).

The following cases are closed as synthetic-only first-occurrence lifecycle ordering hardening:

- `normal`
- `shutdown_graceful_exit`
- `shutdown_timeout_forced_exit`
- `shutdown_after_helper_already_exited`
- `unknown_message_type`
- `malformed_line`

`oversized_line_rejected` intentionally remains on bounded-line scan behavior. It rejects the oversized line before marker reconstruction and does not need to be forced into first-occurrence lifecycle ordering.

## What Remains Unapproved

This gate does not approve:

- production H2 integration;
- default `lvk-tracker-core` runtime wiring;
- production helper process supervisor policy changes;
- real parent-to-child control channel semantics;
- real forced termination;
- restart / backoff;
- backend / model / runtime selection;
- real camera access;
- helper-owned camera capture;
- raw frame / pixel / tensor IPC;
- high-rate raw frame transport;
- MotionFrame schema changes;
- Electron / Web Preview / Motion Protocol changes;
- new dependencies;
- telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.

## Required Review Before Next Implementation

Before any implementation planning, a read-only production-runtime / runtime-integration scope review must answer:

- Is there a small local-first production-runtime planning slice that can be proposed without wiring H2 into the default runtime?
- Should the next step remain docs-only?
- Is a runtime integration plan appropriate now, or should validation, helper contract, or process lifecycle docs be tightened first?
- What exact owner approval would be required before implementation?
- Which boundaries must remain unchanged?

## Acceptable Next Outputs

Acceptable future outputs are limited to:

- read-only production-runtime scope review;
- docs-only implementation-gate refinement;
- docs-only validation plan refinement;
- a future owner-approved implementation prompt, only after explicit approval.

## Explicitly Disallowed Next Outputs Without Owner Approval

Without explicit owner approval, do not create a:

- implementation PR;
- default runtime wiring PR;
- helper process supervisor production behavior PR;
- Electron UI / settings PR;
- MotionFrame schema PR;
- backend / model / runtime dependency PR;
- camera / frame transport PR;
- telemetry / network / cloud behavior PR.

## Next Recommended Step

Perform a read-only production-runtime / runtime-integration scope review as the next step. Do not proceed to implementation from this gate.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 ordering hardening closeout](TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md)
- [H2 first implementation gate draft](TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md)
- [H2 runtime integration owner decision](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 process lifecycle scope gate](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [H2 local runtime validation plan](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
- [H2 synthetic smoke phase handoff](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
