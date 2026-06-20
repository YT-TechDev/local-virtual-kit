# Tracking Helper Process H2 Narrow Implementation Gate 3 Decision

## Status

Status: owner decision approving the third narrow H2 implementation gate after H2 Narrow Implementation Gate 2.
Scope: documentation-only decision record for a future narrow implementation PR.

This document does not implement anything. Runtime behavior remains unchanged by this decision record.
This approval is only for a future narrow implementation PR that adds CI-safe synthetic/smoke evidence
for unsafe helper diagnostics and unsafe helper-output fail-closed behavior.

## Owner Decision

Decision: Approve H2 Narrow Implementation Gate 3 — Unsafe helper diagnostics fail-closed smoke coverage.

This owner decision approves only H2 Narrow Implementation Gate 3: Unsafe helper diagnostics
fail-closed smoke coverage. This decision authorizes a future narrow implementation PR only within
the approved scope below.

This decision does **not** approve production diagnostics policy behavior, production H2 integration,
default helper runtime wiring, or any production fail-closed behavior.

## Relationship to Previous Gates

H2 Narrow Implementation Gate 1 and H2 Narrow Implementation Gate 2 are complete and closed. Do not
reopen Gate 1 or Gate 2.

- Gate 1: bounded private capture and high-volume child output safety.
- Gate 2: explicit smoke-path isolation and default-runtime guard coverage.
- Gate 3: unsafe helper diagnostics / unsafe helper-output fail-closed smoke evidence.

Gate 3 is the next safe narrow step after Gate 2. It is a synthetic/smoke-only evidence gate and does
not imply production readiness, local/manual readiness, webcam readiness, Electron readiness, OBS
readiness, or broad H2 runtime readiness.

## Approved Narrow Implementation Gate

A future implementation PR may add narrowly scoped Native Core synthetic/smoke evidence for unsafe
helper diagnostics or unsafe child output being treated as fail-closed within the smoke boundary.
The future work must prove that unsafe diagnostics do not contaminate public `lvk-tracker-core`
stdout and that helper stdout/stderr remain private to Native Core.

This approval is intentionally limited to CI-safe synthetic/smoke evidence. It does not approve a
production diagnostics-safety policy engine, production supervisor behavior, fallback MotionFrame
emission, or default runtime wiring.

## Allowed Future Implementation Scope

Allowed future implementation under Gate 3:

- Native Core only;
- synthetic/smoke-only;
- CI-safe unsafe diagnostics / unsafe helper-output cases;
- fail-closed smoke behavior for unsafe helper diagnostics or unsafe child output;
- evidence that public `lvk-tracker-core` stdout remains MotionFrame JSON only or empty on failure,
  never contaminated by helper diagnostics;
- evidence that helper stdout/stderr remain private to Native Core;
- minimal helper synthetic mode additions if needed;
- minimal smoke-check script updates if needed;
- minimal docs updates matching implemented evidence.

The future implementation should stay small, source-grounded, and reviewable. Any added or changed
checks must validate the fail-closed smoke boundary without relying on real camera frames,
helper-owned camera capture, Electron, Web Preview, OBS, or local/manual hardware evidence.

## Allowed Future Source Areas

Allowed source areas for the future implementation may include:

- existing synthetic helper source;
- existing helper process supervision smoke source;
- existing helper runtime smoke source;
- existing helper supervision / helper runtime smoke-check scripts;
- existing tracker-core smoke or option path only if needed to assert fail-closed smoke behavior;
- minimal native build/test configuration only if required.

If a future implementation agent names additional files, those files must exist and must be directly
required by the approved Native Core synthetic/smoke-only implementation slice.

## Required Future Evidence

The future implementation PR must report exact commands and results and should provide CI-safe
evidence that:

- unsafe helper diagnostics or unsafe helper output are exercised through synthetic/smoke-only cases;
- unsafe diagnostics fail closed within the smoke boundary;
- public `lvk-tracker-core` stdout remains MotionFrame JSON only, or empty on failure, and is never
  contaminated by helper diagnostics, helper lifecycle markers, policy errors, or unsafe child output;
- helper stdout and helper stderr remain private to Native Core;
- the smoke path remains synthetic-only and local-only;
- no production runtime behavior is claimed.

CI-safe synthetic checks can support the narrow Gate 3 claim. They do not prove production readiness,
local/manual readiness, webcam readiness, Electron readiness, OBS readiness, or broad H2 runtime
readiness.

## Non-goals / Still Unapproved

This owner decision does not approve, implement, or imply approval for:

- production H2 integration;
- default helper runtime wiring;
- default `lvk-tracker-core` H2 runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- fallback MotionFrame emission;
- MotionFrame schema changes;
- Motion Protocol changes;
- Electron changes;
- Web Preview changes;
- new dependencies;
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
- production readiness claims;
- local/manual readiness claims;
- webcam / Electron / OBS readiness claims.

## Required Reporting From Implementation Agent

The future implementation agent must report:

- the branch used;
- the files changed;
- the exact Gate 3 implementation slice completed;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that the change stayed Native Core synthetic/smoke-only;
- confirmation that no production H2 integration, default helper runtime wiring, default
  `lvk-tracker-core` H2 runtime wiring, production supervisor behavior, production diagnostics-safety
  policy engine, fallback MotionFrame emission, MotionFrame schema change, Motion Protocol change,
  Electron / Web Preview behavior, dependencies, telemetry, analytics, cloud upload, external frame
  processing, hidden network calls, new network behavior, camera access change, helper-owned camera
  capture, raw frame / pixel / tensor IPC, high-rate raw frame transport, real parent-to-child
  control channel, production forced termination, restart / backoff, backend / model / runtime
  selection, production readiness claim, local/manual readiness claim, or webcam / Electron / OBS
  readiness claim was added.

## Recommended Next Step

After this decision PR merges, create a Claude Code implementation prompt for H2 Narrow
Implementation Gate 3: Unsafe helper diagnostics fail-closed smoke coverage.

Do not proceed directly to production H2 integration.

## Cross-references

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 Narrow Implementation Gate 2 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md)
- [H2 smoke-path isolation guard closeout](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
- [H2 Narrow Implementation Gate 1 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
- [H2 high-volume bounded-capture smoke closeout](TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Development policy](DEVELOPMENT_POLICY.md)
