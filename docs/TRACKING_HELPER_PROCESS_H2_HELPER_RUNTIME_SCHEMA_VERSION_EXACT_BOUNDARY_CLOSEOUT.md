# Tracking Helper Process H2 Helper Runtime SchemaVersion Exact-Boundary Closeout

## Status

Status: H2 narrow implementation slice closeout under the approved narrow implementation gate
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md),
issues #407 / #408).
Scope: Native Core-only, synthetic/helper-smoke-oriented hardening so the helper-runtime smoke parser
accepts `schemaVersion` **exactly equal to `1`** and rejects prefix cases such as `schemaVersion:10`
in helper lifecycle (`ready` / `stopped`) and `result` lines.

This closeout records implementation state only. The change is Native Core helper-runtime
**smoke-parser** hardening plus synthetic-helper smoke coverage. It changes **no default
`lvk-tracker-core` runtime wiring**, no MotionFrame schema, and no `schemaVersion`. It does not
implement production H2 integration, a production diagnostics-safety policy engine, production
supervisor behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol changes, Electron /
Web Preview changes, dependencies, telemetry, analytics, cloud upload, external frame processing,
hidden network calls, new network behavior, real camera access, helper-owned camera capture, raw
frame / pixel / tensor IPC, or any readiness claim.

## Primary Issue

Closes #410 (`fix: tighten helper runtime smoke schemaVersion parsing`). References #400 (the broader
`prototype next local tracking backend` umbrella), which stays open.

## Why This Is Within The Narrow Gate

The approved narrow implementation gate authorizes one small, reviewable, CI-safe,
synthetic-helper-oriented, Native Core-bounded slice that preserves the public / private stream
boundaries and adds no production wiring. This slice:

- is Native Core-only (helper-runtime smoke parser + synthetic helper smoke mode + checker) and
  touches no default runtime wiring;
- is CI-safe and synthetic/smoke-only (it needs no real camera and no model file);
- preserves public `lvk-tracker-core` stdout as MotionFrame JSON only (here: empty on the rejected
  invalid-schema invocation);
- keeps helper stdout / stderr private to Native Core;
- preserves MotionFrame schema compatibility, the current `schemaVersion`, and the Electron / Web
  Preview boundaries;
- makes no production readiness claim.

## SchemaVersion Parsing Behavior: Before / After

Before this slice, the normal helper-runtime smoke parse path tested the schema marker with a bare
substring check:

```cpp
containsToken(line, "\"schemaVersion\":1")
```

Because `find` matches a prefix, that check accepted `"schemaVersion":10`, `"schemaVersion":12`, and
similar values in `result`, `ready`, and `stopped` lines. (The lifecycle-handshake observation path
already used an exact-boundary check inline.)

After this slice, a single file-local helper centralizes the exact-boundary check:

```cpp
bool hasExactSchemaVersionOne(const std::string& line) {
  return containsToken(line, "\"schemaVersion\":1,") ||
         containsToken(line, "\"schemaVersion\":1}");
}
```

In the compact helper JSON contract the value is immediately followed by `,` (more fields) or `}`
(end of object), so exactly `1` matches while `10`, `12`, ... do not. Every helper-runtime smoke
schema check now routes through this helper:

- `parseResultLine` (normal-path `result` lines);
- the normal-path `ready` and `stopped` checks in `runHelperRuntimeSmoke`;
- the lifecycle-handshake `ready` / `stopped` observation (the previously duplicated inline check is
  now the shared helper).

## Implemented Slice

- `native/tracker-core/src/helper_runtime_smoke.cpp`: add `hasExactSchemaVersionOne`; replace the
  three normal-path prefix checks with it; route the lifecycle-handshake observation through it; wire
  the new `MalformedResultSchema` case to the synthetic helper argument
  `--emit-malformed-result-schema`.
- `native/tracker-core/src/helper_runtime_smoke.h`: add the `MalformedResultSchema` smoke case.
- `native/tracker-core/src/synthetic_helper_main.cpp`: add `--emit-malformed-result-schema`, which
  emits one otherwise well-formed `result` line with `schemaVersion:10` before the normal result
  frames.
- `native/tracker-core/src/main.cpp`: map `--helper-runtime-smoke-case malformed-result-schema` to the
  new case and update usage / error text.
- `tools/check-helper-runtime-integration.mjs`: add a guard that runs the
  `malformed-result-schema` case and asserts fail-closed behavior.

## How `schemaVersion:10` Is Rejected

The new `--helper-runtime-smoke-case malformed-result-schema` makes the synthetic helper emit one
well-formed `result` line with `schemaVersion:10` before its normal result frames. On the normal parse
path `parseResultLine` now calls `hasExactSchemaVersionOne`, which returns `false` for `10`, so the
parser reports `missing result/schema marker` and returns non-zero **before** mapping any MotionFrame.
Public stdout stays empty (no MotionFrame, no fallback frame). Before the fix, the prefix match would
have accepted the line and mapped it to a public MotionFrame; the guard therefore passes only with the
exact-boundary fix in place. The existing `helper-lifecycle-handshake-malformed-ready` guard continues
to prove the same exact-boundary rejection for `ready` lines, now via the shared helper.

## Boundaries Preserved

- Dummy/noop path: unchanged. The default runtime is not entered by any smoke case, and the existing
  Gate 2 default-runtime isolation guard (dummy camera / noop face detector) is unaffected.
- OpenCV Haar smoke/baseline path: unchanged. No camera-source or face-detector code is touched; the
  change is confined to the helper-runtime smoke parser, the synthetic helper, and the checker.
- MotionFrame schema and `schemaVersion`: unchanged. This slice tightens how the helper's internal
  contract `schemaVersion` is parsed; it does not alter MotionFrame or its `schemaVersion`.
- Public stdout stays MotionFrame JSON only; helper stdout and helper stderr stay private to Native
  Core; only safe `[helper-runtime-smoke]` parent diagnostics reach public stderr.

## Safety Boundaries Preserved

This slice intentionally adds none of the following:

- production H2 integration;
- default `lvk-tracker-core` H2 runtime wiring;
- production supervisor behavior;
- diagnostics-safety policy engine behavior;
- fallback MotionFrame emission;
- MotionFrame schema changes or `schemaVersion` changes;
- new helper protocol version;
- Motion Protocol changes;
- Electron changes;
- Web Preview changes;
- dependencies;
- telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior;
- real camera access, helper-owned camera capture, or raw frame / pixel / tensor IPC;
- readiness claims.

## Validation

Recorded in the implementation PR / final report. If native binaries are not available in an
environment, native configure/build and the checker run against built binaries must be reported as
skipped or failed with the exact missing-binary / path reason rather than claimed as passed.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md)
  — owner decision approving this narrow Native Core helper-runtime slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SMOKE_CASE_WITHOUT_PATH_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SMOKE_CASE_WITHOUT_PATH_GUARD_CLOSEOUT.md)
  — prior narrow slice (checker-only case-without-path guard).
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
