# Tracking Helper Process H2 Helper Runtime Normal-Path Public-Stream Guard Closeout

## Status

Status: H2 Narrow Implementation Gate 5 (helper runtime normal-path public stream guard coverage)
closeout.
Scope: Native Core synthetic/smoke-only **checker** evidence that the existing explicit
`--helper-runtime-smoke` normal/success path preserves the public `lvk-tracker-core` stdout/stderr
boundary.

This closeout records implementation state only. It is **checker/test-only** and changes **no C++
runtime behavior**. It does not implement production H2 integration, default helper runtime wiring, a
production diagnostics-safety policy engine, production supervisor behavior, or any new fallback
MotionFrame emission. It authorizes no production behavior, grants no real frame access, adds no
dependency, and changes no MotionFrame schema or Motion Protocol. The work is bounded by the owner
decision
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md)).

## Approved Gate

This is the implementation under
[`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md).
Gate 1 (bounded private capture / high-volume child output safety), Gate 2 (explicit smoke-path
isolation / default-runtime guard), Gate 3 (unsafe-diagnostic fail-closed on the public stdout path),
and Gate 4 (explicit failure-case public stdout guards) are complete and closed and are not reopened
here.

Gate 5 covers the explicit helper runtime **normal/success** path on the public `lvk-tracker-core`
stream boundary. The decision explicitly prefers checker/test coverage over changing C++ when the
existing behavior already supports the evidence; it does here.

## Source-Grounded Behavior Being Asserted

The existing explicit normal/success smoke path is
`lvk-tracker-core --helper-runtime-smoke <helper> --frames 3`. On this path the bounded helper
supervisor in Native Core runs the synthetic helper, captures the helper child's own stdout/stderr
(including its `[helper] ...` lines) **privately**, and the parent emits exactly the requested native
MotionFrame JSON lines on public stdout. Any public stderr is limited to the parent's safe
`[helper-runtime-smoke] ...` diagnostics.

The pre-existing positive control at the top of `tools/check-helper-runtime-integration.mjs` already
runs this path and asserts exit `0`, exactly three non-empty MotionFrame JSON stdout lines (with field
validation), and the safe stderr prefix. Gate 5 re-asserts the same normal/success run against the
full marker sets used by the later gates, so the normal-path public-stream boundary is guarded with
the same rigor as the failure and fail-closed paths. Asserting this introduces no runtime behavior.

## Implemented Slice

- `tools/check-helper-runtime-integration.mjs`
  - Added a Gate 5 normal-path public stream guard section that re-runs
    `lvk-tracker-core --helper-runtime-smoke <helper> --frames 3` (valid helper, normal/success) and
    asserts:
    - exit status `0`;
    - public stdout is **exactly 3** non-empty lines, each validating as native MotionFrame JSON via
      the existing `parseNativeMotionFrameJson` (MotionFrame JSON only);
    - public stdout contains **none** of `helperSmokeEntryMarkers`, `forbiddenStdoutMarkers`, or
      `unsafeChildMarkers` (covering helper lifecycle markers, helper diagnostics, raw child stderr
      forms `[helper]` / `source=synthetic-helper`, child stdout JSON markers, policy/error text,
      unsafe child output, and smoke-only markers);
    - public stderr lines, if any, are **only** safe `[helper-runtime-smoke] `-prefixed parent
      diagnostics;
    - public stderr — even behind the safe parent prefix — contains **none** of the same
      helper/forbidden/unsafe markers (the Gate 4 `forbiddenStderrMarkers` set, the safe prefix
      excluded), so no helper child stdout/stderr is forwarded.
  - The existing positive control, Gate 2 default-runtime guard, Gate 3 unsafe-diagnostic guard, and
    Gate 4 failure-case guard are kept intact and reuse their existing top-level constants.
  - Updated the top-of-file header comment to record the Gate 5 normal-path guard.
- No C++ change, no new CMake target, no new dependency, no synthetic helper change.
- No default `lvk-tracker-core` runtime behavior change.

### Honest scope note

This is **synthetic/smoke-only, checker-only evidence**. It asserts the already-existing explicit
normal/success behavior of the helper runtime smoke path; it does not add, wire, or change any runtime
behavior. It does not prove production readiness, local/manual readiness, or webcam / Electron / OBS
readiness. Helper child stdout/stderr remain private to Native Core.

## What This Slice Does Not Do

This slice intentionally does **not**:

- wire H2 into the default `lvk-tracker-core` runtime or add default helper runtime wiring;
- implement production supervisor behavior or a production diagnostics-safety policy engine;
- add any new fallback MotionFrame emission;
- change the MotionFrame schema or Motion Protocol;
- change camera access, add helper-owned camera capture, or add raw frame / pixel / tensor IPC;
- edit Electron or Web Preview;
- add dependencies, telemetry, analytics, cloud upload, or network behavior.

Public `lvk-tracker-core` stdout remains **MotionFrame JSON only**. Helper stdout / stderr remain
**private to Native Core**.

## Validation Run

Run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `cmake --build native/tracker-core/build --target lvk-tracker-core lvk-synthetic-helper` — built.
- `node tools/check-helper-runtime-integration.mjs native/tracker-core/build/Debug/lvk-tracker-core.exe native/tracker-core/build/Debug/lvk-synthetic-helper.exe`
  — exit 0; positive control, Gate 2 default-runtime guard, Gate 3 unsafe-diagnostic guard, Gate 4
  failure-case guard, and the new Gate 5 normal-path stream guard all passed.
- `git diff --check` — clean.
- `pnpm format:check` (Prettier) — passed on the changed files.

Skipped checks (reported honestly):

- No webcam / OpenCV / OS camera-permission validation — the smoke opens no camera.
- No Electron / OBS / Web Preview validation — those layers are untouched.
- POSIX build/run not executed in this environment; behavior is platform-neutral (it relies on the
  explicit smoke option path and captured output, not on platform process semantics).

## Safety Boundaries Preserved

- Synthetic / smoke-only; checker-only; reachable only through the explicit `--helper-runtime-smoke`
  normal/success path.
- Public `lvk-tracker-core` stdout stays MotionFrame JSON only.
- Public stderr, if present, is only safe `[helper-runtime-smoke] ` parent diagnostics.
- Helper stdout / stderr remain private to Native Core; no raw child stderr or helper child output is
  forwarded to public streams.
- No new fallback MotionFrame emission; no runtime behavior change.
- No camera access change; no real frames, pixels, or tensors.
- No helper-owned camera capture; no raw frame / pixel / tensor IPC; no high-rate raw frame transport.
- No new dependency; no MotionFrame schema, Motion Protocol, Electron, or Web Preview change.
- No telemetry / analytics / cloud upload / external frame processing / hidden network calls / new
  network behavior.
- No production-readiness, local/manual, webcam, Electron, or OBS readiness claim.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- production H2 integration;
- default helper runtime wiring / default `lvk-tracker-core` H2 runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- fallback MotionFrame emission / new fallback MotionFrame behavior;
- MotionFrame schema / Motion Protocol changes;
- real parent-to-child control channel, production forced termination, restart / backoff;
- backend / model / runtime selection;
- camera access changes, helper-owned camera capture, raw frame / pixel / tensor IPC;
- Electron / Web Preview integration.

## Recommended Next Step

- This completes the approved H2 Narrow Implementation Gate 5 slice (normal-path public stream guard).
- Do **not** proceed from this synthetic-only evidence to default runtime wiring, production
  supervisor behavior, a diagnostics-safety policy engine, new fallback MotionFrame emission, or
  production H2 integration without a separate owner-approved gate.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md)
  — owner decision approving this narrow gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md)
  — Gate 4 failure-case public-stdout guard closeout.
- [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md)
  — Gate 3 public-stdout fail-closed closeout.
- [`docs/TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
  — Gate 2 default-runtime guard this check builds on.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
