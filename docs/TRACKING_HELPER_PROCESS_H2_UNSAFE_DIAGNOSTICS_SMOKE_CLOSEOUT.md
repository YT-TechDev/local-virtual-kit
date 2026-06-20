# Tracking Helper Process H2 Unsafe-Diagnostics Fail-Closed Smoke Closeout

## Status

Status: H2 unsafe-diagnostics fail-closed synthetic smoke vector closeout.
Scope: documentation-only closeout for the `unsafe_diagnostics_fail_closed` synthetic smoke vector.

The `unsafe_diagnostics_fail_closed` vector is now **implemented** as an additional synthetic-only
case (`unsafe_diagnostics_fail_closed`) in `lvk-helper-h2-state-machine-smoke`. This closeout
document records that implementation state only. It **does not implement anything**, authorizes no
production integration, grants no real frame access, adds no dependency, and changes no MotionFrame
schema.

It is implemented at the **synthetic-smoke / test-only** level only. It does **not** implement a
production diagnostics-safety policy engine, production fail-closed fallback MotionFrame emission,
or any `helper_process_supervisor` change.

## Coverage

- **Implemented case:** `unsafe_diagnostics_fail_closed`
- **Expected state path:**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`

This was the **single remaining standalone design vector**
([`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md))
with no synthetic-smoke coverage. With it implemented, every standalone design vector now has
synthetic-smoke coverage. (The cross-cutting `public_stdout_motionframe_only` invariant concerns
`lvk-tracker-core` public stdout, which this standalone smoke does not produce; it is not a
standalone smoke case.)

## Implemented Slice

- `native/tracker-core/src/synthetic_helper_main.cpp` — added a synthetic-only
  `--emit-unsafe-diagnostic` helper option:
  - default off, preserving existing helper behavior;
  - when set, on the otherwise-clean completion path the helper emits **one stderr line that
    intentionally violates the safe-diagnostic contract** by omitting the required `[helper] `
    prefix (`unsafe-synthetic-diagnostic: modeled-policy-violation ...`), then completes normally
    (clean `stopped` line, exit 0);
  - the line is a **benign synthetic marker only**: it carries no raw data, paths, secrets,
    pixels, tensors, or model contents;
  - it is **not** a MotionFrame.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added the
  `unsafe_diagnostics_fail_closed` smoke case:
  - runs the helper with `--frames 3 --emit-unsafe-diagnostic`;
  - reconstructs `ready` and `running` from the private helper stdout markers, asserting the
    lifecycle markers appear in order by **first occurrence** (`ready` before the first `result`),
    using a smoke-local substring-offset check (no JSON parser);
  - asserts the unsafe diagnostic is **detected** by the existing `helperStderrIsSafe()` check
    (which must return `false`); if stderr were safe, the unsafe line was not captured and the case
    is invalid;
  - reconstructs the **fail-closed** terminal `failed -> fallback`, which takes precedence over the
    helper's clean exit 0 (terminal is `fallback`, **not** `exited`);
  - keeps the unsafe content in the helper's **private** captured stderr and never forwards it to
    public stdout (the smoke's own stdout stays empty) or echoes it to the smoke's stderr;
  - asserts the reconstructed path equals
    `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`.
- No `helper_process_supervisor` behavior change.
- No new `HelperState` value was added (`failed` and `fallback` already exist).
- No CMake target was added (the case extends the existing `lvk-helper-h2-state-machine-smoke`;
  the flag extends the existing `lvk-synthetic-helper`).
- No default `lvk-tracker-core` runtime behavior was changed.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol behavior was changed.

### Honest scope note: how the fail-closed behavior is modeled

This is **smoke-local detection only**. The designed state machine
([`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md))
states that unsafe diagnostics are treated as a policy violation and fail closed
(`unsafe output -> failed -> fall back`). The smoke models this by:

- emitting a benign, contract-violating stderr line from the synthetic helper;
- **detecting** it with the existing `helperStderrIsSafe()` substring check (no new detector,
  no JSON parser, no dependency);
- **reconstructing** the `failed -> fallback` labels — exactly as the other cases reconstruct
  `fallback` / `failed` / `timed_out` labels.

It does **not** implement a production diagnostics-safety policy engine, production fail-closed
fallback MotionFrame emission, real unsafe-content classification (raw pixels / tensors / secrets
detection), or any supervisor change. The clean exit 0 is intentionally overridden by the policy
violation, so the terminal state is `fallback`, not `exited`.

## What This Vector Does Not Do

This vector intentionally does **not**:

- implement a production diagnostics-safety policy engine or real unsafe-content classifier;
- implement production fail-closed fallback MotionFrame emission;
- change `helper_process_supervisor` behavior;
- wire H2 into the default `lvk-tracker-core` runtime.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr remain
**private to Native Core**.

## Validation Run

The following checks were run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `cmake --build native/tracker-core/build --target lvk-synthetic-helper lvk-helper-h2-state-machine-smoke`
  — build succeeded (one pre-existing C4819 code-page warning in `helper_process_supervisor.h`,
  unrelated to this change).
- `lvk-helper-h2-state-machine-smoke.exe lvk-synthetic-helper.exe` — exit 0, all cases passed,
  including the new `unsafe_diagnostics_fail_closed` case with the path
  `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`.
- `git diff --check` — clean (no whitespace errors).

Skipped checks (not applicable / not run, reported honestly):

- No webcam / OpenCV / OS camera-permission validation — the vector never opens a camera.
- No Electron / OBS / Web Preview validation — those layers are untouched.
- POSIX build/run was not executed in this environment; the behavior is platform-neutral (it relies
  only on captured stderr content, not on platform process semantics).

## Safety Boundaries Preserved

- Synthetic-only.
- No camera access.
- No real frames, pixels, or tensors (the unsafe marker is a benign synthetic placeholder).
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No high-rate raw frame transport.
- No new dependency.
- No `helper_process_supervisor` change.
- No default `lvk-tracker-core` runtime behavior change.
- No MotionFrame schema change.
- No Electron / Web Preview / Motion Protocol changes.
- Helper stdout / stderr remain private to Native Core (the unsafe line is detected, never
  forwarded to public stdout or echoed).
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / new network behavior.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- production H2 integration
- production diagnostics-safety policy engine / real unsafe-content classification
- production fail-closed fallback MotionFrame emission
- production process launch supervision / lifecycle policy
- real parent-to-child control channel
- production forced termination
- restart / backoff
- default `lvk-tracker-core` runtime wiring
- real frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- backend / model / runtime selection
- MotionFrame schema changes
- Electron / Web Preview integration
- manual local validation execution beyond the synthetic smoke

## Recommended Next Step

- `unsafe_diagnostics_fail_closed` brings every standalone H2 design vector to synthetic-smoke
  coverage. There is no remaining standalone synthetic-smoke vector to add.
- Do **not** proceed from this smoke-local closeout to a production diagnostics-safety policy
  engine, production fail-closed fallback emission, default runtime wiring, or production H2
  integration without a separate scope decision and explicit owner approval. The next H2 step is
  production-runtime planning, which remains gated.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — design-only test vectors, including `unsafe_diagnostics_fail_closed`.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed-only state machine, including "unsafe diagnostics -> policy violation -> fail closed".
- [`docs/TRACKING_HELPER_PROCESS_H2_LAUNCH_FAILURE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_LAUNCH_FAILURE_SMOKE_CLOSEOUT.md)
  — closeout for the prior `launch_failure` synthetic vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md)
  — docs-only next-scope gate; production-runtime planning remains gated.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
