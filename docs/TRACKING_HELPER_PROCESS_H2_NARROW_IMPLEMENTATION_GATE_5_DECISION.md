# Tracking Helper Process H2 Narrow Implementation Gate 5 Decision

## Status

Status: owner decision approving the fifth narrow H2 implementation gate after H2 Narrow
Implementation Gate 4.
Scope: documentation-only decision record for a future narrow implementation PR.

This document does not implement anything. Runtime behavior remains unchanged by this decision record.
This approval is only for a future narrow implementation PR that adds CI-safe synthetic/smoke evidence
for the existing explicit helper runtime normal/success path.

## Owner Decision

Decision: Approve H2 Narrow Implementation Gate 5 — Helper runtime normal-path public stream guard coverage.

This owner decision approves only H2 Narrow Implementation Gate 5: Helper runtime normal-path public
stream guard coverage. This decision authorizes a future narrow implementation PR only within the
approved scope below.

This decision does **not** approve production H2 integration, default helper runtime wiring,
default `lvk-tracker-core` H2 runtime wiring, production helper supervisor behavior, or a production
diagnostics-safety policy engine.

## Relationship to Previous Gates

H2 Narrow Implementation Gate 1, H2 Narrow Implementation Gate 2, H2 Narrow Implementation Gate 3,
and H2 Narrow Implementation Gate 4 are complete and closed. Do not reopen Gate 1, Gate 2, Gate 3,
or Gate 4.

- Gate 1: bounded private capture and high-volume child output safety.
- Gate 2: explicit smoke-path isolation and default-runtime guard coverage.
- Gate 3: unsafe helper diagnostics fail-closed smoke evidence on the public stdout path.
- Gate 4: helper runtime failure-case public stdout guard coverage.
- Gate 5: helper runtime normal-path public stream guard coverage.

Gate 5 is the next safe narrow step after Gate 4. It is a synthetic/smoke-only evidence gate and does
not imply production readiness, local/manual readiness, webcam readiness, Electron readiness, OBS
readiness, or broad H2 runtime readiness.

The next safe step is **not** production H2 integration. The next safe step is a narrow future
implementation PR that proves the existing explicit helper runtime normal/success path preserves the
public stream boundary.

## Approved Narrow Implementation Gate

A future implementation PR may add narrowly scoped Native Core synthetic/smoke evidence for the
existing explicit `--helper-runtime-smoke` normal/success path. The future work must prove that, when
the explicit helper runtime smoke path succeeds normally, public `lvk-tracker-core` stdout remains
MotionFrame JSON only, public stderr remains safe parent diagnostics only if present, and helper child
stdout/stderr remain private to Native Core.

This approval is intentionally limited to CI-safe synthetic/smoke evidence for the existing explicit
normal/success path. It does not approve production H2 integration, default runtime wiring,
production supervisor behavior, production diagnostics policy behavior, fallback MotionFrame
emission, or any MotionFrame / Motion Protocol change.

## Allowed Future Implementation Scope

Allowed future implementation under Gate 5:

- Native Core only;
- synthetic/smoke-only;
- CI-safe checks for the existing explicit `--helper-runtime-smoke` normal/success path;
- evidence that public `lvk-tracker-core` stdout remains MotionFrame JSON only on the normal helper
  runtime smoke path;
- evidence that helper lifecycle markers, helper diagnostics, raw child stderr, child stdout JSON,
  policy/error text, unsafe child output, and smoke-only markers do not contaminate public stdout;
- evidence that public stderr, if non-empty, contains only safe parent diagnostics and does not
  forward helper child stdout/stderr;
- evidence that helper stdout/stderr remain private to Native Core;
- minimal smoke-check script updates if needed;
- minimal docs updates matching implemented evidence.

Prefer test/checker coverage over changing C++ behavior if the existing helper runtime normal path
already supports the needed evidence.

The future implementation should stay small, source-grounded, and reviewable. Any added or changed
checks must validate the explicit normal/success smoke-path public stream boundary without relying on
real camera frames, helper-owned camera capture, Electron, Web Preview, OBS, or local/manual hardware
evidence.

## Allowed Future Source Areas

Allowed source areas for the future implementation may include:

- existing helper runtime smoke-check script;
- existing helper runtime smoke source only if source inspection proves a tiny smoke-only adjustment
  is required;
- existing synthetic helper source only if needed for an already-supported synthetic success mode;
- existing tracker-core explicit smoke option path only if needed to assert public stream behavior;
- minimal native build/test configuration only if required.

If a future implementation agent names additional files, those files must exist and must be directly
required by the approved Native Core synthetic/smoke-only implementation slice.

## Required Future Evidence

The future implementation PR must report exact commands and results and should provide CI-safe
evidence that:

- the existing explicit helper runtime normal/success path is exercised through synthetic/smoke-only
  checks;
- public `lvk-tracker-core` stdout remains MotionFrame JSON only on the normal helper runtime smoke
  path;
- public stdout is never contaminated by helper lifecycle markers, helper diagnostics, raw child
  stderr, child stdout JSON, policy/error text, unsafe child output, or smoke-only markers;
- public stderr, if non-empty, contains only safe parent diagnostics and never forwards helper child
  stdout or helper child stderr;
- helper stdout and helper stderr remain private to Native Core;
- the smoke path remains explicit, synthetic-only, and local-only;
- no production runtime behavior is claimed.

CI-safe synthetic checks can support the narrow Gate 5 claim. They do not prove production readiness,
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
- new fallback MotionFrame behavior;
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
- the exact Gate 5 implementation slice completed;
- validation commands run and exact results;
- skipped checks and reasons;
- confirmation that the change stayed Native Core synthetic/smoke-only;
- confirmation that no production H2 integration, default helper runtime wiring, default
  `lvk-tracker-core` H2 runtime wiring, production supervisor behavior, production diagnostics-safety
  policy engine, fallback MotionFrame emission, new fallback MotionFrame behavior, MotionFrame schema
  change, Motion Protocol change, Electron / Web Preview behavior, dependencies, telemetry,
  analytics, cloud upload, external frame processing, hidden network calls, new network behavior,
  camera access change, helper-owned camera capture, raw frame / pixel / tensor IPC, high-rate raw
  frame transport, real parent-to-child control channel, production forced termination, restart /
  backoff, backend / model / runtime selection, production readiness claim, local/manual readiness
  claim, or webcam / Electron / OBS readiness claim was added.

## Recommended Next Step

After this decision PR merges, create a Claude Code implementation prompt for H2 Narrow
Implementation Gate 5: Helper runtime normal-path public stream guard coverage.

Do not proceed directly to production H2 integration.

## Cross-references

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 Narrow Implementation Gate 4 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md)
- [H2 helper runtime failure-case public-stdout guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md)
- [H2 Narrow Implementation Gate 3 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md)
- [H2 unsafe-diagnostics public-stdout smoke closeout](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md)
- [H2 Narrow Implementation Gate 2 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md)
- [H2 smoke-path isolation guard closeout](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
- [H2 Narrow Implementation Gate 1 decision](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
- [H2 high-volume bounded-capture smoke closeout](TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
- [H2 helper supervisor policy proposal](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Development policy](DEVELOPMENT_POLICY.md)
