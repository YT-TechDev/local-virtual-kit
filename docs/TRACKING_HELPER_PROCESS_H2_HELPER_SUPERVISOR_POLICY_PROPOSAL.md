# Tracking Helper Process H2 Helper Supervisor Policy Proposal

## Status

Status: docs-only H2 helper supervisor policy proposal under Option B.
Scope: proposes planning boundaries and questions for a possible future production helper supervisor.

This is a docs-only supervisor policy proposal. Implementation remains separately gated. Production
supervisor behavior remains unapproved. Default runtime wiring remains unapproved. Fallback
MotionFrame behavior remains unapproved. Runtime behavior is unchanged by this document.

This document implements nothing, approves no production supervisor behavior, and makes no readiness
claim. Future implementation requires a separate owner-approved implementation gate. Future readiness
claims require separately completed validation evidence.

## Purpose

This proposal defines the supervisor policy areas that future H2 production-runtime planning should
settle before any implementation gate is considered. It stays within Option B by describing planning
questions, candidate boundaries, required evidence, and explicit non-goals only.

The proposal is intended to help later planning PRs reason about startup, ready / liveness, helper
output, shutdown, timeouts, failures, fallback, restart / backoff, and validation without approving
runtime behavior changes.

## Proposed Supervisor Policy Areas

Future docs-only planning may propose boundaries for these policy areas:

- Startup boundary: when a helper would be considered launched, waiting for ready, or failed to start.
- Ready / liveness boundary: which signals could indicate readiness or continued health.
- Helper output handling boundary: how private helper stdout and stderr would be classified,
  bounded, and kept away from public `lvk-tracker-core` stdout.
- Shutdown boundary: how a future supervisor could request or observe helper exit.
- Timeout boundary: which phases could have bounded waiting and how timeout evidence would be
  reported.
- Failure / fallback boundary: how failures could be classified without approving fallback
  MotionFrame behavior.
- Restart / backoff questions: whether restart is allowed at all, and what evidence would be needed
  before deciding.
- Validation evidence: what must be proven before implementation or readiness claims.

These are planning surfaces only. They do not approve implementation, production integration, default
runtime wiring, fallback MotionFrame behavior, real control channels, forced termination, restart /
backoff, or runtime behavior changes.

## Startup / Ready / Liveness Planning

A future supervisor plan should answer, at documentation level only:

- What is the startup boundary between Native Core preparing a helper and a helper being considered
  launched?
- What ready signal, if any, is allowed, and how is it distinguished from diagnostics?
- What happens if a helper emits diagnostics before a ready signal?
- What liveness observations are needed after ready, and which observations are explicitly not enough
  to claim production health?
- How would startup and ready evidence avoid leaking helper diagnostics to public MotionFrame stdout?
- Which local/manual checks are required before claiming POSIX, webcam, Electron, OBS, or production
  runtime readiness?

This proposal does not approve a ready protocol, liveness protocol, helper startup implementation, or
default `lvk-tracker-core` runtime wiring.

## Helper Output and Diagnostics Planning

Future planning should preserve the existing output boundary:

- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.
- Helper diagnostics must not corrupt public MotionFrame output.
- Diagnostic capture should be bounded, privacy-preserving, and safe for local-first operation.
- Any future diagnostics policy must define which messages are safe to retain, summarize, or surface.

Open planning questions include:

- What helper output line-size, count, or rate boundaries are needed?
- How are malformed, unknown, oversized, or high-volume helper messages classified?
- Which diagnostics may be included in validation logs without exposing camera frames, pixels,
  tensors, paths, secrets, or user-identifying information?
- What evidence proves helper output remains private and public stdout remains MotionFrame-only?

This proposal does not approve a production diagnostics-safety policy engine or any runtime output
handling changes.

## Shutdown / Timeout Planning

Future planning should separate graceful shutdown, already-exited helpers, failure / timeout terminal
paths, and any potential forced-termination question.

Planning questions include:

- Is a real parent-to-child stop / control channel needed?
- If a stop channel is needed, what transport and message set would be allowed?
- How long may a future supervisor wait during startup, ready, running, and shutdown phases?
- What evidence distinguishes a startup timeout from a shutdown timeout?
- How are already-exited helpers treated without creating duplicate terminal states?
- Is forced termination allowed, rejected, or deferred?
- What must be validated on each target operating system before claiming production shutdown
  behavior?

No real control channel is approved. No forced termination is approved. No production shutdown
timeout policy is approved. No runtime behavior changes are approved.

## Failure and Fallback Planning

Future planning should classify failures without approving fallback behavior. Candidate areas to
document later include:

- startup failure;
- ready timeout;
- helper exit before ready;
- helper exit after ready;
- malformed or unsafe helper output;
- oversized or high-volume helper output;
- private diagnostics overflow;
- shutdown timeout;
- platform-specific process errors.

Fallback MotionFrame behavior remains unapproved. Any future fallback proposal must preserve the
stable MotionFrame contract, avoid schema changes unless separately approved, and define validation
evidence before making readiness claims.

## Restart / Backoff Planning Questions

Restart / backoff remains unapproved. A later planning PR should answer at least:

- Is automatic restart allowed at all?
- Which failures, if any, are restartable?
- Which failures must be terminal until a user or owner-approved policy changes state?
- What retry budget, delay, jitter, or backoff cap would be safe?
- How would repeated crashes avoid loops, noisy diagnostics, or user confusion?
- How would restart interact with fallback behavior if fallback remains unapproved?
- What validation evidence is required before any restart / backoff behavior or readiness claim?

This proposal approves no restart, retry, relaunch, or backoff behavior.

## Non-Goals

This PR and document do not approve, implement, or imply approval for:

- production H2 integration;
- default `lvk-tracker-core` runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- production fail-closed fallback MotionFrame emission;
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

## Required Validation Before Implementation or Readiness Claims

Before any future supervisor implementation or readiness claim, separate owner-approved planning must
define and later complete evidence for:

- CI-safe checks for the exact approved implementation surface;
- local/manual checks only when run on suitable hardware, permissions, GUI session, operating system,
  and application under test;
- public `lvk-tracker-core` stdout remaining MotionFrame JSON only;
- helper stdout and stderr remaining private to Native Core;
- bounded and privacy-preserving helper diagnostics;
- no MotionFrame schema change unless separately approved;
- no telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior;
- skipped-check reporting with explicit reasons;
- owner approval for the exact implementation or readiness scope being claimed.

Documentation-only planning does not complete this validation.

## Required Privacy / Architecture Boundaries

Future planning and implementation gates must preserve these boundaries:

- Camera frames must stay local in v0.1.
- Native Core owns tracking, camera access, native performance boundaries, and low-level runtime
  concerns.
- Electron owns desktop shell, settings, calibration UI, local config, and native process lifecycle.
- Web Preview consumes MotionFrame only.
- Electron / Web Preview must not gain backend runtime dependencies.
- MotionFrame remains the stable contract and must not be changed casually.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new
  network behavior is approved.

## Decisions Deferred to Later Planning PRs

Later docs-only planning PRs must decide, before any implementation gate can be considered:

- exact startup, ready, liveness, shutdown, timeout, and failure classification boundaries;
- whether fallback MotionFrame behavior should be proposed, and under which compatibility evidence;
- diagnostics / stdout / stderr safety policy details;
- whether a real control channel is needed or rejected;
- whether forced termination is allowed, rejected, or deferred;
- whether restart / backoff is allowed, rejected, or deferred;
- local/manual validation plan details;
- implementation gate requirements.

These decisions remain planning-only until a future owner-approved implementation gate exists.

## Next Possible Planning PRs

The next planning candidates are docs-only candidates, not implementation approvals:

1. H2 fallback MotionFrame behavior proposal.
2. H2 diagnostics / stdout / stderr safety planning.
3. H2 local/manual validation plan.
4. H2 implementation gate requirements.

Recommended next planning PR: H2 fallback MotionFrame behavior proposal, limited to documentation and
explicitly preserving that fallback MotionFrame behavior remains unapproved until a later
owner-approved implementation gate.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 production-runtime Option B decision](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
- [H2 production-runtime scope and non-goals plan](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 process lifecycle scope gate](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
- [H2 production runtime scope gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
- [H2 validation scope gate](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
