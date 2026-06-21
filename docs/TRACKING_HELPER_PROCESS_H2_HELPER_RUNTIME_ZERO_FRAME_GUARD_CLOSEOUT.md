# Tracking Helper Process H2 Helper Runtime Zero-Frame Guard Closeout

## Status

Status: H2 Narrow Implementation Gate 7 (helper runtime normal-path zero-frame public stream guard
coverage) closeout.
Scope: synthetic/smoke-only **checker** evidence that the existing explicit
`--helper-runtime-smoke` normal/success path preserves the public `lvk-tracker-core` stdout/stderr
boundary for the zero-frame edge case.

This closeout records implementation state only. The change is **checker-only** and changes **no C++
runtime behavior**. It does not implement production H2 integration, default helper runtime wiring, a
production diagnostics-safety policy engine, production supervisor behavior, fallback MotionFrame
emission, MotionFrame / Motion Protocol changes, Electron / Web Preview changes, dependencies,
telemetry, analytics, cloud upload, external frame processing, hidden network calls, new network
behavior, H2 foundation implementation planning approval, H2 foundation implementation, or any
readiness claim.

## Implemented Gate 7 Slice

The implemented Gate 7 slice extends the existing normal/success public stream guard in
`tools/check-helper-runtime-integration.mjs` to the explicit zero-frame helper runtime smoke path:

```txt
lvk-tracker-core --helper-runtime-smoke <helper> --frames 0
```

The checker reuses the existing normal-path public stream guard helper used by Gates 5 and 6. For the
zero-frame path, it asserts:

- exit status `0`;
- exactly `0` non-empty public stdout lines;
- no MotionFrame or fallback frame appears on public stdout;
- no helper lifecycle markers, helper diagnostics, unsafe child output, raw child stderr, child
  stdout JSON forms, policy / error text, or smoke-only markers appear on public stdout;
- public stderr may be empty, and every non-empty public stderr line must start with the safe parent
  `[helper-runtime-smoke] ` prefix;
- public stderr, even behind the safe parent prefix, must not include helper lifecycle markers,
  helper diagnostics, unsafe child output, raw child stderr, child stdout JSON forms, policy / error
  text, or smoke-only markers.

Helper stdout and helper stderr remain private to Native Core. The existing Gate 5 `--frames 3`
positive control remains intact, and the Gate 6 `--frames 1` and `--frames 5` variation checks remain
intact.

## Source Confirmation for `--frames 0`

The zero-frame normal/success path is source-supported by the current smoke sources:

- `native/tracker-core/src/helper_runtime_smoke.cpp` passes the requested normal/success
  `options.frameCount` directly to the synthetic helper as `--frames <N>`.
- `native/tracker-core/src/helper_runtime_smoke.cpp` requires the parsed helper `result` count to
  match the requested `options.frameCount` before returning success.
- `native/tracker-core/src/synthetic_helper_main.cpp` accepts `--frames N` values from `0` through
  `100000`.
- `native/tracker-core/src/synthetic_helper_main.cpp` emits synthetic result lines only inside the
  loop from `0` to `frameCount - 1`; with `--frames 0`, that loop runs zero times, so no synthetic
  result lines are emitted while the helper still emits its private ready/stopped lifecycle lines and
  completes normally.

Therefore, `--frames 0` is a source-grounded zero-frame normal/success edge case for checker-only
public stream guard coverage.

## Closed Gate State Preserved

Gates 1 through 6 remain closed and intact:

- Gate 1: bounded private capture / high-volume child output safety.
- Gate 2: explicit smoke-path isolation / default-runtime guard.
- Gate 3: unsafe-diagnostic fail-closed on the public stdout path.
- Gate 4: explicit failure-case public stdout guards.
- Gate 5: helper runtime normal-path public stream guard coverage for the existing `--frames 3`
  normal/success case.
- Gate 6: helper runtime normal-path frame-count variation public stream guard coverage for
  `--frames 1` and `--frames 5`.

Gate 7 does not reinterpret or expand those closed gates. It only adds the explicit helper runtime
normal/success zero-frame public stream guard to the existing synthetic/smoke checker.

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
- readiness claims;
- H2 foundation implementation planning approval;
- H2 foundation implementation.

Helper stdout and helper stderr remain private to Native Core. Public `lvk-tracker-core` stdout
remains MotionFrame JSON only for positive-frame success cases and empty for the zero-frame success
case; public stderr remains limited to safe parent diagnostics when present.

## Validation

Required validation is recorded in the implementation PR / final report. If native binaries are not
available in an environment, the checker run must be reported as skipped or failed with the exact
missing-binary/path reason rather than claimed as passed.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_7_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_7_DECISION.md)
  — owner decision approving this narrow Gate 7 implementation slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md)
  — Gate 6 normal-path frame-count variation public stream guard closeout.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
