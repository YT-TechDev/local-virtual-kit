# Tracking Helper Process H2 Helper Runtime Failure-Case Public-Stdout Guard Closeout

## Status

Status: H2 Narrow Implementation Gate 4 (helper runtime failure-case public stdout guard coverage)
closeout.
Scope: Native Core synthetic/smoke-only **checker** evidence that the existing explicit
`--helper-runtime-smoke` failure cases preserve the public `lvk-tracker-core` stdout boundary.

This closeout records implementation state only. It is **checker/test-only** and changes **no C++
runtime behavior**. It does not implement production H2 integration, default helper runtime wiring, a
production diagnostics-safety policy engine, production supervisor behavior, or any **new** fallback
MotionFrame emission. It authorizes no production behavior, grants no real frame access, adds no
dependency, and changes no MotionFrame schema or Motion Protocol. The work is bounded by the owner
decision
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md)).

## Approved Gate

This is the implementation under
[`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md).
Gate 1 (bounded private capture / high-volume child output safety), Gate 2 (explicit smoke-path
isolation / default-runtime guard), and Gate 3 (unsafe-diagnostic fail-closed on the public stdout
path) are complete and closed and are not reopened here.

Gate 4 covers the remaining explicit failure cases on the public `lvk-tracker-core` stdout path:
`launch-failure`, `nonzero-exit`, and `timeout`. The decision explicitly prefers checker/test
coverage over changing C++ when the existing behavior already supports the evidence; it does here.

## Source-Grounded Behavior Being Asserted

In `native/tracker-core/src/helper_runtime_smoke.cpp`, `runHelperRuntimeSmoke` -> `handleExpectedFailure`
already handles these explicit cases by emitting **exactly one pre-existing fallback MotionFrame**
(`status: "lost"`, a valid native MotionFrame JSON) and returning exit **0**:

- `nonzero-exit` — the synthetic helper runs with `--fail-after 1` and exits non-zero.
- `timeout` — the synthetic helper runs with `--frames 5 --interval-ms 1000` and is stopped by the
  bounded smoke timeout.
- `launch-failure` — the failure branch triggers only when the helper genuinely fails to launch
  (`launched == false`), so the check passes a deliberately non-existent helper path. With a valid
  path this case would run normally and not exercise the failure branch.

The helper child's own stdout/stderr (including its `[helper] ...` lines) are captured **privately**
by the bounded supervisor and never forwarded; the only public stderr is the parent's safe
`[helper-runtime-smoke] ...` diagnostic. The single fallback MotionFrame satisfies the "MotionFrame
JSON only or empty" boundary, and asserting it introduces **no new fallback emission**.

## Implemented Slice

- `tools/check-helper-runtime-integration.mjs`
  - Added a Gate 4 guard with a reusable `assertFailureCaseStdoutGuard({ caseName, helperArg })` that
    runs `lvk-tracker-core --helper-runtime-smoke <helper> --frames 3 --helper-runtime-smoke-case <case>`
    for `nonzero-exit`, `timeout` (valid helper path), and `launch-failure` (non-existent helper
    path), and asserts for each:
    - exit status `0`;
    - public stdout is **exactly one** line that validates as native MotionFrame JSON via the
      existing `parseNativeMotionFrameJson` (MotionFrame JSON only);
    - public stdout contains **none** of `helperSmokeEntryMarkers`, `forbiddenStdoutMarkers`, or
      `unsafeChildMarkers` (covering helper diagnostics, lifecycle markers, raw child stderr forms
      `[helper]` / `source=synthetic-helper`, policy/error text, and unsafe child output; there is no
      distinct fallback-frame indicator string — the fallback is an ordinary MotionFrame);
    - public stderr lines are **only** safe `[helper-runtime-smoke] `-prefixed parent diagnostics and
      contain **none** of `unsafeChildMarkers` (no raw child stderr / helper child output forwarded).
  - The existing positive control, Gate 2 default-runtime guard, and Gate 3 unsafe-diagnostic guard
    are kept intact and reuse their existing top-level constants.
- No C++ change, no new CMake target, no new dependency, no synthetic helper change.
- No default `lvk-tracker-core` runtime behavior change.

### Honest scope note

This is **synthetic/smoke-only, checker-only evidence**. It asserts the already-existing explicit
failure-case behavior of `helper_runtime_smoke.cpp`; it does not add, wire, or change any runtime
behavior, and it adds no new fallback emission. It does not prove production readiness, local/manual
readiness, or webcam / Electron / OBS readiness. The fallback MotionFrame values come from the
existing smoke fallback path, not from a helper result.

## What This Slice Does Not Do

This slice intentionally does **not**:

- wire H2 into the default `lvk-tracker-core` runtime or add default helper runtime wiring;
- implement production supervisor behavior or a production diagnostics-safety policy engine;
- add any new fallback MotionFrame emission;
- change the MotionFrame schema or Motion Protocol;
- change camera access, add helper-owned camera capture, or add raw frame / pixel / tensor IPC;
- edit Electron or Web Preview;
- add dependencies, telemetry, analytics, cloud upload, or network behavior.

Public `lvk-tracker-core` stdout remains **MotionFrame JSON only, or empty**. Helper stdout / stderr
remain **private to Native Core**.

## Validation Run

Run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `cmake --build native/tracker-core/build --target lvk-tracker-core lvk-synthetic-helper` — built
  (one pre-existing C4819 code-page warning in `helper_process_supervisor.h`, unrelated to this
  change).
- `node tools/check-helper-runtime-integration.mjs native/tracker-core/build/Debug/lvk-tracker-core.exe native/tracker-core/build/Debug/lvk-synthetic-helper.exe`
  — exit 0; positive control, Gate 2 default-runtime guard, Gate 3 unsafe-diagnostic guard, and the
  new Gate 4 failure-case guard all passed.
- Direct observation per case (exit 0; one native MotionFrame `status: "lost"`; one safe parent
  diagnostic):
  - `nonzero-exit`: `[helper-runtime-smoke] helper exited non-zero; emitted fallback frame`.
  - `timeout`: `[helper-runtime-smoke] helper timed out; emitted fallback frame`.
  - `launch-failure` (non-existent helper path): `[helper-runtime-smoke] helper launch failed; emitted fallback frame`.
- `git diff --check` — clean.
- `prettier --check` on the changed tool script and docs — passed.

Skipped checks (reported honestly):

- No webcam / OpenCV / OS camera-permission validation — the smoke opens no camera.
- No Electron / OBS / Web Preview validation — those layers are untouched.
- POSIX build/run not executed in this environment; behavior is platform-neutral (it relies on the
  explicit smoke option path and captured output, not on platform process semantics).

## Safety Boundaries Preserved

- Synthetic / smoke-only; checker-only; reachable only through the explicit `--helper-runtime-smoke`
  path with the named failure cases.
- Public `lvk-tracker-core` stdout stays MotionFrame JSON only, or empty.
- Helper stdout / stderr remain private to Native Core; no raw child stderr or helper child output is
  forwarded to public streams.
- No new fallback MotionFrame emission; the asserted single fallback frame is pre-existing behavior.
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
- new fallback MotionFrame emission;
- MotionFrame schema / Motion Protocol changes;
- real parent-to-child control channel, production forced termination, restart / backoff;
- backend / model / runtime selection;
- camera access changes, helper-owned camera capture, raw frame / pixel / tensor IPC;
- Electron / Web Preview integration.

## Recommended Next Step

- This completes the approved H2 Narrow Implementation Gate 4 slice (explicit failure-case public
  stdout guards).
- Do **not** proceed from this synthetic-only evidence to default runtime wiring, production
  supervisor behavior, a diagnostics-safety policy engine, new fallback MotionFrame emission, or
  production H2 integration without a separate owner-approved gate.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md)
  — owner decision approving this narrow gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md)
  — Gate 3 public-stdout fail-closed closeout.
- [`docs/TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
  — Gate 2 default-runtime guard this check builds on.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
