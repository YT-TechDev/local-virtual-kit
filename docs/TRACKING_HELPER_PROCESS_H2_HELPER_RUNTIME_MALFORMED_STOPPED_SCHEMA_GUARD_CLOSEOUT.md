# Tracking Helper Process H2 Helper Runtime Malformed Stopped SchemaVersion Guard Closeout

## Status

Status: H2 narrow implementation slice closeout under the approved narrow implementation gate
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md),
issues #407 / #408).
Scope: Native Core-only, synthetic/helper-smoke-oriented hardening that adds a dedicated
malformed-`stopped` guard proving the helper-runtime smoke parser rejects an invalid `stopped`
lifecycle line whose `schemaVersion` prefix-matches `1` (`schemaVersion:10`).

This closeout records implementation state only. The change is Native Core helper-runtime
**smoke-parser** coverage plus synthetic-helper smoke support. It changes **no default
`lvk-tracker-core` runtime wiring**, no MotionFrame schema, and no `schemaVersion`. It does not
implement production H2 integration, a production diagnostics-safety policy engine, production
supervisor behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol changes, Electron /
Web Preview changes, dependencies, telemetry, analytics, cloud upload, external frame processing,
hidden network calls, new network behavior, real camera access, helper-owned camera capture, raw
frame / pixel / tensor IPC, or any readiness claim.

## Primary Issue

Closes #412 (`test: add helper runtime malformed stopped schemaVersion guard`). References #400 (the
broader `prototype next local tracking backend` umbrella), which stays open.

## Why This Is Within The Narrow Gate

The approved narrow implementation gate authorizes small, reviewable, CI-safe,
synthetic-helper-oriented, Native Core-bounded slices that preserve the public / private stream
boundaries and add no production wiring. This slice:

- is Native Core-only (helper-runtime smoke parser wiring + synthetic helper smoke mode + checker)
  and touches no default runtime wiring;
- is CI-safe and synthetic/smoke-only (it needs no real camera and no model file);
- preserves public `lvk-tracker-core` stdout as MotionFrame JSON only (here: empty on the rejected
  invalid-schema invocation);
- keeps helper stdout / stderr private to Native Core;
- preserves MotionFrame schema compatibility, the current `schemaVersion`, and the Electron / Web
  Preview boundaries;
- makes no production readiness claim.

## Relationship To The Exact-Boundary Slice (#411)

#411 introduced the file-local exact-boundary helper and routed the normal-path `result`, `ready`,
and `stopped` checks through it
([`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md)):

```cpp
bool hasExactSchemaVersionOne(const std::string& line) {
  return containsToken(line, "\"schemaVersion\":1,") ||
         containsToken(line, "\"schemaVersion\":1}");
}
```

#411 added a dedicated malformed-`result` guard (`malformed-result-schema`) but no dedicated
malformed-`stopped` synthetic guard. This slice adds that missing coverage on the normal-path
`stopped` check without reopening #410 and without changing the parser logic (the `stopped` check
already routes through `hasExactSchemaVersionOne`).

## Implemented Slice

- `native/tracker-core/src/synthetic_helper_main.cpp`: add `--emit-malformed-stopped-schema`, which
  emits the `stopped` lifecycle line with `schemaVersion:10` in place of the normal stopped line
  (helper otherwise completes cleanly and exits 0).
- `native/tracker-core/src/helper_runtime_smoke.h`: add the `MalformedStoppedSchema` smoke case.
- `native/tracker-core/src/helper_runtime_smoke.cpp`: wire the `MalformedStoppedSchema` case to the
  synthetic helper argument `--emit-malformed-stopped-schema`. The case runs through the existing
  normal parse path; no parser branch is added.
- `native/tracker-core/src/main.cpp`: map `--helper-runtime-smoke-case malformed-stopped-schema` to
  the new case and update usage / error text.
- `tools/check-helper-runtime-integration.mjs`: add a guard that runs the `malformed-stopped-schema`
  case with `--frames 0` and asserts fail-closed behavior.

## How `schemaVersion:10` On The Stopped Line Is Rejected

The new `--helper-runtime-smoke-case malformed-stopped-schema` makes the synthetic helper emit its
`stopped` line as `{"type":"stopped","schemaVersion":10,"reason":"completed"}`. The guard runs it
with `--frames 0`, so the helper emits the `ready` line, no result frames, then the malformed
`stopped` line. On the normal parse path in `runHelperRuntimeSmoke`, the `stopped` branch calls
`hasExactSchemaVersionOne`, which returns `false` for `10`, so the parser reports
`parse error at helper stdout line N: invalid stopped line` and returns non-zero **before** any
MotionFrame is mapped. Public stdout stays empty (no MotionFrame, no fallback frame). Because
`--frames 0` maps no result frame ahead of the stopped line, the fail-closed rejection produces
exactly zero public stdout lines. Before the exact-boundary fix, a bare `"schemaVersion":1` substring
match would have accepted `schemaVersion:10`; the guard therefore passes only with the exact-boundary
check in place, and the existing `malformed-result-schema` guard continues to prove the same
rejection for `result` lines.

## Boundaries Preserved

- Dummy/noop path: unchanged. The default runtime is not entered by any smoke case, and the existing
  Gate 2 default-runtime isolation guard (dummy camera / noop face detector) is unaffected.
- OpenCV Haar smoke/baseline path: unchanged. No camera-source or face-detector code is touched; the
  change is confined to the helper-runtime smoke parser wiring, the synthetic helper, and the checker.
- MotionFrame schema and `schemaVersion`: unchanged. This slice adds coverage for how the helper's
  internal contract `schemaVersion` is parsed; it does not alter MotionFrame or its `schemaVersion`.
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

- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md)
  — prior slice introducing the shared exact-boundary check and the malformed-`result` guard.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md)
  — owner decision approving this narrow Native Core helper-runtime slice family.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
