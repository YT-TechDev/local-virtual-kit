# Tracking Helper Process H2 Helper Runtime Malformed Ready SchemaVersion Guard Closeout

## Status

Status: H2 narrow implementation slice closeout under the approved narrow implementation gate
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md),
issues #407 / #408).
Scope: Native Core-only, synthetic/helper-smoke-oriented hardening that adds a dedicated
malformed-`ready` guard on the **normal** helper-runtime parse path, proving the parser rejects an
invalid `ready` lifecycle line whose `schemaVersion` prefix-matches `1` (`schemaVersion:10`).

This closeout records implementation state only. The change is Native Core helper-runtime
**smoke-parser** coverage plus reuse of the existing synthetic-helper `--emit-malformed-ready` mode.
It changes **no default `lvk-tracker-core` runtime wiring**, no MotionFrame schema, and no
`schemaVersion`. It does not implement production H2 integration, a production diagnostics-safety
policy engine, production supervisor behavior, fallback MotionFrame emission, MotionFrame / Motion
Protocol changes, Electron / Web Preview changes, dependencies, telemetry, analytics, cloud upload,
external frame processing, hidden network calls, new network behavior, real camera access,
helper-owned camera capture, raw frame / pixel / tensor IPC, or any readiness claim.

## Primary Issue

Closes #417 (`test: add helper runtime malformed ready schema guard`). References #400 (the broader
`prototype next local tracking backend` umbrella), which stays open.

## Why This Is Within The Narrow Gate

The approved narrow implementation gate authorizes small, reviewable, CI-safe,
synthetic-helper-oriented, Native Core-bounded slices that preserve the public / private stream
boundaries and add no production wiring. This slice:

- is Native Core-only (helper-runtime smoke case wiring + checker) and touches no default runtime
  wiring;
- is CI-safe and synthetic/smoke-only (it needs no real camera and no model file);
- preserves public `lvk-tracker-core` stdout as MotionFrame JSON only (here: empty on the rejected
  invalid-schema invocation);
- keeps helper stdout / stderr private to Native Core;
- preserves MotionFrame schema compatibility, the current `schemaVersion`, and the Electron / Web
  Preview boundaries;
- makes no production readiness claim.

## Relationship To The Prior Slices (#411 / #413)

#411 introduced the file-local exact-boundary helper and routed the normal-path `result`, `ready`,
and `stopped` checks through it
([`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md)):

```cpp
bool hasExactSchemaVersionOne(const std::string& line) {
  return containsToken(line, "\"schemaVersion\":1,") ||
         containsToken(line, "\"schemaVersion\":1}");
}
```

#411 added a dedicated malformed-`result` guard (`malformed-result-schema`) and #413 added a
dedicated malformed-`stopped` guard (`malformed-stopped-schema`), but neither added a dedicated
**normal-path** malformed-`ready` guard. Lifecycle-handshake malformed-`ready` coverage already
exists (`helper-lifecycle-handshake-malformed-ready`), but it routes through the
`handleLifecycleHandshake` observation, not the normal parse path. This slice adds the missing
normal-path coverage on the `ready` check, parallel to the `result` and `stopped` guards, without
changing the parser logic (the `ready` check already routes through `hasExactSchemaVersionOne`).

## Implemented Slice

- `native/tracker-core/src/helper_runtime_smoke.h`: add the `MalformedReadySchema` smoke case.
- `native/tracker-core/src/helper_runtime_smoke.cpp`: wire the `MalformedReadySchema` case to the
  existing synthetic helper argument `--emit-malformed-ready`. The case runs through the existing
  normal parse path (it is deliberately not added to the lifecycle-handshake dispatch); no parser
  branch is added.
- `native/tracker-core/src/main.cpp`: map `--helper-runtime-smoke-case malformed-ready-schema` to the
  new case and update usage / error text.
- `tools/check-helper-runtime-integration.mjs`: add a guard that runs the `malformed-ready-schema`
  case with `--frames 0` and asserts fail-closed behavior.

## How `schemaVersion:10` On The Ready Line Is Rejected

The new `--helper-runtime-smoke-case malformed-ready-schema` reuses the synthetic helper's
`--emit-malformed-ready` mode so the helper emits its `ready` line as
`{"type":"ready","schemaVersion":10,"source":"synthetic-helper"}`. The guard runs it with
`--frames 0`, so the helper emits the malformed `ready` line, no result frames, then the `stopped`
line. On the normal parse path in `runHelperRuntimeSmoke`, the `ready` branch requires
`hasExactSchemaVersionOne`, which returns `false` for `10`, so the parser reports
`parse error at helper stdout line N: invalid ready line` and returns non-zero. Because the `ready`
line is the first line the parser reads, the rejection lands **before** any MotionFrame is mapped;
`--frames 0` additionally guarantees no result frame precedes it. Public stdout stays empty (no
MotionFrame, no fallback frame), producing exactly zero public stdout lines. Before the
exact-boundary fix, a bare `"schemaVersion":1` substring match would have accepted `schemaVersion:10`;
the guard therefore passes only with the exact-boundary check in place, alongside the existing
`malformed-result-schema` and `malformed-stopped-schema` guards.

## Boundaries Preserved

- Dummy/noop path: unchanged. The default runtime is not entered by any smoke case, and the existing
  Gate 2 default-runtime isolation guard (dummy camera / noop face detector) is unaffected.
- OpenCV Haar smoke/baseline path: unchanged. No camera-source or face-detector code is touched; the
  change is confined to the helper-runtime smoke case wiring and the checker.
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

- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_STOPPED_SCHEMA_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_STOPPED_SCHEMA_GUARD_CLOSEOUT.md)
  — prior slice adding the normal-path malformed-`stopped` guard.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md)
  — slice introducing the shared exact-boundary check and the malformed-`result` guard.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md)
  — owner decision approving this narrow Native Core helper-runtime slice family.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
  </content>
  </invoke>
