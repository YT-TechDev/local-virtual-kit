# Tracking Helper Process H2 Diagnostics / Stdout / Stderr Safety Planning

## Status

Status: docs-only H2 diagnostics / stdout / stderr safety planning under Option B.
Scope: planning questions, candidate boundaries, safety constraints, privacy requirements, and
validation evidence for future H2 diagnostics handling.

This is a docs-only diagnostics / stdout / stderr safety planning document. Production
diagnostics-safety policy behavior remains unapproved. No diagnostics-safety policy engine is
implemented or approved by this document. No runtime diagnostics behavior is implemented. Public
`lvk-tracker-core` stdout remains MotionFrame JSON only. Helper stdout and stderr remain private to
Native Core. Implementation remains separately gated. Default runtime wiring remains unapproved.
Runtime behavior is unchanged by this document.

Fallback MotionFrame behavior remains unapproved. No fallback MotionFrame emission is approved.
MotionFrame schema changes remain unapproved. Production supervisor behavior remains unapproved. No
readiness claim is made. Future implementation requires a separate owner-approved implementation
gate. Future readiness claims require separately completed validation evidence.

## Purpose

This document records planning-only safety boundaries for diagnostics, public stdout, helper stdout,
and helper stderr before any future H2 production-runtime implementation gate is considered. It stays
within Option B by documenting questions and candidate policy areas only; it does not approve
production diagnostics behavior, production H2 integration, fallback behavior, default
`lvk-tracker-core` runtime wiring, or readiness claims.

The goal is to preserve LVK's local-first privacy and MotionFrame boundaries while making later
implementation-gate review more precise.

## Diagnostics Safety Principles

Future planning and any later implementation gate should preserve these principles:

- Public `lvk-tracker-core` stdout must remain MotionFrame JSON only.
- Helper stdout and stderr must remain private to Native Core.
- Diagnostics must not corrupt public MotionFrame stdout.
- Diagnostic capture, if later approved, must be bounded by size, count, and rate.
- Diagnostic summaries, if later approved, must be local-only and privacy-safe.
- Unknown, malformed, oversized, high-volume, unsafe, or binary helper output must be classified
  before it can affect any public runtime surface.
- Diagnostics classification must not require MotionFrame schema changes.
- Diagnostics classification must not imply fallback MotionFrame behavior or fallback MotionFrame
  emission.
- Diagnostics handling must not add telemetry, analytics, cloud upload, external frame processing,
  hidden network calls, or new network behavior.

These are planning principles only. They do not implement or approve a production
diagnostics-safety policy engine.

## Public Stdout Boundary

Public `lvk-tracker-core` stdout remains MotionFrame JSON only. Future planning must treat this as a
hard product boundary because Web Preview and other MotionFrame consumers should receive only the
stable MotionFrame contract.

Before any future implementation or readiness claim, planning must define evidence that proves:

- public stdout contains only valid MotionFrame JSON records for the approved runtime surface;
- helper diagnostics, helper lifecycle markers, parse errors, policy errors, debug logs, and unsafe
  output are not forwarded to public stdout;
- public stdout behavior is validated during normal helper output, malformed helper output, unknown
  helper output, oversized helper output, high-volume helper output, helper stderr output, helper
  exit, and any separately approved fallback-classified path;
- no MotionFrame field, source value, tracking status, schema version, or diagnostics extension is
  introduced without a separate Motion Protocol decision and owner approval.

This document does not approve fallback MotionFrame behavior, fallback MotionFrame emission, or any
MotionFrame schema change.

## Helper Stdout / Stderr Private Boundary

Helper stdout and stderr remain private to Native Core. Future planning should treat both streams as
untrusted input from a child process until a separately approved policy classifies them.

Planning questions for private helper stdout and stderr include:

- Which helper stdout records are protocol messages, diagnostics, lifecycle hints, or invalid data?
- Which helper stderr records are diagnostics, policy violations, crash evidence, or invalid data?
- Are stdout and stderr classified independently, or does one stream affect the other?
- What bounded capture window is allowed for each stream before truncation or summary?
- What local-only diagnostic summary, if any, may be retained without exposing sensitive content?
- Which records must be dropped, redacted, summarized, or treated as terminal policy violations?
- What evidence proves private helper stdout and stderr never become public MotionFrame stdout?

No helper stdout or stderr exposure to Electron, Web Preview, telemetry, analytics, cloud services, or
public MotionFrame stdout is approved by this document.

## Unsafe Diagnostics Categories

Future planning must treat diagnostics as sensitive or unsafe unless explicitly proven safe. Examples
of unsafe or sensitive categories include:

- camera frames;
- raw pixels;
- tensors;
- images;
- user-identifying information;
- secrets;
- tokens;
- private keys;
- local file paths;
- environment variables;
- machine-specific identifiers;
- high-volume logs that could leak user activity;
- unbounded binary output;
- malformed or non-UTF-8 output.

These are planning categories and safety constraints. This document does not claim that current code
emits these categories.

## Candidate Size / Count / Rate Planning Questions

A later implementation gate must define concrete bounds before diagnostics handling can be approved.
Candidate planning questions include:

- What is the maximum accepted bytes per helper stdout line and helper stderr line?
- What is the maximum cumulative captured bytes per helper process run?
- What is the maximum retained line count per stream?
- What output rate is considered high volume and therefore unsafe or degraded?
- How are partial lines, unterminated lines, binary bytes, and non-UTF-8 sequences classified?
- When a bound is exceeded, is the event classified as malformed, oversized, high-volume, unsafe,
  terminal, non-terminal, or dropped-with-summary?
- How does truncation preserve enough local evidence for debugging without leaking sensitive content?
- How is behavior validated without relying on real camera frames or helper-owned camera capture?

No specific production size, count, or rate limit is approved by this document.

## Helper Output Classification Planning

Future planning should classify helper output before implementation. At planning level only, likely
classification questions include:

- Malformed helper output: output that cannot be parsed, is incomplete, has invalid encoding, or does
  not match an approved helper message shape.
- Unknown helper output: well-formed output whose message type, fields, or semantic meaning are not
  approved for the current runtime boundary.
- Oversized helper output: output exceeding a future approved per-line or cumulative size bound.
- High-volume helper output: output exceeding a future approved rate or count bound, even if
  individual records are small.
- Unsafe diagnostics: output containing or plausibly containing sensitive categories, binary content,
  local identifiers, secrets, frame-derived data, or other privacy-risk content.

Classification must remain private to Native Core and must not corrupt public MotionFrame stdout.
This planning document does not decide whether any classification is terminal, restartable,
fallback-classified, or ignored; those decisions remain deferred.

## Privacy and Local-First Constraints

Future diagnostics planning must preserve these constraints:

- Camera frames stay local in v0.1.
- No helper-owned camera capture is approved.
- No raw frame / pixel / tensor IPC is approved.
- No high-rate raw frame transport is approved.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.
- Diagnostic handling must be local-only unless a separate owner-approved decision changes product
  scope.
- Electron and Web Preview must not gain backend runtime dependencies.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior is approved.

## Validation Evidence Required Before Implementation or Readiness Claims

Before any future diagnostics implementation or readiness claim, a separate owner-approved gate must
require evidence for:

- public `lvk-tracker-core` stdout remaining MotionFrame JSON only;
- helper stdout and stderr remaining private to Native Core;
- malformed helper output not corrupting public stdout;
- unknown helper output not corrupting public stdout;
- oversized helper output not corrupting public stdout;
- high-volume helper output not corrupting public stdout or causing unbounded capture;
- unsafe diagnostics being classified without exposing sensitive content;
- bounded capture by approved size, count, and rate limits;
- privacy-safe local summaries, if summaries are approved at all;
- MotionFrame schema compatibility with the existing `schemaVersion: 1` contract unless a separate
  approved protocol change exists;
- no telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior;
- local/manual checks only when they actually run on suitable hardware, permissions, GUI session,
  operating system, and application under test;
- skipped checks reported with explicit reasons;
- owner approval for the exact implementation and readiness scope being claimed.

Documentation-only planning does not complete this validation. Future readiness claims require
separately completed validation evidence.

## Decisions Deferred to Later Planning PRs

Later planning PRs must decide, before implementation can be considered:

- exact diagnostic classification names and meanings;
- exact stdout and stderr size, count, and rate bounds;
- exact redaction, truncation, dropping, and local-summary rules;
- whether any classification is terminal, non-terminal, ignored, or fallback-classified;
- how diagnostics safety interacts with supervisor policy without approving production supervisor
  behavior;
- how diagnostics safety interacts with fallback planning without approving fallback MotionFrame
  emission;
- exact validation commands, fixtures, and evidence requirements;
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

1. H2 local/manual validation plan.
2. H2 implementation gate requirements.

Recommended next planning PR: H2 local/manual validation plan, limited to documentation and
explicitly preserving that implementation, runtime behavior changes, production diagnostics-safety
policy behavior, fallback MotionFrame emission, and readiness claims remain unapproved.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime Option B decision](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
- [H2 production-runtime scope and non-goals plan](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 fallback MotionFrame behavior proposal](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
