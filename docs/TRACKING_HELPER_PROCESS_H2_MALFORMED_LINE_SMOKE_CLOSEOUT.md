# Tracking Helper Process H2 Malformed Line Smoke Closeout

## Status

Status: H2 malformed-line synthetic smoke vector closeout.
Scope: documentation-only closeout for PR #154.

The malformed-line synthetic vector is now **implemented** as an additional case in the existing
`lvk-helper-h2-state-machine-smoke` executable. This closeout document records that implementation
state only. It **does not implement anything**, authorizes no production integration, grants no
real frame access, adds no dependency, and changes no MotionFrame schema.

## Implemented Slice

PR #154 added the `malformed_line` synthetic vector — the second helper-output error vector under
the next-synthetic-vector gate
([`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)),
after `unknown_message_type_safe_ignore`:

- `native/tracker-core/src/synthetic_helper_main.cpp` — added a bounded, synthetic-only
  `--emit-malformed-line` flag:
  - default off, preserving existing helper behavior;
  - when set, emits one short, intentionally invalid helper-output line after the `ready` line,
    then completes normally;
  - the line is **not** a MotionFrame;
  - the line contains no raw data, paths, secrets, pixels, tensors, model contents, images, or
    private payloads.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added `runMalformedLineCase(...)`:
  - asserts the malformed marker is present only in the captured **private** helper stdout;
  - asserts the reconstructed lifecycle path remains normal;
  - asserts the helper stderr remains safe (`[helper] ` prefix);
  - keeps the smoke's own stdout empty (the malformed line is never forwarded to public stdout);
  - asserts no fallback is triggered (exit 0, no timeout).
- No `CMakeLists.txt` change was required: both files are already compiled into existing targets.
- It is **not** wired into the default `lvk-tracker-core` runtime.

## Covered Vector

- **Case key:** `malformed_line`
- **Related design vector:** `malformed_json_line_safe_drop`
- State path:
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`

This closeout **intentionally does not claim parser-level safe-drop behavior.** The design-vector
name `malformed_json_line_safe_drop` implies a JSON parser that drops malformed lines and records a
diagnostic; the current smoke has **no JSON parser** and uses bounded string checks. Accordingly,
the smoke verifies only the narrower, source-grounded property: the malformed line is captured only
in private helper stdout and does **not corrupt** the lifecycle reconstruction (which keys off the
`ready` / `result` / `stopped` string markers), with no fallback. General malformed-JSON parser
safe-drop semantics (a real parser that drops the line and counts a safe diagnostic) remain
**future production / parser work**.

## Verification Recorded in PR #154

The following was recorded in PR #154. It is summarized here as a **historical summary only** and
is **not** re-run or re-claimed by this documentation-only closeout:

- CMake configure passed.
- CMake build passed.
- `lvk-helper-h2-state-machine-smoke` passed with six state paths (exit 0).
- The malformed-line case followed the normal `ready` / `running` / `exited` path.
- The smoke's stdout was empty.
- The existing `lvk-helper-process-supervision-smoke` regression passed.
- The native tracker output check (`tools/check-native-tracker-output.mjs`) passed
  (`lvk-tracker-core` public stdout remained MotionFrame JSON only).
- `pnpm format:check` was **not run** in PR #154 because it was a C++-only change with no
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
- No oversized / buffer / backpressure handling.
- No MotionFrame schema change.
- No Electron / Web Preview / Motion Protocol changes.
- No default runtime integration.
- Helper stdout / stderr remain private to Native Core (never forwarded to public stdout).
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / new network behavior.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- oversized helper output vector
- production parser-level malformed-JSON safe-drop semantics
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

- Do **not** proceed directly to oversized implementation unless its size bounds and scope are
  narrowly defined first.
- Preferred next step:
  - create a docs-only scope note / gate for `oversized_message_reject`, or
  - plan a very small oversized vector only if the existing supervisor / source bounds make the
    scope obvious.
- Do **not** proceed to shutdown / control semantics without a separate gate.
- Do **not** proceed to production integration.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
  — gate / decision for the helper-output error vector group (oversized remains the last candidate).
- [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md)
  — closeout for the first helper-output error vector (PR #152).
- [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
  — closeout for the startup-timeout synthetic vector (PR #149).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and the error / timeout test vectors (`malformed_json_line_safe_drop`).
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — framing rules and bounded error / timeout handling the vector exercises.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
