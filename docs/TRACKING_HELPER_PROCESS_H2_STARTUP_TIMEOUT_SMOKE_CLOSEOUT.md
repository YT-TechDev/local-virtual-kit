# Tracking Helper Process H2 Startup-Timeout Smoke Closeout

## Status

Status: H2 startup-timeout synthetic smoke vector closeout.
Scope: documentation-only closeout for PR #149.

The startup-timeout synthetic vector is now **implemented** as an additional case in the existing
`lvk-helper-h2-state-machine-smoke` executable. This closeout document records that
implementation state only. It **does not implement anything**, authorizes no production
integration, grants no real frame access, adds no dependency, and changes no MotionFrame schema.

## Implemented Slice

PR #149 added the `startup_timeout_fallback` synthetic vector to the existing H2 state-machine
smoke:

- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added
  `runStartupTimeoutCase(...)`, registered alongside the existing normal / failure / timeout
  cases.
- `native/tracker-core/src/synthetic_helper_main.cpp` — added a bounded, synthetic-only
  `--delay-ready-ms N` option (range `0..600000`, default `0`). When `0` the helper announces
  readiness immediately, preserving prior behavior; when `> 0` it emits a safe `[helper]`
  diagnostic and sleeps before emitting the `ready` line so a bounded startup timeout can be
  exercised.
- No `CMakeLists.txt` change was required: both files are already compiled into existing targets.
- It continues to launch the existing `lvk-synthetic-helper` through the existing
  `runHelperProcessForSmoke(...)` bounded supervisor and reconstructs the designed H2 helper
  lifecycle state path from the supervised run result.
- It is **not** wired into the default `lvk-tracker-core` runtime.

## Covered Startup-Timeout Vector

The new case validates a single synthetic lifecycle state path:

- **startup timeout (pure):**
  `not_started -> launching -> waiting_for_ready -> timed_out -> fallback`

This models a **pure startup timeout**, where the helper does **not** emit `ready` before the
bounded startup timeout fires. The case uses `--delay-ready-ms` (set well above the bounded
timeout) so the supervisor terminates the helper while it is still in `waiting_for_ready`. The
case asserts that **no `ready` marker** appears on the helper's stdout and that the timeout was
detected; `ready` / `running` are never appended to the reconstructed path.

## Relationship to the Earlier Timeout Vector

The earlier timeout vector (covered by PR #147, recorded in
[`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md))
remains a **liveness / silence after `ready` / `running`** timeout:
`not_started -> launching -> waiting_for_ready -> ready -> running -> timed_out -> fallback`. In
that case the synthetic helper emits and flushes its `ready` line and the first `result` before
its first sleep, so those markers are deterministically captured before the bounded timeout
fires.

The two vectors are intentionally distinct:

- **Liveness / silence timeout (PR #147):** `ready` and `running` are reached, then the helper
  goes silent → `timed_out` → `fallback`.
- **Startup timeout (PR #149):** `ready` is never observed before the bounded startup timeout →
  `timed_out` → `fallback` directly from `waiting_for_ready`.

## Verification Recorded in PR #149

The following was recorded in PR #149. It is summarized here as a **historical summary only** and
is **not** re-run or re-claimed by this documentation-only closeout:

- CMake configure passed.
- CMake build passed.
- `lvk-helper-h2-state-machine-smoke` passed (exit 0; smoke stdout empty; four state paths
  printed as safe `[h2-state-machine-smoke]` stderr diagnostics, including the new
  `waiting_for_ready -> timed_out -> fallback` startup-timeout path).
- The existing `lvk-helper-process-supervision-smoke` regression passed.
- The native tracker output check (`tools/check-native-tracker-output.mjs`) passed
  (`lvk-tracker-core` public stdout remained MotionFrame JSON only).
- `pnpm format:check` was **not run** in PR #149 because it was a C++-only change with no
  Prettier-covered files (Prettier does not format C++).

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
- The `--delay-ready-ms` option is bounded and synthetic-only; it adds no camera, file, socket,
  or network behavior.
- No telemetry / analytics / cloud upload / new network behavior.

## What Remains Not Implemented

The following remain **not implemented / not approved**:

- production H2 integration
- default `lvk-tracker-core` helper runtime integration / runtime wiring
- shutdown / control-channel vectors
- malformed / unknown / oversized helper-output error vectors
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

- **Option A:** another small synthetic-only H2 implementation slice (for example a narrowly
  scoped helper-output error vector group), bounded by the implementation gate and owner
  decision.
- **Option B:** a docs decision / gate for the next H2 slice before any broader integration.
- Shutdown / control-channel vectors require a separate scope decision before implementation,
  because they introduce parent-to-child stop / control semantics not present in the current
  smoke.
- This closeout **does not authorize** production integration, real frame access, or default
  runtime wiring. Any broader step requires its own scope and explicit project-owner approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147), including the earlier
  liveness / silence timeout vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and helper state machine the smoke exercises.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and representative test vectors (`startup_timeout_fallback`).
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
