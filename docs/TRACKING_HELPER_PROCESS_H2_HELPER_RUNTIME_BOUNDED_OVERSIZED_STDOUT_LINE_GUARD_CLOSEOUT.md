# Tracking Helper Process H2 Helper Runtime Bounded Oversized Stdout Line Guard Closeout

## Status

Status: H2 narrow implementation slice closeout under the approved narrow implementation gate
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md),
issues #407 / #408).
Scope: Native Core-only, synthetic/helper-smoke-oriented hardening that adds a dedicated
bounded-oversized-stdout-line guard on the **normal** helper-runtime parse path, proving the parser
rejects the existing bounded oversized helper stdout line and fails closed rather than leaking helper
output, emitting a fallback MotionFrame, or silently falling through.

This closeout records implementation state only. The change is Native Core helper-runtime
**smoke-parser** coverage plus reuse of the existing synthetic-helper `--emit-oversized-line` mode. It
changes **no default `lvk-tracker-core` runtime wiring**, no MotionFrame schema, and no
`schemaVersion`. It does not implement production H2 integration, a production line-size policy,
streaming parser behavior, buffer management policy, memory-pressure mitigation, oversized-line
recovery behavior, a production diagnostics-safety policy engine, production supervisor behavior,
fallback MotionFrame emission, MotionFrame / Motion Protocol changes, Electron / Web Preview changes,
dependencies, telemetry, analytics, cloud upload, external frame processing, hidden network calls, new
network behavior, real camera access, helper-owned camera capture, raw frame / pixel / tensor IPC, or
any readiness claim.

## Primary Issue

Closes #423 (`test: add helper runtime bounded oversized stdout line guard`). References #400 (the
broader `prototype next local tracking backend` umbrella), which stays open.

## Why This Is Within The Narrow Gate

The approved narrow implementation gate authorizes small, reviewable, CI-safe,
synthetic-helper-oriented, Native Core-bounded slices that preserve the public / private stream
boundaries and add no production wiring. This slice:

- is Native Core-only (helper-runtime smoke case wiring + checker) and touches no default runtime
  wiring;
- is CI-safe and synthetic/smoke-only (it needs no real camera and no model file; the oversized line is
  a deterministic, bounded few-KB synthetic fixture, not a multi-MB stress test);
- preserves public `lvk-tracker-core` stdout as MotionFrame JSON only (here: empty on the rejected
  bounded-oversized-line invocation);
- keeps helper stdout / stderr private to Native Core;
- preserves MotionFrame schema compatibility, the current `schemaVersion`, and the Electron / Web
  Preview boundaries;
- makes no production readiness claim.

## Source-Grounded Behavior Finding

Before implementing, the current normal parse path in `runHelperRuntimeSmoke`
(`native/tracker-core/src/helper_runtime_smoke.cpp`) was inspected, together with the existing
synthetic helper `--emit-oversized-line` mode
(`native/tracker-core/src/synthetic_helper_main.cpp`, `writeOversizedLine`). That mode emits one
deterministic line consisting of the marker `"oversized-synthetic"` followed by
`kSyntheticOversizedFillerBytes` (2048) safe filler `'x'` characters, bounded to a few KB so the
fixture stays deterministic and memory-safe. The line deliberately omits any `"ready"` / `"result"` /
`"stopped"` type marker.

The normal parse path recognizes only the known helper line types — `"ready"`, `"result"`, and
`"stopped"` — and every other non-empty line reaches a terminal branch that reports
`parse error at helper stdout line N: unknown line type` and returns non-zero. Because the bounded
oversized line carries none of the recognized type markers, it matches none of the
`"ready"` / `"result"` / `"stopped"` branches on the normal parse path and reaches the same terminal
unknown-line branch. The normal parse path therefore already **fails closed** on the bounded oversized
helper stdout line; it does not silently ignore it. This matches the issue's expected direction, so no
stop-and-report was required before implementing.

## Relationship To The Prior Slices

The unknown-stdout-line slice (#419) covered a **well-formed** helper line whose `type` is not
recognized. The malformed-stdout-line slice (#421) covered a **short, intentionally invalid**
(unparseable) helper line. This slice covers the adjacent existing synthetic helper mode
`--emit-oversized-line`: a well-formed-looking but deliberately non-JSON, bounded oversized line. All
three exercise the same terminal unknown-line branch of the normal parse path, without changing the
parser logic (the unknown-line branch already exists).

## Implemented Slice

- `native/tracker-core/src/helper_runtime_smoke.h`: add the `BoundedOversizedStdoutLine` smoke case.
- `native/tracker-core/src/helper_runtime_smoke.cpp`: wire the `BoundedOversizedStdoutLine` case to
  the existing synthetic helper argument `--emit-oversized-line`. The case runs through the existing
  normal parse path (it is deliberately not added to the lifecycle-handshake dispatch); no parser
  branch is added.
- `native/tracker-core/src/main.cpp`: map `--helper-runtime-smoke-case bounded-oversized-stdout-line`
  to the new case and update usage / error text.
- `tools/check-helper-runtime-integration.mjs`: add a guard that runs the
  `bounded-oversized-stdout-line` case with `--frames 0` and asserts fail-closed behavior.

## How The Bounded Oversized Stdout Line Is Rejected

The new `--helper-runtime-smoke-case bounded-oversized-stdout-line` reuses the synthetic helper's
existing `--emit-oversized-line` mode so the helper emits one bounded oversized line (the
`"oversized-synthetic"` marker plus a few KB of safe filler) immediately after its `ready` line. The
guard runs it with `--frames 0`, so the helper emits the `ready` line, the oversized line, no result
frames, then the `stopped` line. On the normal parse path in `runHelperRuntimeSmoke`, the parser
accepts the `ready` line (line 1), then reaches the oversized line (line 2); it matches none of the
`"ready"` / `"result"` / `"stopped"` branches, so the parser reports
`parse error at helper stdout line 2: unknown line type` and returns non-zero. Because the oversized
line precedes any result frame and `--frames 0` maps none, the rejection lands before any MotionFrame
is written. Public stdout stays empty (no MotionFrame, no fallback frame), producing exactly zero
public stdout lines. The oversized line's own `oversized-synthetic` marker and filler stay in the
privately captured helper stdout and never reach a public stream.

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
- production line-size policy;
- streaming parser behavior;
- buffer management policy;
- memory-pressure mitigation;
- oversized-line recovery behavior;
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

- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_STDOUT_LINE_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_MALFORMED_STDOUT_LINE_GUARD_CLOSEOUT.md)
  — prior slice adding the normal-path malformed-stdout-line guard (short intentionally invalid line).
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_UNKNOWN_STDOUT_LINE_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_UNKNOWN_STDOUT_LINE_GUARD_CLOSEOUT.md)
  — prior slice adding the normal-path unknown-stdout-line guard (well-formed line, unrecognized
  `type`).
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — earlier closeout for the oversized-line synthetic vector on the H2 state-machine smoke
  (`oversized_line_rejected`), the origin of the bounded oversized-line fixture reused here.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_DECISION.md)
  — owner decision approving this narrow Native Core helper-runtime slice family.
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
