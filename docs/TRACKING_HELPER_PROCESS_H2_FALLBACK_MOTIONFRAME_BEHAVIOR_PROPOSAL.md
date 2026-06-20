# Tracking Helper Process H2 Fallback MotionFrame Behavior Proposal

## Status

Status: docs-only H2 fallback MotionFrame behavior proposal under Option B.
Scope: planning questions, candidate boundaries, compatibility requirements, and validation evidence
for possible future fallback MotionFrame behavior.

This is a docs-only fallback MotionFrame behavior proposal. Fallback MotionFrame behavior remains
unapproved. No fallback MotionFrame emission is approved by this document. MotionFrame schema changes
remain unapproved. Implementation remains separately gated. Default runtime wiring remains
unapproved. Runtime behavior is unchanged by this document. No production supervisor behavior is
approved. No readiness claim is made.

Future implementation requires a separate owner-approved implementation gate. Future readiness claims
require separately completed validation evidence.

## Purpose

This document records the planning boundary for possible future fallback MotionFrame behavior after
Option B approved docs-only production-runtime planning. It is source-grounded in the current
MotionFrame contract, which contains `schemaVersion: 1`, `source: "dummy" | "native"`, and
`tracking.status: "not_started" | "tracking" | "lost"`; it does not introduce a fallback-specific
field.

The purpose is to make later implementation-gate discussion safer by separating open planning
questions from implementation approval. Listing candidate fallback situations here does not approve
fallback behavior, fallback MotionFrame emission, production H2 integration, default
`lvk-tracker-core` runtime wiring, production supervisor behavior, MotionFrame schema changes, or
runtime behavior changes.

## Fallback MotionFrame Planning Principles

Future planning should preserve these principles before any implementation gate is considered:

- Fallback behavior must be representable without schema changes unless a separate protocol decision,
  docs update, tests, and owner approval explicitly approve a MotionFrame schema change.
- Fallback MotionFrame emission must preserve the stable MotionFrame contract and public
  `lvk-tracker-core` stdout as MotionFrame JSON only.
- Any future fallback decision must distinguish supervisor lifecycle classification from the public
  MotionFrame data contract.
- Native Core remains the owner of tracking, camera access, native performance boundaries, low-level
  runtime concerns, and any future public MotionFrame production.
- Web Preview remains a MotionFrame-only consumer and must not learn helper-runtime details.
- Electron remains responsible for desktop shell, settings, calibration UI, local config, and native
  process lifecycle, without gaining backend runtime dependencies.
- Camera frames must stay local in v0.1, and fallback handling must not add telemetry, analytics,
  cloud upload, external frame processing, hidden network calls, or new network behavior.

## Candidate Fallback Situations

The following situations are planning candidates only. Listing them does not approve fallback
behavior or fallback MotionFrame emission:

- helper startup failure;
- ready timeout;
- helper exit before ready;
- helper exit after ready;
- unsafe helper diagnostics;
- malformed helper output;
- oversized or high-volume helper output;
- shutdown timeout;
- platform-specific process errors.

Later planning must decide whether each situation is a fallback condition, a normal terminal
condition, an error condition without public fallback emission, or out of scope. Those decisions must
also stay consistent with the helper supervisor policy proposal; this document does not approve
production supervisor behavior.

## MotionFrame Compatibility Requirements

The current MotionFrame protocol does not define a fallback-specific indicator. It defines
`source` values of `dummy` and `native`, and tracking states of `not_started`, `tracking`, and `lost`.
Therefore, this proposal does not invent a new fallback field, source value, tracking status, or
schema version.

Before any future fallback implementation can be approved, planning must answer:

- Can the intended fallback behavior be represented using the existing `schemaVersion: 1` contract?
- If using `tracking.status`, which existing status is appropriate for each approved situation, and
  what evidence shows existing renderers tolerate it?
- What timestamp, confidence, and pose-value rules keep emitted frames stable, bounded, and compatible
  without implying live tracking?
- How is public stdout validated as MotionFrame JSON only, even when helper output is malformed,
  unsafe, oversized, or high volume?
- If a fallback-specific indicator is ever needed, what separate protocol decision, documentation,
  tests, producer / consumer updates, and owner approval are required before any schema change?

Any future schema change would require a separate protocol decision, docs, tests, and owner approval.
MotionFrame schema changes remain unapproved by this document.

## Renderer / Web Preview Boundary

Web Preview consumes MotionFrame only. Future fallback planning must not require Web Preview to know
about helper startup, ready timeouts, helper exits, diagnostics policy, shutdown timeouts,
platform-specific process errors, restart / backoff, or backend runtime selection.

Renderer behavior should continue to rely on the existing MotionFrame compatibility contract: tolerate
missing frames, disconnects, reconnects, delayed frames, out-of-order frames, out-of-range values,
`tracking.status = "not_started"`, and `tracking.status = "lost"`. This document does not change Web
Preview behavior, Electron behavior, Motion Protocol behavior, or renderer mapping.

## Privacy and Local-First Constraints

Future fallback planning must preserve these constraints:

- Camera frames stay local in v0.1.
- No helper-owned camera capture is approved.
- No raw frame / pixel / tensor IPC is approved.
- No high-rate raw frame transport is approved.
- Helper stdout and stderr remain private to Native Core.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior is approved.
- Electron / Web Preview must not gain backend runtime dependencies.

## Validation Evidence Required Before Implementation or Readiness Claims

A future implementation gate must require evidence for:

- MotionFrame schema compatibility with `schemaVersion: 1`, unless a separate approved protocol change
  exists;
- public stdout containing MotionFrame JSON only in normal and fallback-classified paths;
- helper stdout / stderr remaining private to Native Core;
- malformed, unsafe, oversized, and high-volume helper output not corrupting public MotionFrame
  output;
- candidate fallback situations being tested with CI-safe synthetic checks where applicable;
- local/manual checks being claimed only when they actually run on suitable hardware, permissions,
  GUI session, and application under test;
- skipped checks reported with explicit reasons;
- no telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior;
- owner approval for the exact implementation and readiness scope being claimed.

Documentation-only planning does not complete this validation. Future readiness claims require
separately completed validation evidence.

## Decisions Deferred to Later Planning PRs

Later planning PRs must decide, before implementation can be considered:

- diagnostics / stdout / stderr safety policy details;
- exact fallback classification for each candidate situation;
- whether any candidate should produce no public frame rather than a fallback MotionFrame;
- whether existing MotionFrame fields are sufficient for all approved fallback situations;
- exact compatibility rules for timestamps, confidence, pose values, and tracking status;
- validation commands and evidence required for CI-safe and local/manual claims;
- implementation gate requirements and owner-approval wording.

These decisions remain planning-only until a future owner-approved implementation gate exists.

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

## Next Possible Planning PRs

The next planning candidates are docs-only candidates, not implementation approvals:

1. H2 diagnostics / stdout / stderr safety planning.
2. H2 local/manual validation plan.
3. H2 implementation gate requirements.

Recommended next planning PR: H2 diagnostics / stdout / stderr safety planning, limited to
documentation and explicitly preserving that production diagnostics policy, fallback MotionFrame
emission, runtime behavior changes, and readiness claims remain unapproved.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime Option B decision](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
- [H2 production-runtime scope and non-goals plan](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
