# Tracking Helper Process H2 Production Runtime Supervisor Policy Proposal

## Status

Status: docs-only H2 production-runtime supervisor policy proposal under Option B.
Scope: proposes a future fail-closed supervisor policy for helper-process lifecycle failures.

This document implements nothing and approves no production behavior. Production H2 integration,
default `lvk-tracker-core` runtime wiring, backend / model / runtime selection, real camera access,
fallback MotionFrame emission, retry / backoff behavior, MotionFrame schema changes, Motion Protocol
changes, Electron / Web Preview changes, dependencies, and readiness claims remain separately gated
and unapproved.

## Purpose

#426 recorded the v0.3 backend prototype entry decision. #405 recorded the owner decision for Option
B: docs-only production-runtime planning may proceed, while implementation remains separately gated.
#428 was closed as duplicate of the existing fallback MotionFrame behavior proposal. #400 remains
open.

This proposal answers the supervisor-policy questions that a later implementation gate would need to
settle before any production helper runtime is approved. It is intentionally decision-oriented but
planning-only.

## Recommended Future Policy

A future production supervisor should be designed around a **fail-closed Native Core boundary**:
helper lifecycle failures must not leak helper output, diagnostics, partial protocol records, runtime
selection details, or backend-specific state onto public `lvk-tracker-core` stdout. Public stdout must
remain MotionFrame JSON only.

Recommended classifications for later approval:

- **Helper launch failure:** treat as a terminal supervisor failure for that helper run. Do not emit
  helper diagnostics on public stdout. Do not imply automatic fallback MotionFrame emission unless a
  separate fallback implementation gate approves it.
- **No `ready` in time:** treat as a bounded ready-timeout failure. The timeout value must be
  owner-configured or owner-approved later; this proposal does not choose one.
- **Slow or missing result frames:** treat as degraded or failed helper liveness according to a later
  approved timeout budget. Until fallback behavior is separately approved, the safe boundary is to
  stop trusting the helper output rather than inventing MotionFrame fields or renderer-visible helper
  state.
- **Unexpected helper exit:** treat as terminal for that helper run unless a later owner-approved
  retry policy classifies the exit as restartable.
- **Invalid, malformed, unknown, oversized, high-volume, binary, or unsafe helper output:** treat as
  untrusted private input and fail closed at the Native Core boundary. It must not corrupt public
  MotionFrame stdout.

## Retry / Backoff Recommendation

Retry and backoff should be **disabled by default unless separately approved and configured**. If a
future implementation gate approves retry, it should be bounded by an explicit retry budget, delay /
backoff cap, and diagnostics policy. It should not be immediate or unbounded by default, and this
proposal does not approve implementation of restart, relaunch, or backoff behavior.

## Diagnostics and Stream Boundaries

Allowed diagnostics, if later implemented, are local-only, bounded, privacy-safe metadata on stderr
or an equivalent private Native Core diagnostic surface. Safe metadata may include high-level event
classes such as launch failure, ready timeout, result timeout, helper exit, malformed output,
oversized output, or retry-budget exhaustion, provided future policy defines redaction, truncation,
size, count, and rate limits.

Helper stdout and helper stderr remain private to Native Core. Public `lvk-tracker-core` stdout must
never contain:

- helper logs, lifecycle markers, ready messages, stack traces, parse errors, policy errors, or retry
  messages;
- camera frames, images, raw pixels, tensors, landmarks outside the approved MotionFrame contract,
  model outputs, secrets, environment variables, private local paths, machine identifiers, or user
  identifying information;
- backend / model / runtime selection details;
- non-MotionFrame JSON, partial JSON, binary data, or any MotionFrame schema extension not separately
  approved by a Motion Protocol decision.

## Smallest Later Implementation Slice

If this proposal is accepted, the smallest later implementation slice should still require a separate
owner-approved implementation gate. A safe first slice would be a CI-safe synthetic supervisor test
and implementation for **one terminal fail-closed condition only**, such as helper launch failure or
ready timeout, proving that:

- public stdout remains MotionFrame JSON only;
- helper stdout and stderr remain private;
- diagnostics are bounded and privacy-safe;
- no fallback MotionFrame is emitted unless separately approved;
- no backend dependency, model/task/cascade file, camera access, runtime selection, default runtime
  wiring, raw frame IPC, Electron change, Web Preview change, MotionFrame schema change, or Motion
  Protocol change is introduced.

## Non-Goals

This proposal does not approve, implement, or imply approval for production H2 integration, default
runtime wiring, production supervisor behavior, fallback MotionFrame behavior, retry / backoff,
parent-to-child control channels, forced termination, backend / model / runtime selection, camera
access, helper-owned capture, raw frame / pixel / tensor IPC, high-rate raw frame transport,
MotionFrame schema changes, Motion Protocol changes, Electron / Web Preview changes, dependencies,
telemetry, analytics, cloud upload, external frame processing, hidden network calls, new network
behavior, or POSIX / webcam / Electron / OBS readiness claims.

## Cross-References

- [Tracking backend v0.3 prototype entry decision](TRACKING_BACKEND_V0_3_PROTOTYPE_ENTRY_DECISION.md)
- [H2 production-runtime owner decision record](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md)
- [H2 production-runtime planning gate](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
- [H2 fallback MotionFrame behavior proposal](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
- [H2 diagnostics / stdout / stderr safety planning](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
