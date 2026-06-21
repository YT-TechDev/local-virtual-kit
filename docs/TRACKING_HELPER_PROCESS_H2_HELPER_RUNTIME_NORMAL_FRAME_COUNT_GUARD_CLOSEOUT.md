# Tracking Helper Process H2 Helper Runtime Normal-Path Frame-Count Guard Closeout

## Status

Status: H2 Narrow Implementation Gate 6 (helper runtime normal-path frame-count variation public
stream guard coverage) closeout.
Scope: synthetic/smoke-only **checker** evidence that the existing explicit
`--helper-runtime-smoke` normal/success path preserves the public `lvk-tracker-core` stdout/stderr
boundary for additional source-supported frame counts.

This closeout records implementation state only. The change is **checker-only** and changes **no C++
runtime behavior**. It does not implement production H2 integration, default helper runtime wiring, a
production diagnostics-safety policy engine, production supervisor behavior, fallback MotionFrame
emission, MotionFrame / Motion Protocol changes, Electron / Web Preview changes, dependencies,
telemetry, analytics, cloud upload, external frame processing, hidden network calls, new network
behavior, or any readiness claim.

## Implemented Gate 6 Slice

The implemented Gate 6 slice extends the existing normal/success public stream guard in
`tools/check-helper-runtime-integration.mjs` beyond the Gate 5 `--frames 3` case by adding small
CI-safe positive frame-count variation checks for:

- `--frames 1`
- `--frames 5`

For each selected frame count, the checker runs:

```txt
lvk-tracker-core --helper-runtime-smoke <helper> --frames N
```

and asserts:

- exit status `0`;
- exactly `N` non-empty public stdout lines;
- every public stdout line validates as native MotionFrame JSON through the existing
  `parseNativeMotionFrameJson` path;
- no helper lifecycle markers, helper diagnostics, unsafe child output, raw child stderr, child
  stdout JSON forms, policy / error text, or smoke-only markers appear on public stdout;
- public stderr may be empty, and every non-empty public stderr line must start with the safe parent
  `[helper-runtime-smoke] ` prefix;
- public stderr, even behind the safe parent prefix, must not include helper lifecycle markers,
  helper diagnostics, unsafe child output, raw child stderr, child stdout JSON forms, policy / error
  text, or smoke-only markers.

The existing Gate 5 `--frames 3` positive control remains intact and now uses the same small helper
as the Gate 6 frame-count variation checks.

## Source Confirmation for Selected Frame Counts

The selected frame counts are source-supported by the current smoke sources:

- `native/tracker-core/src/helper_runtime_smoke.cpp` passes the requested normal/success
  `options.frameCount` directly to the synthetic helper as `--frames <N>` and requires the parsed
  helper result count to match that requested count.
- `native/tracker-core/src/synthetic_helper_main.cpp` accepts `--frames N` values from `0` through
  `100000` and emits exactly one synthetic result line for each loop iteration from `0` to
  `frameCount - 1`.

Therefore, `1` and `5` are small positive, source-grounded, CI-safe counts. `5` also matches the
synthetic helper's default frame count, while `1` covers the smallest positive normal count.

## Closed Gate State Preserved

Gates 1 through 5 remain closed and intact:

- Gate 1: bounded private capture / high-volume child output safety.
- Gate 2: explicit smoke-path isolation / default-runtime guard.
- Gate 3: unsafe-diagnostic fail-closed on the public stdout path.
- Gate 4: explicit failure-case public stdout guards.
- Gate 5: helper runtime normal-path public stream guard coverage for the existing `--frames 3`
  normal/success case.

Gate 6 does not reinterpret or expand those closed gates. It only adds normal-path frame-count
variation evidence to the existing synthetic/smoke checker.

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
- readiness claims.

Helper stdout and helper stderr remain private to Native Core. Public `lvk-tracker-core` stdout
remains MotionFrame JSON only, and public stderr remains limited to safe parent diagnostics when
present.

## Validation

Required validation is recorded in the implementation PR / final report. If native binaries are not
available in an environment, the checker run must be reported as skipped or failed with the exact
missing-binary/path reason rather than claimed as passed.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md)
  — owner decision approving this narrow Gate 6 implementation slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md)
  — Gate 5 normal-path public stream guard closeout.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
