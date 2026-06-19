# Tracking Helper Process H2 Post-Synthetic Next-Scope Gate

## Status

Status: H2 docs-only post-synthetic next-scope gate.
Scope: documentation-only gate after the H2 synthetic smoke phase handoff.

This document implements nothing. It follows the H2 synthetic smoke phase handoff and defines the
decisions that must be made before any production H2 work begins.

This gate does **not** approve production H2 integration, default `lvk-tracker-core` runtime wiring,
real frame access, production shutdown / control, production forced termination, production shutdown
timeout policy, restart / backoff, MotionFrame changes, Electron / Web Preview changes, dependencies,
telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
behavior.

## Why This Gate Exists

H2 synthetic smoke coverage is complete at the synthetic-smoke level. The next work is no longer
"add another synthetic vector." Moving toward production runtime behavior is a larger architecture and
product decision because it affects runtime selection, backend / model dependencies, frame ownership,
process lifecycle policy, validation claims, and user-facing controls.

This gate prevents accidental drift from completed synthetic smoke coverage into production H2
integration. It keeps production wiring, real helper shutdown / control behavior, real frame access,
and backend/runtime integration behind explicit decisions. It also preserves LVK's local-first and
privacy boundaries before any runtime work is attempted.

## Completed State Before This Gate

- H2 synthetic smoke phase is complete at the synthetic-smoke level.
- H2 synthetic shutdown smoke group is complete.
- Final readiness review result: **ready** with **no blocking issues** on latest main after PR #168.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout / stderr remain private to Native Core.
- No production H2 integration exists.
- No default `lvk-tracker-core` runtime wiring exists.
- No real frame access exists.
- No MotionFrame schema change exists.

## Required Decisions Before Any Production H2 Work

The categories below must be answered later. This gate records the questions only; it does not answer
or approve them.

### A. Runtime integration decision

- Whether H2 should ever be wired into default `lvk-tracker-core`.
- How H2 would be selected, enabled, disabled, and safely fall back.
- Whether H2 remains opt-in, feature-gated, or experimental.

### B. Backend / model / runtime decision

- Which helper backend, if any, is allowed.
- Whether any model / task bundle is needed.
- How dependencies are handled without surprising users.

### C. Frame ownership and data-flow decision

- Native Core remains the only camera owner unless explicitly changed.
- Camera frames must stay local.
- No helper-owned camera capture unless separately approved.
- No raw frame / pixel / tensor IPC unless separately approved.
- Any frame or data flow must be explicitly documented before implementation.

### D. Public protocol decision

- MotionFrame remains stable.
- No MotionFrame schema change unless separately scoped with docs and tests.
- Web Preview consumes MotionFrame only.

### E. Process lifecycle decision

- Whether production helper startup / shutdown semantics are needed.
- Whether real stop / control-channel behavior is needed.
- Whether production shutdown timeout policy is needed.
- Whether production forced termination is needed.
- Whether restart / backoff is needed.
- None of these are approved by this gate.

### F. Validation decision

- What local / manual checks are required.
- What CI checks are safe.
- What cannot be claimed from headless or Codex environments.
- How public stdout safety will be validated.

### G. User-facing / Electron decision

- Whether any Electron settings or calibration UI is needed.
- How the native process lifecycle would be surfaced safely.
- No Electron changes are approved by this gate.

## Explicitly Out of Scope

- production H2 integration
- default `lvk-tracker-core` helper runtime wiring
- real helper stop / control-channel implementation
- production process lifecycle / shutdown policy
- production forced termination
- production shutdown timeout policy
- restart / backoff
- backend / model / runtime selection implementation
- real camera / frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate frame transport
- MotionFrame schema changes
- Electron / Web Preview / Motion Protocol changes
- new dependencies
- telemetry / analytics / cloud upload / network behavior

## Acceptance Criteria Before Leaving Synthetic-Only Scope

A future implementation gate may start only after:

- the product owner explicitly approves the next H2 scope;
- the runtime integration decision is documented;
- the backend / runtime / model decision is documented;
- the frame ownership / data-flow decision is documented;
- the process lifecycle / shutdown / restart decision is documented;
- validation expectations are documented;
- local-first / privacy boundaries remain intact;
- public stdout remains MotionFrame JSON only;
- helper stdout / stderr privacy remains intact;
- MotionFrame changes remain out of scope unless explicitly approved.

## Recommended Next Step

First, perform a read-only review of this gate.

Then choose one narrow next planning direction, not implementation:

- `production-runtime-scope-gate`
- `helper-backend-runtime-decision`
- `frame-data-flow-decision`
- `process-lifecycle-scope-gate`

Do not create those additional documents in this PR. Do not proceed directly to implementation.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
  — handoff for the completed H2 synthetic smoke phase.
- [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the final synthetic shutdown smoke vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — shutdown / control-channel scope gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — synthetic shutdown smoke plan.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — design-only handshake and state machine.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — design-only pipe framing contract.
- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first IPC direction decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — frame ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — Native helper prototype implementation gate.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation claim rules.
