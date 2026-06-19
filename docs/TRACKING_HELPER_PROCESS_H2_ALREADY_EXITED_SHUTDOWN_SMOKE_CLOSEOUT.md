# Tracking Helper Process H2 Already-Exited Shutdown Smoke Closeout

## Status

Status: H2 already-exited shutdown synthetic smoke vector closeout.
Scope: documentation-only closeout for the `shutdown_after_helper_already_exited` synthetic
smoke vector.

The `shutdown_after_helper_already_exited` vector is now **implemented** as an additional
synthetic-only case in `lvk-helper-h2-state-machine-smoke`. This closeout document records
that implementation state only. It **does not implement anything**, authorizes no production
integration, grants no real frame access, adds no dependency, and changes no MotionFrame
schema.

It is implemented at the **synthetic-smoke / test-only** level only. It does **not** implement
production shutdown / control behavior.

## Implemented Slice

Following the already-exited shutdown smoke gate
([`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md)),
which narrowed the next synthetic shutdown slice to only
`shutdown_after_helper_already_exited`:

- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added the
  `shutdown_after_helper_already_exited` smoke case:
  - runs the synthetic helper on its normal clean-completion path (`--frames 3`); **no new
    helper flag and no helper change**;
  - reconstructs the normal terminal lifecycle from captured private helper stdout plus exit
    status (`ready` marker, `result` marker, exit code 0, `stopped` marker);
  - after confirming the helper has already reached a clean terminal `exited` state, applies a
    smoke-local / test-only **after-exit stop observation**
    (`applyAfterExitStopObservation`), a pure no-op over the already-reconstructed lifecycle
    path;
  - asserts the observation is **safe and idempotent**: applied repeatedly it must leave the
    reconstructed path unchanged (no new state appended, path equals the pre-observation path);
  - emits **no marker**; the helper's stdout stays private and this smoke's own stdout stays
    empty.
- No `synthetic_helper_main.cpp` change.
- No `helper_process_supervisor` behavior change.
- No new `HelperState` value was added (an after-exit stop is a no-op, not a new lifecycle
  state).
- No default `lvk-tracker-core` runtime behavior was changed.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol behavior was changed.
- No CMake target was added (the case extends the existing
  `lvk-helper-h2-state-machine-smoke`).

## Covered Vector

- **Implemented case:** `shutdown_after_helper_already_exited`
- **Expected state path:**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`

The path is identical to the normal case: a stop / shutdown observation made after a clean
exit changes nothing.

### Honest scope note: how the after-exit observation is modeled

There is **no** real parent-to-child control channel in code, and this slice does not add one.
The "after-exit stop observation" is modeled as a **pure, smoke-local / test-only function**
(`applyAfterExitStopObservation`) over the already-reconstructed lifecycle path — it is **not**
a real parent `stop` exchange, **not** production IPC, and emits **no** marker. Because the
helper has already exited, the observation is a safe no-op: it appends no state, leaves the
path unchanged, and is idempotent under repeated application. The case applies it twice and
asserts the path is unchanged both times.

This closeout does **not** claim a `stop` control message, a real shutdown handshake, forced
termination, shutdown timeout, fallback, restart / backoff, or production supervisor shutdown
semantics.

## What This Vector Does Not Do

This vector intentionally does **not**:

- implement production shutdown / control behavior;
- implement a real parent-to-child `stop` control channel or general stdin control framework;
- implement forced termination;
- implement shutdown timeout behavior;
- implement failure / timeout-after-stop (`shutdown_after_failure_or_timeout`) handling;
- implement `shutdown_timeout_forced_exit`;
- implement restart / backoff;
- implement production supervisor shutdown semantics;
- introduce fallback behavior;
- wire H2 into the default `lvk-tracker-core` runtime.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr
remain **private to Native Core**.

## Validation Run

The following checks were run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `git status --short` and `git diff --check` — clean (no whitespace errors).
- `cmake -S native/tracker-core -B native/tracker-core/build` — configure succeeded.
- `cmake --build native/tracker-core/build` — build succeeded for all targets (one pre-existing
  C4819 code-page warning in `helper_process_supervisor.h`, unrelated to this change).
- `lvk-helper-h2-state-machine-smoke.exe lvk-synthetic-helper.exe` — exit 0, all **9** cases
  passed, including `shutdown_after_helper_already_exited` with the path
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`.
- `lvk-helper-process-supervision-smoke.exe lvk-synthetic-helper.exe` — exit 0 (no regression).
- `node tools/check-native-tracker-output.mjs .../lvk-tracker-core.exe` — exit 0; emitted valid
  MotionFrame JSON only (public stdout unchanged).
- `npx prettier --check` on the changed docs — pass.

## Safety Boundaries Preserved

- Synthetic-only.
- No camera access.
- No real frames, pixels, or tensors.
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No high-rate raw frame transport.
- No new dependency.
- No real parent-to-child control channel.
- No marker emitted; no production IPC.
- No forced termination, shutdown timeout, fallback, or production supervisor shutdown policy.
- No restart / backoff.
- No `synthetic_helper_main.cpp` change.
- No `helper_process_supervisor` change.
- No default `lvk-tracker-core` runtime behavior change.
- No MotionFrame schema change.
- No Electron / Web Preview / Motion Protocol changes.
- Helper stdout / stderr remain private to Native Core (never forwarded to public stdout).
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / new network behavior.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- production H2 integration
- production shutdown / control-channel implementation
- real parent-to-child `stop` control channel
- forced termination / `shutdown_timeout_forced_exit`
- `shutdown_after_failure_or_timeout`
- shutdown timeout policy
- restart / backoff
- production supervisor shutdown semantics
- default `lvk-tracker-core` runtime wiring
- real frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate raw frame transport
- backend / model / runtime selection
- MotionFrame schema changes
- Electron / Web Preview integration
- manual local validation execution beyond the synthetic smoke

## Recommended Next Step

- Treat `shutdown_after_helper_already_exited` as covered at the synthetic-smoke level only.
- Do **not** proceed from this smoke-local closeout to forced termination, shutdown timeout,
  failure-after-stop handling, restart / backoff, production shutdown / control semantics,
  default runtime wiring, or production H2 integration without a separate scope decision and
  explicit approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate that selected only `shutdown_after_helper_already_exited` as the next slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the prior `shutdown_graceful_exit` synthetic vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — docs-only shutdown smoke plan listing the broader candidate vector set.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only scope gate recording that helper stop / control behavior is not implemented.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed-only startup / liveness / shutdown state machine, including `stop`, `stopping`,
  and bounded shutdown timeout concepts.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
