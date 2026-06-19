# Tracking Helper Process H2 Process Lifecycle Scope Gate

## Status

Status: docs-only process lifecycle scope gate.
Scope: documents the process lifecycle decisions required before production H2 helper process
lifecycle work can begin.

This document implements nothing. It follows the post-synthetic next-scope gate, the frame /
data-flow decision, and the helper backend / runtime decision. It does not approve production
process lifecycle behavior, real helper stop / control-channel behavior, production forced
termination, shutdown timeout policy, restart / backoff, production H2 integration, or default
runtime wiring.

## Why This Gate Exists

H2 synthetic smoke validated bounded synthetic lifecycle paths only. That coverage is useful for
state reconstruction and private helper-output safety, but it is not production process lifecycle
policy.

Production process lifecycle is broader than synthetic smoke. It includes startup, ready handshake,
running behavior, failure, timeout, shutdown, stop / control, termination, fallback, restart /
backoff, and diagnostics. Accidental production lifecycle behavior can affect user trust, privacy,
stability, and the safety of `lvk-tracker-core` public stdout. This gate keeps lifecycle policy
behind explicit future approval before any production helper lifecycle implementation begins.

## Current Approved State

- H2 synthetic smoke lifecycle coverage exists at the synthetic-smoke level.
- No production H2 integration exists.
- No default `lvk-tracker-core` helper runtime wiring exists.
- No real parent-to-child control channel exists.
- No production shutdown semantics exist.
- No production forced termination exists.
- No production restart / backoff exists.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout and stderr remain private to Native Core.

## Required Future Process Lifecycle Decisions

The following decisions are required before production helper process lifecycle work begins. This
scope gate records the required decision areas but does not answer them.

- Startup policy.
- Ready handshake policy.
- Runtime health / liveness policy.
- Failure classification.
- Timeout policy.
- Shutdown / stop / control-channel policy.
- Forced termination policy.
- Restart / backoff policy.
- Fallback behavior.
- Diagnostics and safe error reporting.
- Public stdout safety.
- Local / manual validation requirements.
- Cross-platform behavior expectations.

## Production Shutdown / Control Questions

- Is a real parent-to-child stop / control channel needed?
- If yes, what transport is allowed?
- What messages are allowed?
- How is shutdown bounded?
- What happens if the helper ignores stop?
- Is forced termination allowed?
- How are shutdown timeout and fallback represented?
- What diagnostics are safe?
- What must never reach public stdout?

## Restart / Backoff Questions

- Is automatic restart allowed?
- What failures are restartable?
- What backoff strategy is safe?
- What maximum retry budget is allowed?
- How does fallback behave after retries?
- How is user-visible status surfaced?
- How is repeated crash behavior prevented?

## Explicitly Out of Scope

- Production helper process lifecycle implementation.
- Real stop / control-channel implementation.
- Production forced termination.
- Production shutdown timeout policy.
- Restart / backoff implementation.
- Default runtime wiring.
- Production H2 integration.
- Backend / model / runtime selection.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- MotionFrame schema changes.
- Electron / Web Preview / Motion Protocol changes.
- New dependencies.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior.

## Acceptance Criteria Before Process Lifecycle Implementation

A future implementation gate may start only after all of the following are true:

- The product owner explicitly approves the lifecycle scope.
- Startup / ready policy is documented.
- Failure / timeout classification is documented.
- Shutdown / control policy is documented.
- Forced termination policy is explicitly approved or rejected.
- Restart / backoff policy is explicitly approved or rejected.
- Fallback behavior is documented.
- Public stdout safety validation is documented.
- Helper stdout / stderr privacy is documented.
- Local / manual validation requirements are documented.
- Cross-platform expectations are documented.
- Local-first / privacy boundaries remain intact.

## Relationship To Other H2 Decisions

- This document does not choose a backend, model, or runtime.
- This document does not approve frame transport.
- This document does not approve Electron UI.
- This document does not approve MotionFrame changes.
- Production runtime integration must remain a separate future gate.

## Recommended Next Step

Perform a read-only review of this gate. Then choose one narrow next planning direction before any
implementation:

- `production-runtime-scope-gate`
- `validation-scope-gate`
- `electron-user-facing-scope-gate`

Do not proceed directly to implementation from this document.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 post-synthetic next-scope gate](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
- [H2 frame / data-flow decision](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
- [H2 helper backend / runtime decision](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md)
- [H2 synthetic smoke phase handoff](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
- [H2 shutdown control scope gate](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
- [H2 synthetic shutdown smoke plan](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
- [H2 handshake state machine](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
- [H2 pipe framing contract](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
- H2 native helper contract: no current document exists in `docs/` with this title.
- [Tracking spec](TRACKING_SPEC.md)
- [Motion Protocol](MOTION_PROTOCOL.md)
- [Local runtime checklist](LOCAL_RUNTIME_CHECKLIST.md)
