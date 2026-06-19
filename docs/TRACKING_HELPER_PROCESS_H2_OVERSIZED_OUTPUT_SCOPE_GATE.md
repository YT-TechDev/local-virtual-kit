# Tracking Helper Process H2 Oversized Output Scope Gate

## Status

Status: H2 oversized-output scope / gate for the future `oversized_message_reject` vector.
Scope: documentation-only scope/gate.

- Docs-only scope/gate for the future `oversized_message_reject` vector.
- Does not implement anything.
- Does not authorize production integration.
- Grants no real frame access.
- Adds no dependency.
- Changes no MotionFrame schema.
- Does **not** define general production backpressure / streaming / memory-management semantics.

This document decides the smallest safe future implementation shape and the honest naming for the
remaining helper-output error vector. It implements nothing.

## Current Implemented Coverage

- **PR #147** — first synthetic-only H2 state-machine smoke: normal lifecycle, helper non-zero exit
  fallback, liveness / silence timeout after `ready` / `running`.
- **PR #149** — startup-timeout fallback vector
  (`not_started -> launching -> waiting_for_ready -> timed_out -> fallback`).
- **PR #152** — first helper-output error vector: `unknown_message_type_safe_ignore`.
- **PR #154** — second helper-output error vector: case key `malformed_line`, with a deliberately
  narrow, parser-free claim (it does not assert parser-level safe-drop semantics).
- **PR #155** — malformed-line vector closeout.
- **Remaining candidate:** `oversized_message_reject`.

No production H2 integration exists; the default `lvk-tracker-core` runtime remains unchanged.

## Why This Vector Needs a Separate Gate

Oversized output touches **boundary behavior** that unknown/malformed did not:

- maximum line size,
- captured `stdout` / `stderr` size,
- supervisor read behavior,
- helper process termination / timeout behavior,
- memory safety,
- diagnostic safety.

It is more likely than the unknown-type or malformed-line vectors to **drift into buffer /
backpressure design**. Therefore its implementation should be narrowly scoped before any code is
added, so the slice stays as small and source-grounded as the previous two.

## Source-Grounded Observations

Inspected: `native/tracker-core/src/helper_process_supervisor.{h,cpp}`,
`native/tracker-core/src/synthetic_helper_main.cpp`,
`native/tracker-core/src/helper_h2_state_machine_smoke.cpp`,
`native/tracker-core/CMakeLists.txt`.

- **No enforced output size bound and no rejection path.** The supervisor reads child stdout/stderr
  in fixed 4096-byte **chunks** (`char buffer[4096]`) but **appends every chunk to an unbounded
  `std::string`** — Windows `readAllFromPipe` (`contents.append(...)`) and POSIX
  (`result.stdoutText` / `result.stderrText` `.append(...)`). The `4096` is only the per-read chunk
  size, **not** a cap on total captured bytes. There is no maximum-line-size check and no oversized
  rejection anywhere.
- The supervisor header (`helper_process_supervisor.h`) explicitly frames the small-output
  expectation as an **assumption** ("assumes small, bounded child output (the synthetic helper's
  smoke contract)") — it is a convention, **not** an enforced limit.
- The synthetic helper writes only short, fixed lines via its `write*Line` helpers; there is no
  line-length parameter today.
- The H2 smoke uses substring `contains(...)` checks over captured stdout; it has **no** size logic
  and **no** per-line length / framing parsing.
- **Oversized output can be tested without new dependencies:** the synthetic helper can deterministic-
  ally emit one bounded-but-larger line, and the smoke can assert a narrow property with the existing
  string-check style. The test must stay **bounded and deterministic** (a few KB, not multi-MB) to
  avoid memory pressure in local dev / CI, since capture is unbounded.
- **No CMake change appears necessary:** an `--emit-oversized-line` flag and a
  `runOversizedLineCase(...)` would live in already-compiled sources (`lvk-synthetic-helper`,
  `lvk-helper-h2-state-machine-smoke`), matching the unknown/malformed slices.

**Conclusion:** there is **no obvious enforced size bound** in current source. The future
implementation is gated accordingly: it cannot honestly claim production "reject" semantics unless it
adds its own bounded, test-only size-limit check (see Approved Future Implementation Shape and Naming
Guidance).

## Approved Future Implementation Shape

The smallest safe future slice:

- Add a synthetic-only helper option such as **`--emit-oversized-line`** (bounded boolean flag,
  default off; preserves existing behavior). When set, the helper emits one extra line after `ready`,
  then completes normally.
- The emitted line must be:
  - synthetic-only,
  - **not** a MotionFrame,
  - free of raw data, paths, secrets, pixels, tensors, model contents, images, or private payloads
    (e.g. a repeated safe filler character carrying a distinct marker),
  - **deterministic**,
  - **bounded**,
  - **large enough to exceed the selected H2 test-only line-size limit**,
  - **not so large** that it risks memory pressure in local dev / CI (on the order of a few KB —
    explicitly **not** multi-MB).
- Add one smoke case such as **`runOversizedLineCase(...)`** that verifies the narrow behavior the
  current source can honestly support, keeping smoke stdout empty and emitting only safe
  `[h2-state-machine-smoke]` stderr diagnostics (never the oversized payload).

Because current source has **no real line-size rejection path**, the slice must **add the smallest
local, test-only size constant and rejection check** in the smoke (or supervisor) path if it wants to
demonstrate rejection — otherwise it must choose a narrower case name (see Naming Guidance). Do not
build a general parser or backpressure framework for this.

## Naming Guidance

Honest naming is required:

- Use **`oversized_message_reject`** only if the future implementation actually has a size-limit check
  and **rejects** the oversized line.
- If it only verifies that an oversized synthetic line **stays private** or **does not corrupt
  lifecycle reconstruction**, use a **narrower** name and do **not** claim reject semantics.
- Prefer explicit names such as:
  - `oversized_line_rejected` or `oversized_helper_output_rejected` (only if a real rejection check
    exists), or
  - a narrower source-grounded name (e.g. an "oversized line stays private / does not corrupt
    lifecycle" case) if no rejection path exists yet.

This mirrors PR #154, which used the narrower `malformed_line` rather than overclaiming parser-level
`malformed_json_line_safe_drop`.

## Required Future Gates for Implementation

A future oversized implementation PR must preserve:

- synthetic-only,
- no camera access,
- no real frames / pixels / tensors,
- no helper-owned camera capture,
- no raw frame / pixel / tensor IPC,
- no high-rate raw frame transport,
- no new dependency,
- no MotionFrame schema change,
- no Electron / Web Preview / Motion Protocol changes,
- no production H2 integration,
- no default `lvk-tracker-core` runtime wiring,
- helper stdout / stderr remain private to Native Core,
- `lvk-tracker-core` public stdout remains MotionFrame JSON only,
- no telemetry / analytics / cloud upload / new network behavior,
- no broad parser / backpressure framework unless separately approved,
- no shutdown / control-channel semantics.

## Verification Expected for Future Implementation

The future implementation should plan to run:

```
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
native/tracker-core/build/lvk-helper-h2-state-machine-smoke native/tracker-core/build/lvk-synthetic-helper
native/tracker-core/build/lvk-helper-process-supervision-smoke native/tracker-core/build/lvk-synthetic-helper
node tools/check-native-tracker-output.mjs native/tracker-core/build/lvk-tracker-core
```

- `pnpm format:check` only if docs or Prettier-covered files change (Prettier does not format C++).

## What Remains Unapproved

- production H2 integration
- default runtime wiring
- real frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate raw frame transport
- general parser framework
- general backpressure framework
- streaming protocol changes
- shutdown / control-channel semantics
- restart / backoff
- backend / model / runtime selection
- MotionFrame schema changes
- Electron / Web Preview integration
- manual local validation execution

## Recommended Next Step

- Because current source has **no enforced size bound**, the future oversized slice must define a
  small **test-only** line-size constant (and the synthetic rejection check that goes with it) as
  part of its own implementation — or adopt a narrower source-grounded case name if it only proves
  the oversized line stays private and does not corrupt lifecycle reconstruction.
- Proceed via **Plan Mode** for that smallest source-grounded oversized slice once the narrow
  test-only size boundary is decided.
- Do **not** proceed to production reject / backpressure semantics, shutdown / control semantics, or
  production integration.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
  — helper-output error vector group gate (oversized is the last candidate).
- [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the malformed-line vector (PR #154); the parser-free naming precedent.
- [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md)
  — closeout for the unknown-message vector (PR #152).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and the error / timeout test vectors (`oversized_message_reject`).
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — framing rules, bounded message size, and error handling design.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and helper state machine the smoke exercises.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
