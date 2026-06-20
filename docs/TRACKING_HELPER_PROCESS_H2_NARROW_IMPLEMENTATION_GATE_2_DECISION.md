# Tracking Helper Process H2 Narrow Implementation Gate 2 Decision

## Status

Status: owner decision approving the second narrow H2 implementation gate after H2 Narrow Implementation Gate 1.
Scope: documentation-only decision record for a future narrow implementation PR.

This document does not implement anything. Runtime behavior remains unchanged by this decision record.
This approval is only for a future narrow implementation PR that strengthens or documents test evidence
around the explicit smoke path boundary.

## Owner Decision

Decision: Approve H2 Narrow Implementation Gate 2 — Explicit smoke-path isolation and default-runtime guard coverage.

This owner decision approves only H2 Narrow Implementation Gate 2: Explicit smoke-path isolation and
default-runtime guard coverage. This decision authorizes a future narrow implementation PR only within
the approved scope below.

## Relationship to Gate 1

H2 Narrow Implementation Gate 1 is complete and closed. Do not reopen Gate 1.

Gate 1 closed the bounded private capture and high-volume synthetic output safety slice. Gate 2 is a
different, narrower follow-up focused on proving and preserving the boundary around the explicit smoke
path.

- Gate 1: bounded capture and high-volume child output safety.
- Gate 2: explicit smoke-path isolation and default-runtime guard coverage.

Gate 2 does not imply production readiness, local/manual readiness, webcam readiness, Electron
readiness, OBS readiness, or broad H2 runtime readiness.

## Approved Narrow Implementation Gate

A future implementation PR may use narrowly scoped Native Core synthetic/smoke work to prove:

- helper supervision behavior is only entered through explicit smoke paths;
- omitting the smoke path keeps the default runtime path unchanged;
- default `lvk-tracker-core` runtime does not accidentally enter helper supervision;
- helper stdout/stderr remain private to Native Core in smoke paths;
- public `lvk-tracker-core` stdout remains MotionFrame JSON only for default runtime behavior;
- the smoke path remains synthetic-only and local-only.

This approval is intentionally limited to evidence around smoke-path isolation and default-runtime
guards. It does not approve production H2 integration or default helper runtime wiring.

## Allowed Future Implementation Scope

Allowed future implementation under Gate 2:

- Native Core only;
- synthetic/smoke-only;
- explicit smoke-path isolation checks;
- default-runtime guard coverage;
- minimal smoke/test wiring if needed;
- minimal docs updates matching the implemented evidence.

The future implementation should stay small, source-grounded, and reviewable. Any added or changed
checks must validate the boundary without relying on real camera frames, helper-owned camera capture,
Electron, Web Preview, OBS, or local/manual hardware evidence.

## Allowed Future Source Areas

Allowed source areas for the future implementation may include:

- existing helper runtime smoke source;
- existing helper process supervision smoke source;
- existing tracker-core option / main path only if necessary to assert or preserve the smoke-path guard;
- existing native smoke-check scripts if needed;
- minimal native build/test configuration only if required.

If a future implementation agent names additional files, those files must exist and must be directly
required by the approved Native Core synthetic/smoke-only implementation slice.

## Required Future Evidence

The future implementation PR must report exact commands and results and should provide CI-safe evidence
that:

- helper supervision is reachable only through explicit smoke-path invocation;
- default `lvk-tracker-core` execution with the smoke path omitted does not enter helper supervision;
- helper stdout and stderr remain private to Native Core for smoke paths;
- default public stdout remains MotionFrame JSON only;
- no helper diagnostics, lifecycle markers, policy errors, or unsafe child output are forwarded to
  public MotionFrame stdout;
- the smoke path remains synthetic-only and local-only;
- no production runtime behavior is claimed.

CI-safe synthetic checks can support the narrow Gate 2 claim. They do not prove production readiness,
local/manual readiness, webcam readiness, Electron readiness, OBS readiness, or broad H2 runtime
readiness.

## Non-goals / Still Unapproved

This owner decision does not approve, implement, or imply approval for:

- production H2 integration;
- default helper runtime wiring;
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
- production readiness claims;
- local/manual readiness claims;
- webcam / Electron / OBS readiness claims.

## Required Reporting From Implementation Agent

The future implementation agent must report:

- the branch used;
- the files changed;
- the exact Gate 2 implementation slice completed;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that the change stayed Native Core synthetic/smoke-only;
- confirmation that no production H2 integration, default helper runtime wiring, production
  supervisor behavior, production diagnostics-safety policy engine, fallback MotionFrame emission,
  MotionFrame schema change, Motion Protocol change, Electron / Web Preview behavior, dependencies,
  telemetry, analytics, cloud upload, external frame processing, hidden network calls, new network
  behavior, camera access change, helper-owned camera capture, raw frame / pixel / tensor IPC,
  high-rate raw frame transport, production readiness claim, local/manual readiness claim, or webcam /
  Electron / OBS readiness claim was added.

## Recommended Next Step

After this decision PR merges, create a Claude Code implementation prompt for H2 Narrow
Implementation Gate 2: Explicit smoke-path isolation and default-runtime guard coverage.

Do not proceed directly to production H2 integration.

## Cross-references

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 Narrow Implementation Gate 1 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
- [H2 high-volume bounded-capture smoke closeout](TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Development policy](DEVELOPMENT_POLICY.md)
