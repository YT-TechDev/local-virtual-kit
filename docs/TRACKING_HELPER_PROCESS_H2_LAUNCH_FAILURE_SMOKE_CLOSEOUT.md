# Tracking Helper Process H2 Launch-Failure Smoke Closeout

## Status

Status: H2 launch-failure synthetic smoke vector closeout.
Scope: documentation-only closeout for the `launch_failure_fallback` synthetic smoke vector.

The `launch_failure_fallback` vector is now **implemented** as an additional synthetic-only case
(`launch_failure`) in `lvk-helper-h2-state-machine-smoke`. This closeout document records that
implementation state only. It **does not implement anything**, authorizes no production
integration, grants no real frame access, adds no dependency, and changes no MotionFrame schema.

It is implemented at the **synthetic-smoke / test-only** level only. It does **not** implement
production process lifecycle policy, a real control channel, or default `lvk-tracker-core` runtime
wiring. It is the first implementation slice drafted under the H2 owner decision gate Option B
([`docs/TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md`](TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md)),
bounded by the minimal candidate slice.

## Coverage

- **Implemented case:** `launch_failure` (design vector `launch_failure_fallback`)
- **Expected state path:** `not_started -> launching -> failed -> fallback`

This is the only documented startup/launch vector
([`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md))
that previously had no synthetic-smoke coverage. Every other case in the smoke asserts the helper
launched (`run.launched == true`); this case is the only one that exercises the launch-failure
boundary of `runHelperProcessForSmoke`.

## Implemented Slice

- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added the `launch_failure` smoke
  case (`runLaunchFailureCase`):
  - launches a **deterministically unlaunchable** helper path, derived from the real helper path
    by appending a never-present suffix (`.lvk-does-not-exist`), so no real helper runs;
  - reconstructs `launching` (Native Core attempted to create the child), then `failed` and
    `fallback`;
  - asserts the supervisor did **not** time out (`run.timedOut == false`), distinguishing this
    from the startup-timeout case;
  - asserts **no** `ready` marker appears in captured private helper stdout (reaching `ready`
    would mean a real helper launched, contradicting the boundary);
  - asserts the launch attempt did **not** yield a cleanly-running helper
    (`!run.launched || run.exitCode != 0`);
  - keeps captured private helper data out of public stdout (the smoke's own stdout stays empty)
    and asserts helper stderr is safe;
  - asserts the reconstructed path equals `not_started -> launching -> failed -> fallback`;
  - is chained into the smoke's `main()` alongside the other cases.
- No `synthetic_helper_main.cpp` change (no new helper flag is needed — the case relies only on a
  missing executable path).
- No `helper_process_supervisor` behavior change.
- No new `HelperState` value was added (`launching`, `failed`, and `fallback` already exist).
- No CMake target was added (the case extends the existing `lvk-helper-h2-state-machine-smoke`;
  the source file is already compiled into that target).
- No default `lvk-tracker-core` runtime behavior was changed.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol behavior was changed.

### Honest scope note: how the launch failure is modeled (and a platform nuance)

The launch-failure signal is deterministic on both platforms, and neither produces a `ready`
marker, but the captured supervisor result differs by platform:

- **Windows:** `CreateProcess` fails for the missing path, so the supervisor reports
  `launched == false` (no child runs; empty stdout/stderr).
- **POSIX:** `fork()` succeeds, but the child's `execv()` fails for the missing path and the child
  exits `127` (no output), so the supervisor reports `launched == true` with a non-zero exit and
  empty stdout.

In both cases the helper never reached `ready`, so `failed` is reconstructed from "no `ready`
marker AND the attempt did not yield a cleanly-running helper". This is an honest model of the
documented `launch_failure_fallback` vector and the `launching -> failed -> fallback` transition
([`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)).
`waiting_for_ready` is intentionally not part of the path: the documented launch-failure path goes
`launching -> failed` directly. This closeout does **not** claim a production launch supervisor,
production fallback MotionFrame emission, or any `helper_process_supervisor` change.

## What This Vector Does Not Do

This vector intentionally does **not**:

- implement production process launch supervision or lifecycle policy;
- implement production fallback MotionFrame emission;
- change `helper_process_supervisor` behavior;
- add a synthetic helper flag;
- wire H2 into the default `lvk-tracker-core` runtime.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr remain
**private to Native Core**.

## Validation Run

The following checks were run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `cmake -S native/tracker-core -B native/tracker-core/build` — configure succeeded.
- `cmake --build native/tracker-core/build --target lvk-synthetic-helper lvk-helper-h2-state-machine-smoke`
  — build succeeded (one pre-existing C4819 code-page warning in `helper_process_supervisor.h`,
  unrelated to this change).
- `lvk-helper-h2-state-machine-smoke.exe lvk-synthetic-helper.exe` — exit 0, all cases passed,
  including the new `launch_failure` case with the path
  `not_started -> launching -> failed -> fallback`.
- `git diff --check` — clean (no whitespace errors).

Skipped checks (not applicable / not run, reported honestly):

- No webcam / OpenCV / OS camera-permission validation — the vector never opens a camera.
- No Electron / OBS / Web Preview validation — those layers are untouched.
- POSIX build/run was not executed in this environment; the cross-platform behavior above is
  reasoned from the supervisor source (`helper_process_supervisor.cpp`), not from a POSIX run.

## Safety Boundaries Preserved

- Synthetic-only.
- No camera access.
- No real frames, pixels, or tensors.
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No high-rate raw frame transport.
- No new dependency.
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
- production process launch supervision / lifecycle policy
- production fallback MotionFrame emission
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

- `launch_failure` adds the remaining documented startup/launch vector at the synthetic-smoke
  level only.
- Do **not** proceed from this smoke-local closeout to production launch supervision, production
  fallback emission, default runtime wiring, or production H2 integration without a separate scope
  decision and explicit owner approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md`](TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md)
  — owner decision gate (Option B: approve drafting a first implementation prompt under the minimal
  candidate slice).
- [`docs/TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md`](TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md)
  — first implementation gate draft (candidate boundary and exclusions).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — design-only test vectors, including `launch_failure_fallback`.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed-only state machine, including the `launching -> failed -> fallback` transition.
- [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the prior `shutdown_timeout_forced_exit` synthetic vector.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
