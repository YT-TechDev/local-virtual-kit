# Tracking Helper Process H2 Helper Runtime Smoke Case-Without-Path Guard Closeout

## Status

Status: H2 narrow implementation slice closeout under the approved narrow implementation gate
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md),
issues #407 / #408).
Scope: synthetic/smoke-only **checker** evidence that selecting a helper runtime smoke case via
`--helper-runtime-smoke-case` **without** `--helper-runtime-smoke PATH` fails closed and does not fall
through to the default camera runtime.

This closeout records implementation state only. The change is **checker-only** and changes **no C++
runtime behavior** and **no default `lvk-tracker-core` runtime wiring**. It does not implement
production H2 integration, default helper runtime wiring, a production diagnostics-safety policy
engine, production supervisor behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol
changes, Electron / Web Preview changes, dependencies, telemetry, analytics, cloud upload, external
frame processing, hidden network calls, new network behavior, real camera access, helper-owned camera
capture, raw frame / pixel / tensor IPC, H2 foundation implementation, or any readiness claim.

## Why This Is Within The Narrow Gate

The approved narrow implementation gate authorizes one small, reviewable, CI-safe,
synthetic-helper-oriented, Native Core-bounded slice that preserves the public / private stream
boundaries and adds no production wiring. This slice:

- is **checker-only** (the gate's preferred shape) and touches no C++ source and no default runtime
  wiring;
- is CI-safe and synthetic/smoke-only (it needs no helper child and no camera);
- preserves public `lvk-tracker-core` stdout as MotionFrame JSON only (here: empty on the rejected
  invocation);
- keeps helper stdout / stderr private to Native Core (no helper is launched);
- preserves MotionFrame schema compatibility and the Electron / Web Preview boundaries;
- makes no production readiness claim.

## Implemented Slice

The slice adds a `assertCaseWithoutPathIsolationGuard()` guard to
`tools/check-helper-runtime-integration.mjs`. It runs `lvk-tracker-core` with a helper runtime smoke
case selected but no explicit helper path:

```txt
lvk-tracker-core --frames 3 --helper-runtime-smoke-case <case>
```

`--frames 3` is a valid **default-runtime** argument; if the CLI wrongly fell through to the default
camera runtime, it would emit three MotionFrame lines. The guard asserts, for each covered case
(`normal` and `unsafe-diagnostic`):

- exit status is non-zero (fail-closed);
- exactly `0` non-empty public stdout lines (no default-runtime MotionFrame, no fallback frame, no
  helper output);
- no helper smoke-path markers, forbidden MotionFrame/child markers, or unsafe child markers appear
  on public stdout;
- public stderr reports the safe fail-closed reason
  `--helper-runtime-smoke-case requires --helper-runtime-smoke PATH.`.

Because this is a plain CLI-argument rejection (not a helper runtime diagnostic path), the guard
asserts the fail-closed reason and public stdout cleanliness rather than a `[helper-runtime-smoke] `
stderr prefix: the CLI usage text is legitimately printed to stderr on rejection and mentions the
helper flag names.

## Source Confirmation

The asserted behavior is source-supported by the current CLI:

- `native/tracker-core/src/main.cpp` parses `--helper-runtime-smoke-case`, sets
  `helperRuntimeSmokeCaseSet`, and — when a case is set but `helperRuntimeSmokePath` is empty — writes
  `--helper-runtime-smoke-case requires --helper-runtime-smoke PATH.` and returns a parse failure, so
  `main` exits non-zero before reaching the default camera runtime.
- `native/tracker-core/src/main.cpp` only enters `runHelperRuntimeSmoke` when
  `helperRuntimeSmokePath` is non-empty, so the helper runtime smoke path is never entered by this
  rejected invocation and no helper child is launched.

## Relationship To The Gate 2 Default-Runtime Guard

This guard complements the existing Gate 2 default-runtime isolation guard from the opposite
direction. Gate 2 proves that **omitting** the smoke flags keeps the default `lvk-tracker-core` path
MotionFrame-JSON-only and out of helper supervision. This guard proves that **requesting a smoke case
without the explicit helper path** does not accidentally emit default-runtime MotionFrames on public
stdout — it fails closed instead. It does not reinterpret or expand Gate 2 or any closed gate.

## Safety Boundaries Preserved

This slice intentionally adds none of the following:

- production H2 integration;
- default helper runtime wiring;
- default `lvk-tracker-core` H2 runtime wiring;
- production supervisor behavior;
- diagnostics-safety policy engine behavior;
- fallback MotionFrame emission;
- MotionFrame schema changes;
- Motion Protocol changes;
- Electron changes;
- Web Preview changes;
- dependencies;
- telemetry;
- analytics;
- cloud upload;
- external frame processing;
- hidden network calls;
- new network behavior;
- real camera access;
- helper-owned camera capture;
- raw frame / pixel / tensor IPC;
- readiness claims;
- H2 foundation implementation.

## Validation

Recorded in the implementation PR / final report. If native binaries are not available in an
environment, the checker run must be reported as skipped or failed with the exact missing-binary /
path reason rather than claimed as passed.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md)
  — owner decision approving this narrow Native Core helper-runtime slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
  — Gate 2 default-runtime smoke-path isolation guard closeout (complementary direction).
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
