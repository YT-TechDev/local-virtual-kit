# Tracking Helper Process H2 Forced-Exit Shutdown Smoke Closeout

## Status

Status: H2 forced-exit shutdown synthetic smoke vector closeout.
Scope: documentation-only closeout for the `shutdown_timeout_forced_exit` synthetic smoke
vector.

The `shutdown_timeout_forced_exit` vector is now **implemented** as an additional synthetic-only
case in `lvk-helper-h2-state-machine-smoke`. This closeout document records that implementation
state only. It **does not implement anything**, authorizes no production integration, grants no
real frame access, adds no dependency, and changes no MotionFrame schema.

It is implemented at the **synthetic-smoke / test-only** level only. It does **not** implement
production forced termination, production shutdown timeout policy, or production supervisor
shutdown semantics.

## Coverage

- **Implemented case:** `shutdown_timeout_forced_exit`
- **Expected state path (terminal state is `exited`, not `fallback`):**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> exited`

## Implemented Slice

Following the forced-exit shutdown smoke gate
([`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md)),
which narrowed the final synthetic shutdown slice to only `shutdown_timeout_forced_exit`:

- `native/tracker-core/src/synthetic_helper_main.cpp` — added a synthetic-only
  `--emit-timeout-forced-shutdown` helper option:
  - default off, preserving existing helper behavior;
  - when set, on the clean completion path the helper emits one private synthetic `"stopping"`
    marker (`reason=timeout-forced-shutdown`) followed by one private synthetic
    `"shutdown-timeout"` marker (`reason=synthetic-shutdown-timeout`) just before the existing
    `"stopped"` line, then exits 0;
  - the markers are **not** MotionFrames;
  - the markers are **helper-driven**: there is no parent-to-child control channel, no real
    forced kill, and no production shutdown-timeout policy — the helper simply exits cleanly;
  - the markers contain no raw data, paths, secrets, pixels, tensors, model contents, images, or
    private payloads.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added the
  `shutdown_timeout_forced_exit` smoke case:
  - reconstructs `stopping` from the private `"stopping"` marker, `timed_out` from the private
    `"shutdown-timeout"` marker, and `exited` from the clean `"stopped"` marker plus exit code 0;
  - asserts the supervisor did **not** time out (`run.timedOut == false`), so the terminal state
    is `exited`, not `fallback`;
  - keeps the markers private to helper stdout and never forwards them to public stdout (the
    smoke's own stdout stays empty);
  - asserts the reconstructed path equals
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> exited`.
- No `helper_process_supervisor` behavior change.
- No new `HelperState` value was added (`stopping`, `timed_out`, and `exited` already exist).
- No default `lvk-tracker-core` runtime behavior was changed.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol behavior was changed.
- No CMake target was added (the case extends the existing
  `lvk-helper-h2-state-machine-smoke`; the flag extends the existing `lvk-synthetic-helper`).

### Honest scope note: how the synthetic timeout / forced-exit observation is modeled

There is **no** real parent-to-child control channel in code, and this slice does not add one.
The sequence is modeled entirely by **private, test-only synthetic helper markers** plus the
helper's own clean exit:

- `timed_out` is a **reconstructed synthetic shutdown-timeout observation** derived from the
  private `"shutdown-timeout"` marker (modeling a graceful stop that did not complete within a
  bounded smoke window). It is **not** a real supervisor timeout — a real supervisor timeout
  (as in the liveness/silence and startup-timeout cases) terminates the child and yields a
  `fallback` terminal state. Here the supervisor does **not** time out.
- `exited` is the **terminal synthetic outcome**, reconstructed from the helper's own clean
  `"stopped"` line plus exit code 0. **No real process is force-killed.**

This mirrors how `shutdown_graceful_exit` reconstructs a `stopping` label from a private marker
without a real `stop` exchange. This closeout does **not** claim real process forced termination,
cross-platform forced-kill behavior, a real shutdown handshake, production shutdown timeout
policy, or production supervisor shutdown semantics.

## What This Vector Does Not Do

This vector intentionally does **not**:

- implement production forced termination;
- implement cross-platform forced-kill behavior;
- implement production shutdown timeout policy;
- implement production supervisor shutdown semantics;
- implement a real parent-to-child `stop` control channel or general stdin control framework;
- implement restart / backoff;
- make `fallback` the terminal state (the terminal state is `exited`);
- wire H2 into the default `lvk-tracker-core` runtime.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr
remain **private to Native Core**.

## Validation Run

The following checks were run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `git status --short` and `git diff --check` — clean (no whitespace errors).
- `cmake -S native/tracker-core -B native/tracker-core/build` — configure succeeded.
- `cmake --build native/tracker-core/build` — build succeeded for all targets (one pre-existing
  C4819 code-page warning in `helper_process_supervisor.h`, unrelated to this change).
- `lvk-helper-h2-state-machine-smoke.exe lvk-synthetic-helper.exe` — exit 0, all cases passed,
  including `shutdown_timeout_forced_exit` with the path
  `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> exited`.
- `lvk-helper-process-supervision-smoke.exe lvk-synthetic-helper.exe` — exit 0 (no regression).
- `node tools/check-native-tracker-output.mjs .../lvk-tracker-core.exe` — exit 0; emitted valid
  MotionFrame JSON only (public stdout unchanged).
- `grep` for non-ASCII in the changed source — clean (avoids reintroducing C4819).
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
- No real forced termination or cross-platform forced kill.
- No production shutdown timeout policy.
- No production supervisor shutdown semantics.
- No restart / backoff.
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
- production forced termination / cross-platform forced kill
- production shutdown timeout policy
- production supervisor shutdown semantics
- restart / backoff
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

- `shutdown_timeout_forced_exit` completes the synthetic shutdown smoke group
  (`shutdown_graceful_exit`, `shutdown_after_helper_already_exited`,
  `shutdown_after_failure_or_timeout`, `shutdown_timeout_forced_exit`) at the synthetic-smoke
  level only.
- Do **not** proceed from this smoke-local closeout to production forced termination, production
  shutdown timeout policy, restart / backoff, production shutdown / control semantics, default
  runtime wiring, or production H2 integration without a separate scope decision and explicit
  approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate that selected only `shutdown_timeout_forced_exit` as the final shutdown slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the prior `shutdown_after_failure_or_timeout` synthetic vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_after_helper_already_exited` synthetic vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_graceful_exit` synthetic vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only scope gate recording that helper stop / control behavior is not implemented.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed-only startup / liveness / shutdown state machine, including `stop`, `stopping`,
  bounded shutdown timeout, failure, timeout, and fallback concepts.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
