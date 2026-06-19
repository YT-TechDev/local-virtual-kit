# Tracking Helper Process H2 Graceful Shutdown Smoke Closeout

## Status

Status: H2 graceful-shutdown synthetic smoke vector closeout.
Scope: documentation-only closeout for the `shutdown_graceful_exit` synthetic smoke vector.

The `shutdown_graceful_exit` vector is now **implemented** as an additional synthetic-only
case in `lvk-helper-h2-state-machine-smoke`. This closeout document records that
implementation state only. It **does not implement anything**, authorizes no production
integration, grants no real frame access, adds no dependency, and changes no MotionFrame
schema.

It is implemented at the **synthetic-smoke / test-only** level only. It does **not**
implement production shutdown / control behavior.

## Implemented Slice

Following the graceful shutdown smoke gate
([`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md)),
which narrowed the first synthetic shutdown slice to only `shutdown_graceful_exit`:

- `native/tracker-core/src/synthetic_helper_main.cpp` — added a synthetic-only
  `--emit-graceful-shutdown` helper option:
  - default off, preserving existing helper behavior;
  - when set, on the clean completion path the helper emits one private synthetic
    `"stopping"` lifecycle marker line (`{"type":"stopping","schemaVersion":1,"reason":"graceful-shutdown"}`)
    just before the existing `"stopped"` line, then exits 0;
  - the line is **not** a MotionFrame;
  - the line is **helper-driven**: there is no parent-to-child control channel, so it is
    **not** a response to a real parent `stop` message;
  - the line contains no raw data, paths, secrets, pixels, tensors, model contents, images,
    or private payloads.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added the
  `shutdown_graceful_exit` smoke case:
  - added a `stopping` state to the smoke-internal `HelperState` model (ordered after
    `running`, before `exited`);
  - reconstructs `stopping` from the private `"stopping"` marker in captured helper stdout,
    and `exited` from the clean `"stopped"` marker plus exit code 0;
  - keeps the `stopping` marker private to helper stdout and never forwards it to public
    stdout (the smoke's own stdout stays empty);
  - asserts the reconstructed path equals
    `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited`.
- No `helper_process_supervisor` behavior was changed.
- No default `lvk-tracker-core` runtime behavior was changed.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol behavior was changed.
- No CMake target was added (the case extends the existing
  `lvk-helper-h2-state-machine-smoke`; the flag extends the existing `lvk-synthetic-helper`).

## Covered Vector

- **Implemented case:** `shutdown_graceful_exit`
- **Expected state path:**
  `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited`

This makes `shutdown_graceful_exit` honest at the **smoke-local / test-only** level: the
smoke observes the deterministic synthetic `"stopping"` marker in captured private helper
stdout, reconstructs the `stopping` state from it, and reconstructs `exited` from the clean
`"stopped"` marker plus exit code 0.

### Honest scope note

There is **no** parent-to-child control channel in code, and this slice does not add one.
Like the existing `"stopped"` line (helper-driven, not stop-driven) and like the
reconstructed `failed` / `timed_out` / `fallback` labels in the other cases, the `stopping`
state is a **reconstructed lifecycle label** derived from a private, test-only synthetic
helper marker. It is **not** a real parent `stop` exchange. This closeout does **not** claim
a `stop` control message, a real shutdown handshake, or production supervisor shutdown
semantics.

## What This Vector Does Not Do

This vector intentionally does **not**:

- implement production shutdown / control behavior;
- implement a real parent-to-child `stop` control channel or general stdin control framework;
- implement forced termination;
- implement shutdown timeout behavior;
- implement already-exited (`shutdown_after_helper_already_exited`) handling;
- implement failure / timeout-after-stop (`shutdown_after_failure_or_timeout`) handling;
- implement `shutdown_timeout_forced_exit`;
- implement restart / backoff;
- implement production supervisor shutdown semantics;
- wire H2 into the default `lvk-tracker-core` runtime.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr
remain **private to Native Core**.

## Validation Run

The following checks were run locally on Windows 11 / MSVC (Visual Studio generator,
Debug):

- `git status --short` and `git diff --check` — clean (no whitespace errors).
- `cmake -S native/tracker-core -B native/tracker-core/build` — configure succeeded.
- `cmake --build native/tracker-core/build` — build succeeded for all targets (one
  pre-existing C4819 code-page warning in `helper_process_supervisor.h`, unrelated to this
  change).
- `lvk-helper-h2-state-machine-smoke.exe lvk-synthetic-helper.exe` — exit 0, all **8** cases
  passed, including `shutdown_graceful_exit` with the path
  `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited`.
- `lvk-helper-process-supervision-smoke.exe lvk-synthetic-helper.exe` — exit 0 (no
  regression).
- `node tools/check-native-tracker-output.mjs .../lvk-tracker-core.exe` — exit 0; emitted
  valid MotionFrame JSON only (public stdout unchanged).
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
- No forced termination, shutdown timeout, or production supervisor shutdown policy.
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
- forced termination / `shutdown_timeout_forced_exit`
- `shutdown_after_helper_already_exited`
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

- Treat `shutdown_graceful_exit` as covered at the synthetic-smoke level only.
- Do **not** proceed from this smoke-local closeout to forced termination, shutdown timeout,
  already-exited / failure-after-stop handling, restart / backoff, production shutdown /
  control semantics, default runtime wiring, or production H2 integration without a separate
  scope decision and explicit approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate that selected only `shutdown_graceful_exit` as the first shutdown slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — docs-only shutdown smoke plan listing the broader candidate vector set.
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — docs-only scope gate recording that helper stop / control behavior is not implemented.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed-only startup / liveness / shutdown state machine, including `stop`, `stopping`,
  and bounded shutdown timeout concepts.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the final helper-output error vector in the completed synthetic smoke group.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
  </content>
  </invoke>
