# Tracking Helper Process H2 Unsafe-Diagnostics Public-Stdout Fail-Closed Smoke Closeout

## Status

Status: H2 Narrow Implementation Gate 3 (unsafe helper diagnostics fail-closed smoke coverage)
closeout.
Scope: Native Core synthetic/smoke-only evidence that the **public `lvk-tracker-core` stdout path**
fails closed when the synthetic helper emits an unsafe diagnostic.

This closeout records implementation state only. It **does not** implement production H2 integration,
default helper runtime wiring, a production diagnostics-safety policy engine, production supervisor
behavior, or any fallback MotionFrame emission. It authorizes no production behavior, grants no real
frame access, adds no dependency, and changes no MotionFrame schema or Motion Protocol. The work is
bounded by the owner decision
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md)).

## Approved Gate

This is the implementation under
[`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md).
Gate 1 (bounded private capture / high-volume child output safety) and Gate 2 (explicit smoke-path
isolation / default-runtime guard) are complete and closed and are not reopened here.

The standalone `unsafe_diagnostics_fail_closed` vector in `lvk-helper-h2-state-machine-smoke`
([`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md))
already proved unsafe-diagnostic detection, private retention, and a reconstructed `failed -> fallback`
at the state-machine level. That standalone smoke does **not** produce public `lvk-tracker-core`
stdout. The remaining Gate 3 gap was the public stdout path: the explicit
`--helper-runtime-smoke` runtime (`runHelperRuntimeSmoke`) had no unsafe-diagnostic coverage. This
slice closes exactly that gap.

## Implemented Slice

- `native/tracker-core/src/helper_runtime_smoke.h`
  - Added `HelperRuntimeSmokeCase::UnsafeDiagnostic`.
- `native/tracker-core/src/helper_runtime_smoke.cpp`
  - `buildHelperArguments`: for `UnsafeDiagnostic`, runs the helper with
    `--frames N --emit-unsafe-diagnostic` (the existing synthetic-only helper flag).
  - Added a file-local `helperRuntimeStderrIsSafeForSmoke()` mirroring the existing per-file
    `[helper] ` safe-prefix checks in the other H2 smokes (no new shared module).
  - Added `handleUnsafeDiagnostic()` and an explicit early branch in `runHelperRuntimeSmoke`: the
    unsafe case **fails closed** — it emits **nothing** to public stdout (no MotionFrame and
    deliberately **no fallback frame**), keeps the unsafe child stderr private to Native Core (never
    forwarded or echoed), writes one safe `[helper-runtime-smoke] ` diagnostic, and returns non-zero.
- `native/tracker-core/src/main.cpp`
  - Extended `--helper-runtime-smoke-case` to accept `unsafe-diagnostic`; updated usage text.
- `tools/check-helper-runtime-integration.mjs`
  - Added a Gate 3 guard that runs
    `lvk-tracker-core --helper-runtime-smoke <helper> --frames 3 --helper-runtime-smoke-case unsafe-diagnostic`
    and asserts: non-zero exit (fail-closed); **empty** public stdout; no unsafe child marker
    (`unsafe-synthetic-diagnostic`, `modeled-policy-violation`), no raw helper child stderr marker
    (`[helper]`, `source=synthetic-helper`), and no smoke-path/forbidden marker on public stdout;
    public stderr contains only safe `[helper-runtime-smoke] ` diagnostics and never the unsafe child
    output.
- No new CMake target, no new dependency, no synthetic helper change (the
  `--emit-unsafe-diagnostic` flag already exists on `main`).
- No default `lvk-tracker-core` runtime behavior change (the default path, without
  `--helper-runtime-smoke`, is unchanged and still guarded by the Gate 2 default-runtime check).

### Honest scope note

This is **synthetic/smoke-only evidence**. Fail-closed here means the smoke-only runtime path detects
the unsafe child stderr and emits no public MotionFrame; it is **smoke-local detection**, not a
production diagnostics-safety policy engine, real unsafe-content classifier, production supervisor
behavior, or fallback MotionFrame emission. It does not prove production readiness, local/manual
readiness, or webcam / Electron / OBS readiness.

## What This Slice Does Not Do

This slice intentionally does **not**:

- wire H2 into the default `lvk-tracker-core` runtime or add default helper runtime wiring;
- implement production supervisor behavior or a production diagnostics-safety policy engine;
- implement any fallback MotionFrame emission;
- change the MotionFrame schema or Motion Protocol;
- change camera access, add helper-owned camera capture, or add raw frame / pixel / tensor IPC;
- edit Electron or Web Preview;
- add dependencies, telemetry, analytics, cloud upload, or network behavior.

Public `lvk-tracker-core` stdout remains **MotionFrame JSON only, or empty on fail-closed failure**.
Helper stdout / stderr remain **private to Native Core**.

## Validation Run

Run locally on Windows 11 / MSVC (Visual Studio generator, Debug):

- `cmake -S native/tracker-core -B native/tracker-core/build` — configured.
- `cmake --build native/tracker-core/build --target lvk-tracker-core lvk-synthetic-helper` — built
  (one pre-existing C4819 code-page warning in `helper_process_supervisor.h`, unrelated to this
  change).
- `node tools/check-helper-runtime-integration.mjs native/tracker-core/build/Debug/lvk-tracker-core.exe native/tracker-core/build/Debug/lvk-synthetic-helper.exe`
  — exit 0; positive control, Gate 2 default-runtime guard, and the new Gate 3 unsafe-diagnostic
  fail-closed guard all passed.
- Direct observation of the unsafe case: exit 1, **0 bytes** public stdout, and a single public
  stderr line `[helper-runtime-smoke] unsafe helper diagnostic detected; failing closed (no
MotionFrame emitted)`.
- `git diff --check` — clean.
- `prettier --check` on the changed tool script — passed.

Skipped checks (reported honestly):

- No webcam / OpenCV / OS camera-permission validation — the smoke opens no camera.
- No Electron / OBS / Web Preview validation — those layers are untouched.
- POSIX build/run not executed in this environment; the behavior is platform-neutral (it relies only
  on captured stderr content, not on platform process semantics).

## Safety Boundaries Preserved

- Synthetic / smoke-only; reachable only through the explicit `--helper-runtime-smoke` path with the
  `unsafe-diagnostic` case.
- Public `lvk-tracker-core` stdout stays MotionFrame JSON only, or empty on fail-closed failure.
- Helper stdout / stderr remain private to Native Core; the unsafe child diagnostic is detected, not
  forwarded or echoed.
- No fallback MotionFrame emission; fail-closed emits nothing to public stdout.
- No camera access change; no real frames, pixels, or tensors; the unsafe marker is a benign
  synthetic placeholder.
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
- production diagnostics-safety policy engine / real unsafe-content classification;
- fallback MotionFrame emission;
- MotionFrame schema / Motion Protocol changes;
- real parent-to-child control channel, production forced termination, restart / backoff;
- backend / model / runtime selection;
- camera access changes, helper-owned camera capture, raw frame / pixel / tensor IPC;
- Electron / Web Preview integration.

## Recommended Next Step

- This completes the approved H2 Narrow Implementation Gate 3 slice for the public stdout path.
- Do **not** proceed from this synthetic-only evidence to default runtime wiring, production
  supervisor behavior, a diagnostics-safety policy engine, fallback MotionFrame emission, or
  production H2 integration without a separate owner-approved gate.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md)
  — owner decision approving this narrow gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md)
  — standalone state-machine unsafe-diagnostics vector (different surface).
- [`docs/TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
  — Gate 2 default-runtime guard this check builds on.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
