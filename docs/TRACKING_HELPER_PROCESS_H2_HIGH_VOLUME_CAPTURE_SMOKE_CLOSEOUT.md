# Tracking Helper Process H2 High-Volume Bounded-Capture Smoke Closeout

## Status

Status: H2 Narrow Implementation Gate 1 (synthetic-only helper output safety hardening) closeout.
Scope: documentation-only closeout for the bounded-capture hardening and the `high_volume`
synthetic supervision smoke case.

This closeout records implementation state only. It **does not implement anything**, authorizes no
production integration, grants no real frame access, adds no dependency, and changes no MotionFrame
schema. The work is bounded by the owner decision
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)),
which approved exactly one narrow slice: synthetic-only helper output safety hardening.

Unlike the prior standalone synthetic-smoke vectors, this slice **does** make a small,
smoke-scoped / synthetic-scoped change to `helper_process_supervisor` (bounding its captured-output
buffer). In the current native build, `helper_process_supervisor` is also compiled with
`lvk-tracker-core` to support the explicit `--helper-runtime-smoke` path. That smoke behavior is
active only through explicit smoke paths, is not entered by the default runtime when the smoke path
is omitted, and does **not** approve or add default H2 runtime wiring.

## Approved Gate

This is the first implementation under
[`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md).
Approved intent included keeping child output capture **bounded, local, and private** and adding
CI-safe synthetic smoke coverage for **high-volume** helper output that does not corrupt public
stdout or cause unbounded capture.

Source-grounded gap addressed: `runHelperProcessForSmoke` previously captured child stdout/stderr
into `HelperProcessRunResult` strings **without any size bound** (its header comment assumed "small,
bounded child output"). The synthetic helper can emit high cumulative volume (`--frames` up to
100000), which would have been captured unbounded. Malformed / unknown / oversized / unsafe output
already had smoke coverage; high-volume / unbounded-capture was the remaining uncovered safety
concern.

## Implemented Slice

- `native/tracker-core/src/helper_process_supervisor.h`
  - Added an exposed smoke-only constant `kHelperSmokeCapturedStreamByteCap` (64 KiB) — the
    per-stream cumulative capture cap, exposed so synthetic smokes can assert the bound.
  - Added internal `stdoutTruncated` / `stderrTruncated` result flags, set when a stream reached
    the cap and further bytes were drained-but-discarded. Documented as synthetic-only and not part
    of any public contract.
- `native/tracker-core/src/helper_process_supervisor.cpp`
  - Added `appendBoundedCapture(...)`, a small helper that appends at most the cap into the
    captured string and sets the truncation flag; bytes beyond the cap are discarded while the pipe
    is **still fully drained**, so the child never blocks and exit/timeout detection is unchanged.
  - **Drains stdout/stderr concurrently while the child runs** so the child can never block on a
    full pipe regardless of output volume or pipe buffer size — this is the high-volume safety
    mechanism. POSIX already drained concurrently via its `poll()` loop; the Windows path now spawns
    a small reader thread per stream (Windows `ReadFile` is synchronous), started right after
    `CreateProcess` and after closing the parent-side write handles, and **joined before returning**.
    Timeout / terminate behavior is preserved (on timeout the child is terminated, the readers then
    observe EOF and finish). The reader threads stay local to `runHelperProcessForSmoke`; each writes
    only its own stream's `result` members, so no synchronization is needed.
  - Uses the **default** `CreatePipe` buffer size: capture safety comes from concurrent draining,
    not from any enlarged pipe buffer.
  - Existing smokes (all well under the cap) are unaffected: no truncation, flags stay `false`.
- `native/tracker-core/src/helper_process_supervision_smoke.cpp`
  - Added the `high_volume` case: runs the helper with `--frames 100000` (cumulative stdout of tens
    of MB, far above both the cap and any OS pipe buffer) and asserts the child **launched**, did
    **not** time out, **exited 0**, captured stdout is **clamped to the cap**
    (`<= kHelperSmokeCapturedStreamByteCap`), `stdoutTruncated` is **set**, the early `ready` /
    `result` markers remain recoverable from the bounded prefix, and helper stderr stays safe (the
    check tool additionally asserts the parent's stdout stays empty). The trailing `stopped` line is
    intentionally beyond the cap and is not asserted.
  - The smoke's own stdout stays empty; only safe `[supervision-smoke]` diagnostics go to stderr.
- No new CMake target (the case extends the existing `lvk-helper-process-supervision-smoke`; the
  bound lives in the already-linked `helper_process_supervisor`).
- No synthetic helper flag was added (`--frames` already produces cumulative volume).
- No default `lvk-tracker-core` runtime behavior, MotionFrame schema, Electron, Web Preview, or
  Motion Protocol behavior was changed.

### Honest scope note

The cap, truncation flags, and `high_volume` case are **smoke-only / synthetic-only**. This is a
bounded-capture safety bound for the synthetic supervision primitive; it is **not** a production
supervisor, backpressure, reject, or diagnostics-safety policy engine. The bound proves Native
Core's captured buffer cannot grow without limit on high-volume child output and that such output
stays private and does not corrupt lifecycle handling — it does not classify content, emit fallback
MotionFrames, or change runtime behavior.

## What This Slice Does Not Do

This slice intentionally does **not**:

- wire H2 into the default `lvk-tracker-core` runtime;
- implement production supervisor behavior or a production diagnostics-safety policy engine;
- implement any fallback MotionFrame emission;
- change the MotionFrame schema or Motion Protocol;
- add a real parent-to-child control channel, forced termination, or restart / backoff.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr remain
**private to Native Core**.

## Validation Run

Validation commands and exact results are reported in the PR description. At minimum the gate
requires `git diff --check`, `pnpm format:check`, the native build, and the relevant synthetic
supervision smoke checks
(`tools/check-helper-process-supervision.mjs`, `tools/check-synthetic-helper-output.mjs`).

Skipped checks are reported honestly with reasons in the PR. No webcam / OpenCV / OS
camera-permission, Electron, OBS, or Web Preview validation applies — those layers are untouched and
the supervisor never opens a camera.

## Safety Boundaries Preserved

- Synthetic-only; helper supervision behavior remains smoke-scoped / synthetic-scoped, active only
  through explicit smoke paths, and not entered by the default runtime when the smoke path is
  omitted.
- No camera access; no real frames, pixels, or tensors.
- No helper-owned camera capture; no raw frame / pixel / tensor IPC; no high-rate raw frame
  transport.
- No new dependency.
- No MotionFrame schema, Electron, Web Preview, or Motion Protocol change.
- Helper stdout / stderr remain private to Native Core; captured output is bounded and never
  forwarded to public stdout.
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / external frame processing / hidden network calls / new
  network behavior.
- No production-readiness, local/manual, webcam, Electron, or OBS readiness claim.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- production H2 integration;
- default `lvk-tracker-core` runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- production fail-closed fallback MotionFrame emission, or any fallback MotionFrame emission;
- real parent-to-child control channel;
- production forced termination;
- restart / backoff;
- backend / model / runtime selection;
- real camera access;
- raw frame / pixel / tensor IPC;
- MotionFrame schema changes;
- Electron / Web Preview integration.

## Recommended Next Step

- This completes the approved H2 Narrow Implementation Gate 1 slice (bounded, private capture plus
  high-volume synthetic coverage).
- Do **not** proceed from this synthetic-only slice to production supervisor behavior, a production
  diagnostics-safety policy engine, fallback MotionFrame emission, default runtime wiring, or
  production H2 integration without a separate owner-approved gate. Those remain gated.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
  — owner decision approving this narrow gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md`](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
  — diagnostics / stdout / stderr safety planning (bounded capture principles).
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — prior per-line oversized synthetic vector (smoke-local size check, distinct from this
  cumulative capture bound).
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
