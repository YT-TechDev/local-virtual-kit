# Tracking Helper Process H2 Helper Runtime Unknown Stdout Line Guard Closeout

## Status

Status: H2 narrow implementation slice closeout under the approved narrow implementation gate
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md),
issues #407 / #408).
Scope: Native Core-only, synthetic/helper-smoke-oriented hardening that adds a dedicated
unknown-stdout-line guard on the **normal** helper-runtime parse path, proving the parser rejects an
unrecognized helper stdout line and fails closed rather than leaking helper output, emitting a
fallback MotionFrame, or silently falling through.

This closeout records implementation state only. The change is Native Core helper-runtime
**smoke-parser** coverage plus reuse of the existing synthetic-helper `--emit-unknown-type` mode. It
changes **no default `lvk-tracker-core` runtime wiring**, no MotionFrame schema, and no
`schemaVersion`. It does not implement production H2 integration, a production diagnostics-safety
policy engine, production supervisor behavior, fallback MotionFrame emission, MotionFrame / Motion
Protocol changes, Electron / Web Preview changes, dependencies, telemetry, analytics, cloud upload,
external frame processing, hidden network calls, new network behavior, real camera access,
helper-owned camera capture, raw frame / pixel / tensor IPC, or any readiness claim.

## Primary Issue

Closes #419 (`test: add helper runtime unknown stdout line guard`). References #400 (the broader
`prototype next local tracking backend` umbrella), which stays open.

## Why This Is Within The Narrow Gate

The approved narrow implementation gate authorizes small, reviewable, CI-safe,
synthetic-helper-oriented, Native Core-bounded slices that preserve the public / private stream
boundaries and add no production wiring. This slice:

- is Native Core-only (helper-runtime smoke case wiring + checker) and touches no default runtime
  wiring;
- is CI-safe and synthetic/smoke-only (it needs no real camera and no model file);
- preserves public `lvk-tracker-core` stdout as MotionFrame JSON only (here: empty on the rejected
  unknown-line invocation);
- keeps helper stdout / stderr private to Native Core;
- preserves MotionFrame schema compatibility, the current `schemaVersion`, and the Electron / Web
  Preview boundaries;
- makes no production readiness claim.

## Source-Grounded Behavior Finding

Before implementing, the current normal parse path in `runHelperRuntimeSmoke`
(`native/tracker-core/src/helper_runtime_smoke.cpp`) was inspected. That path recognizes only the
known helper line types — `"ready"`, `"result"`, and `"stopped"` — and every other non-empty line
reaches a terminal branch that reports
`parse error at helper stdout line N: unknown line type` and returns non-zero. The normal parse path
therefore already **fails closed** on an unknown helper stdout line; it does not silently ignore it.

Note: the synthetic helper's own descriptive comment on `writeUnknownTypeLine`
(`native/tracker-core/src/synthetic_helper_main.cpp`) references a future
`unknown_message_type_safe_ignore` design intent (a production runtime that would _ignore_ unknown
lines with a safe diagnostic). That is an aspirational note about a possible future production
supervisor, **not** the behavior of the current normal helper-runtime **smoke** parse path. This
slice locks the actual current smoke behavior (fail closed), matching the issue's expected direction,
and does not add or claim the production "safe ignore" semantics.

## Relationship To The Prior Slices

The exact-boundary `schemaVersion` slice (#411) and the malformed `result` / `stopped` / `ready`
schema guards (#411 / #413 / #417) covered the recognized helper line types with an invalid
`schemaVersion`. This slice covers the complementary case: a **well-formed** helper line whose
`type` is not recognized at all. It exercises the terminal unknown-line branch of the same normal
parse path, parallel to the schema guards, without changing the parser logic (the unknown-line
branch already exists).

## Implemented Slice

- `native/tracker-core/src/helper_runtime_smoke.h`: add the `UnknownStdoutLine` smoke case.
- `native/tracker-core/src/helper_runtime_smoke.cpp`: wire the `UnknownStdoutLine` case to the
  existing synthetic helper argument `--emit-unknown-type`. The case runs through the existing normal
  parse path (it is deliberately not added to the lifecycle-handshake dispatch); no parser branch is
  added.
- `native/tracker-core/src/main.cpp`: map `--helper-runtime-smoke-case unknown-stdout-line` to the
  new case and update usage / error text.
- `tools/check-helper-runtime-integration.mjs`: add a guard that runs the `unknown-stdout-line` case
  with `--frames 0` and asserts fail-closed behavior.

## How The Unknown Stdout Line Is Rejected

The new `--helper-runtime-smoke-case unknown-stdout-line` reuses the synthetic helper's
`--emit-unknown-type` mode so the helper emits one extra well-formed helper line
`{"type":"unknown-synthetic","schemaVersion":1,"source":"synthetic-helper"}` immediately after its
`ready` line. The guard runs it with `--frames 0`, so the helper emits the `ready` line, the
unknown-type line, no result frames, then the `stopped` line. On the normal parse path in
`runHelperRuntimeSmoke`, the parser accepts the `ready` line (line 1), then reaches the unknown line
(line 2); it matches none of the `"ready"` / `"result"` / `"stopped"` branches, so the parser reports
`parse error at helper stdout line 2: unknown line type` and returns non-zero. Because the unknown
line precedes any result frame and `--frames 0` maps none, the rejection lands before any MotionFrame
is written. Public stdout stays empty (no MotionFrame, no fallback frame), producing exactly zero
public stdout lines. The unknown line's own `"type"` / `"source"` markers stay in the privately
captured helper stdout and never reach a public stream.

## Boundaries Preserved

- Dummy/noop path: unchanged. The default runtime is not entered by any smoke case, and the existing
  Gate 2 default-runtime isolation guard (dummy camera / noop face detector) is unaffected.
- OpenCV Haar smoke/baseline path: unchanged. No camera-source or face-detector code is touched; the
  change is confined to the helper-runtime smoke case wiring and the checker.
- MotionFrame schema and `schemaVersion`: unchanged. This slice adds coverage for how the helper's
  internal contract lines are parsed; it does not alter MotionFrame or its `schemaVersion`.
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

- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_READY_SCHEMA_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_READY_SCHEMA_GUARD_CLOSEOUT.md)
  — prior slice adding the normal-path malformed-`ready` guard.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_SCHEMA_VERSION_EXACT_BOUNDARY_CLOSEOUT.md)
  — slice introducing the shared exact-boundary check and the malformed-`result` guard.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md)
  — owner decision approving this narrow Native Core helper-runtime slice family.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
