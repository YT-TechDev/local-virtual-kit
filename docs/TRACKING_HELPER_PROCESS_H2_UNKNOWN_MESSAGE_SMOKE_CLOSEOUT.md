# Tracking Helper Process H2 Unknown Message Smoke Closeout

## Status

Status: H2 unknown-message synthetic smoke vector closeout.
Scope: documentation-only closeout for PR #152.

The unknown-message-type synthetic vector is now **implemented** as an additional case in the
existing `lvk-helper-h2-state-machine-smoke` executable. This closeout document records that
implementation state only. It **does not implement anything**, authorizes no production
integration, grants no real frame access, adds no dependency, and changes no MotionFrame schema.

## Implemented Slice

PR #152 added the `unknown_message_type_safe_ignore` synthetic vector — the first helper-output
error vector under the next-synthetic-vector gate
([`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)):

- `native/tracker-core/src/synthetic_helper_main.cpp` — added a bounded, synthetic-only
  `--emit-unknown-type` flag:
  - default off, preserving existing helper behavior;
  - when set, emits one safe helper-style line carrying an unknown `type`
    (`{"type":"unknown-synthetic","schemaVersion":1,"source":"synthetic-helper"}`) after the
    `ready` line, then completes normally;
  - the line is **not** a MotionFrame;
  - the line contains no raw data, paths, secrets, pixels, tensors, model contents, images, or
    private payloads.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added
  `runUnknownMessageTypeCase(...)`:
  - asserts the unknown marker is present only in the captured **private** helper stdout;
  - asserts the reconstructed lifecycle path remains normal;
  - asserts the helper stderr remains safe (`[helper] ` prefix);
  - keeps the smoke's own stdout empty (the unknown payload is never forwarded to public stdout).
- No `CMakeLists.txt` change was required: both files are already compiled into existing targets.
- It is **not** wired into the default `lvk-tracker-core` runtime.

## Covered Vector

- **unknown message type (safe ignore):** `unknown_message_type_safe_ignore`
- State path:
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`

The unknown helper output line is **ignored for lifecycle reconstruction** — it shares no marker
substring with the `ready` / `result` / `stopped` markers and so does not corrupt the
reconstructed state path — and it does **not** trigger fallback: the helper otherwise completes
normally and the path is identical to the normal case. This is the **first helper-output error
vector** implemented under the next-synthetic-vector gate.

## Verification Recorded in PR #152

The following was recorded in PR #152. It is summarized here as a **historical summary only** and
is **not** re-run or re-claimed by this documentation-only closeout:

- CMake configure passed.
- CMake build passed.
- `lvk-helper-h2-state-machine-smoke` passed with five state paths (exit 0).
- The unknown-message case followed the normal `ready` / `running` / `exited` path.
- The smoke's stdout was empty.
- The existing `lvk-helper-process-supervision-smoke` regression passed.
- The native tracker output check (`tools/check-native-tracker-output.mjs`) passed
  (`lvk-tracker-core` public stdout remained MotionFrame JSON only).
- `pnpm format:check` was **not run** in PR #152 because it was a C++-only change with no
  Prettier-covered files (Prettier does not format C++).

This closeout PR is documentation-only; its own `pnpm format:check` result is recorded in the PR
body.

## Safety Boundaries Preserved

- Synthetic-only.
- No camera access.
- No real frames, pixels, or tensors.
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No high-rate raw frame transport.
- No new dependency.
- No JSON library.
- No parser framework refactor.
- No MotionFrame schema change.
- No Electron / Web Preview / Motion Protocol changes.
- No default runtime integration.
- Helper stdout / stderr remain private to Native Core (never forwarded to public stdout).
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / new network behavior.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- malformed helper output vector
- oversized helper output vector
- production H2 integration
- default `lvk-tracker-core` runtime wiring
- real frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate raw frame transport
- shutdown / control-channel semantics
- restart / backoff
- backend / model / runtime selection
- MotionFrame schema changes
- Electron / Web Preview integration
- manual local validation execution

## Recommended Next Step

- Either:
  - plan a small synthetic-only **malformed helper output** vector
    (`malformed_json_line_safe_drop`), or
  - plan **oversized** (`oversized_message_reject`) separately, only after the size bounds are
    clarified first.
- Prefer **malformed before oversized** if oversized would require broader buffer / backpressure
  semantics.
- Do **not** proceed to shutdown / control semantics without a separate gate.
- Do **not** proceed to production integration.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
  — gate / decision for the helper-output error vector group (this vector is its first slice).
- [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
  — closeout for the startup-timeout synthetic vector (PR #149).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and the error / timeout test vectors (`unknown_message_type_safe_ignore`).
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — framing rules and bounded error / timeout handling the vector exercises.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
