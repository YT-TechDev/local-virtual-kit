# Tracking Helper Process H2 Oversized Line Smoke Closeout

## Status

Status: H2 oversized-line synthetic smoke vector closeout.
Scope: documentation-only closeout for PR #157.

The oversized helper-output vector is now **implemented** as an additional synthetic-only case in
`lvk-helper-h2-state-machine-smoke`. This closeout document records that implementation state only.
It **does not implement anything**, authorizes no production integration, grants no real frame
access, adds no dependency, and changes no MotionFrame schema.

## Implemented Slice

PR #157 added the `oversized_line_rejected` synthetic vector — the final helper-output error vector
under the next-synthetic-vector gate
([`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md))
and the dedicated oversized-output scope gate
([`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md)):

- `native/tracker-core/src/synthetic_helper_main.cpp` — added a synthetic-only
  `--emit-oversized-line` helper option:
  - default off, preserving existing helper behavior;
  - when set, emits one deterministic bounded oversized line after the `ready` line, then
    completes normally;
  - the line is **not** a MotionFrame;
  - the line contains only safe synthetic filler plus the private marker `oversized-synthetic`;
  - the line contains no raw data, paths, secrets, pixels, tensors, model contents, images, or
    private payloads.
- `native/tracker-core/src/helper_h2_state_machine_smoke.cpp` — added the
  `oversized_line_rejected` smoke case:
  - uses a smoke-local / test-only helper line-size limit,
    `kMaxHelperLineBytesForSmoke = 1024`;
  - scans captured private helper stdout line-by-line;
  - marks lines above the smoke-local limit as rejected;
  - excludes rejected oversized lines from lifecycle marker reconstruction;
  - scans only bounded lines for `ready`, `result`, and `stopped` markers;
  - keeps the oversized marker private to helper stdout and never forwards it to public stdout.
- No `helper_process_supervisor` behavior was changed.
- No default `lvk-tracker-core` runtime behavior was changed.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol behavior was changed.

## Covered Vector

- **Implemented case:** `oversized_line_rejected`
- **Related design vector:** `oversized_message_reject`
- Smoke-local size boundary: `kMaxHelperLineBytesForSmoke = 1024`
- State path:
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`

This makes `oversized_line_rejected` honest at the **smoke-local / test-only** level: the smoke
observes the deterministic synthetic oversized line in captured private helper stdout, marks that
line rejected because it exceeds the smoke-local limit, excludes it from lifecycle marker
reconstruction, and reconstructs the normal lifecycle path only from bounded lines. The bounded
lines are the only lines scanned for `ready`, `result`, and `stopped`.

This closeout intentionally does **not** claim production supervisor-size policy, general
stdout/stderr backpressure, streaming behavior, or production parser semantics. The rejection limit
is local to the H2 smoke and exists only to keep the synthetic test vector honest.

## Verification Recorded in PR #157

The following was reported in PR #157. It is summarized here as a **historical summary only** and is
**not** re-run or re-claimed by this documentation-only closeout:

- CMake configure/build succeeded locally on Windows/MSVC.
- The H2 state machine smoke exited 0 with all 7 cases passing.
- The supervision smoke exited 0.
- The native tracker output check exited 0 and emitted valid MotionFrame JSON only.
- `pnpm format:check` was **not run** because the implementation was C++-only with no
  Prettier-covered files changed.

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
- No production supervisor size policy.
- No general stdout/stderr backpressure implementation.
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
- production supervisor size / rejection policy
- general stdout/stderr backpressure or streaming framework
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

- Treat the helper-output error vector group as covered at the synthetic-smoke level:
  - `unknown_message_type_safe_ignore` (PR #152),
  - `malformed_line` (PR #154),
  - `oversized_line_rejected` (PR #157).
- Do **not** proceed from this smoke-local closeout to production size policy, general
  backpressure, shutdown / control semantics, default runtime wiring, or production H2 integration
  without a separate scope decision and explicit approval.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md)
  — scope / gate that bounded the oversized helper-output vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
  — gate / decision for the helper-output error vector group.
- [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the malformed-line vector (PR #154).
- [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md)
  — closeout for the unknown-message vector (PR #152).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and the error / timeout test vectors (`oversized_message_reject`).
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
