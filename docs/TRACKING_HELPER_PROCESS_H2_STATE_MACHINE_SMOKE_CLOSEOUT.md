# Tracking Helper Process H2 State Machine Smoke Closeout

## Status

Status: H2 synthetic state-machine smoke implementation closeout.
Scope: documentation-only closeout for PR #147.

The first scoped, synthetic-only H2 implementation slice is now **implemented**:
`lvk-helper-h2-state-machine-smoke`. This closeout document records that implementation state
only. It **does not implement anything**, authorizes no production integration, grants no real
frame access, adds no dependency, and changes no MotionFrame schema.

## Implemented Slice

PR #147 added the first synthetic-only H2 implementation slice:

- `lvk-helper-h2-state-machine-smoke` — a standalone Native Core synthetic smoke executable.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — the smoke source.
- A CMake target in `native/tracker-core/CMakeLists.txt` (links the new source and the existing
  `src/helper_process_supervisor.cpp`; no OpenCV).
- It launches the existing `lvk-synthetic-helper` through the existing
  `runHelperProcessForSmoke(...)` bounded supervisor and reconstructs the designed H2 helper
  lifecycle state path from the supervised run result plus the helper's known stdout lifecycle
  markers.
- It is **not** wired into the default `lvk-tracker-core` runtime.

## Covered State Vectors

The smoke validates three synthetic lifecycle state paths:

- **normal:**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`
- **helper non-zero exit:**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`
- **timeout / silence after running:**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> timed_out -> fallback`

The timeout case is modeled as a **liveness / silence after running** timeout, not a pure
startup timeout: the synthetic helper emits and flushes its `ready` line and the first `result`
before its first sleep, so those markers are deterministically captured before the bounded
timeout fires. `ready` / `running` are included in the reconstructed path only when their
markers are present.

## Verification Recorded in PR #147

The following was recorded in PR #147. It is summarized here and **not** re-run or re-claimed by
this documentation-only closeout:

- CMake configure passed.
- CMake build passed.
- `lvk-helper-h2-state-machine-smoke` passed (exit 0; smoke stdout empty; three state paths
  printed as safe `[h2-state-machine-smoke]` stderr diagnostics).
- The existing `lvk-helper-process-supervision-smoke` regression passed.
- The native tracker output check (`tools/check-native-tracker-output.mjs`) passed
  (`lvk-tracker-core` public stdout remained MotionFrame JSON only).
- `pnpm format:check` was **not run** in PR #147 because no docs / Prettier-covered files changed
  (Prettier does not format C++).

This closeout PR is documentation-only; its own `pnpm format:check` result is recorded in the PR
body.

## Safety Boundaries Preserved

- Synthetic-only.
- No camera access.
- No real frames, pixels, or tensors.
- No helper-owned camera capture.
- No new dependency.
- No MotionFrame schema change.
- No Electron / Web Preview / Motion Protocol changes.
- No default runtime integration.
- Helper stdout / stderr remain private to Native Core (never forwarded to public stdout).
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / new network behavior.

## What Remains Not Implemented

The following remain **not implemented / not approved**:

- production H2 integration
- default `lvk-tracker-core` helper runtime integration
- real frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate raw frame transport
- restart / backoff implementation
- production backend selection
- MediaPipe / Python runtime / ONNX Runtime production approval
- model or task bundling
- MotionFrame schema changes
- Electron / Web Preview integration
- manual local validation execution

## Recommended Next Step

- **Option A:** another small synthetic-only H2 implementation slice (for example additional
  error / shutdown vectors), bounded by the implementation gate and owner decision.
- **Option B:** a docs decision / gate for the next H2 slice before any broader integration.
- This closeout **does not authorize** production integration, real frame access, or default
  runtime wiring. Any broader step requires its own scope and explicit project-owner approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — scoped prototype implementation-gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)
  — owner decision approving the synthetic-only scoped prototype.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and helper state machine the smoke exercises.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and representative test vectors.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
