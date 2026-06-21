# Tracking Helper Process H2 Foundation Gate 1 Inventory Map

## Status

Status: H2 Foundation Gate 1 docs-only source-grounded inventory and runtime boundary map.
Scope: documents current Native Core helper-runtime smoke entry points, public/private stream
boundaries, and excluded production surfaces. This document recommends one smallest possible future
foundation implementation slice, but it does not approve or implement that slice.

This document changes no source code, checker behavior, C++ runtime behavior, MotionFrame schema,
Motion Protocol package, Electron surface, Web Preview surface, dependency, network behavior, or
runtime wiring. Gates 1 through 7 remain closed at the synthetic/smoke checker level and are not
reopened.

## Sources Inspected

This map is grounded in the following task-relevant sources:

- `tools/check-helper-runtime-integration.mjs`
- `native/tracker-core/src/main.cpp`
- `native/tracker-core/src/helper_runtime_smoke.cpp`
- `native/tracker-core/src/synthetic_helper_main.cpp`

No broad docs or source scan is required for this map.

## 1. Current Native Core Entry Points Relevant to Helper Runtime Smoke

Current `lvk-tracker-core` exposes two relevant command surfaces:

- **Default runtime path:** `lvk-tracker-core [--frames N] ...` without `--helper-runtime-smoke`.
  `main.cpp` parses normal tracker options, creates the configured camera source, starts the local
  tracking pipeline, and writes MotionFrame JSON to public stdout for each emitted frame.
- **Explicit smoke path:** `lvk-tracker-core --helper-runtime-smoke <helper> [--frames N]
[--helper-runtime-smoke-case ...]`. When `helperRuntimeSmokePath` is non-empty, `main.cpp` returns
  directly from `runHelperRuntimeSmoke(...)` with public stdout and stderr passed as the smoke
  output streams.

The explicit smoke path is selected only by the command-line `--helper-runtime-smoke PATH` argument.
When that argument is omitted, current source proceeds to the default camera / tracking / MotionFrame
loop and does not enter `runHelperRuntimeSmoke(...)`.

## 2. Default Runtime Path Boundary

The default path currently:

- parses normal tracker options, including frame count, camera source, diagnostics flags, and face
  detector selection;
- starts the configured local camera source;
- runs preprocessing, face tracking, and dummy motion tracking through the Native Core pipeline;
- writes one native MotionFrame JSON line to public stdout per emitted frame;
- writes only opt-in camera / face / pipeline diagnostics to stderr when those diagnostic flags are
  enabled.

H2 Narrow Implementation Gates 1 through 7 did not change that default runtime path. Gate 2 added
checker evidence that omitting `--helper-runtime-smoke` keeps helper supervision out of the default
path, keeps public stdout MotionFrame-JSON-only, and leaks no helper smoke output. The later gates
extended explicit smoke-path checker coverage only.

Default H2 helper runtime wiring remains unapproved. This document also does not approve default
`lvk-tracker-core` H2 runtime wiring, production H2 integration, production supervisor behavior,
fallback MotionFrame emission, or production diagnostics-safety policy behavior.

## 3. Explicit `--helper-runtime-smoke` Path Boundary

The explicit smoke path is used for synthetic/smoke helper-runtime integration evidence. It launches
or attempts to launch a synthetic helper executable through `runHelperProcessForSmoke(...)`, parses
that helper's private stdout into smoke-local helper lifecycle / result records, and writes public
MotionFrame JSON only when the smoke case's current behavior requires it.

It is synthetic/smoke-only because:

- the path is available only when `--helper-runtime-smoke <helper>` is explicitly supplied;
- the helper is `lvk-synthetic-helper`, whose source says it is synthetic only, uses no camera,
  files, models, sockets, raw frames, pixels, or tensors, and does not emit MotionFrame;
- smoke cases such as launch failure, nonzero exit, timeout, unsafe diagnostic, and zero frames are
  checker evidence surfaces rather than production runtime policy.

The explicit smoke path proves the currently checked public/private stream boundaries for the listed
synthetic cases. It does not prove production H2 integration, default runtime wiring, production
supervisor behavior, real backend/model/runtime behavior, camera access behavior, readiness, or any
local/manual runtime property.

## 4. Public Stdout/Stderr Boundary

Gates 1 through 7 preserve this public stream contract at the synthetic/smoke checker level:

- public `lvk-tracker-core` stdout remains MotionFrame JSON only for positive-frame success and
  existing failure-fallback smoke cases;
- no helper lifecycle marker, helper diagnostic, raw child stderr, child stdout JSON marker,
  smoke-only marker, unsafe diagnostic marker, policy/error text, or forbidden raw-data marker may
  appear on public stdout;
- public stderr may be empty, and every non-empty public stderr line in helper-runtime smoke coverage
  must start with the safe parent prefix `[helper-runtime-smoke] `;
- even behind that safe parent prefix, public stderr must not forward helper lifecycle / contract
  markers, raw child stderr forms, unsafe child output, forbidden child JSON markers, or forbidden
  raw-data markers.

Positive-frame public stdout behavior is frame-count exact on the explicit normal/success smoke path:
`--frames 3`, `--frames 1`, and `--frames 5` produce exactly that many public MotionFrame JSON lines
under the checker. Zero-frame public stdout behavior is different: `--frames 0` exits cleanly with
exactly zero non-empty public stdout lines while helper ready/stopped lifecycle output remains private
to Native Core.

## 5. Helper Stdout/Stderr Private Boundary

Helper stdout and helper stderr remain private to Native Core in the current smoke evidence. The
checker asserts that helper lifecycle markers such as ready / result / stopped, synthetic helper
source markers, raw helper stderr prefixes, unsafe diagnostic markers, and child JSON contract forms
are not forwarded to public stdout or public stderr.

This evidence is limited to synthetic/smoke paths and checker assertions. It should not be read as a
production diagnostics-safety policy engine, production supervisor policy, or production privacy
implementation.

## 6. MotionFrame and Motion Protocol Boundaries

This document changes no MotionFrame producer behavior and no Motion Protocol schema. Current smoke
checks validate existing native MotionFrame JSON on public stdout where frames are expected, and the
zero-frame guard validates the absence of public stdout frames for `--frames 0`.

No schema or protocol change is approved. No fallback-specific MotionFrame field, tracking status,
source value, schema version, or renderer expectation is approved by this document.

## 7. Electron and Web Preview Boundary

Electron and Web Preview remain untouched. This inventory/map introduces no backend/runtime
dependency into renderer surfaces, no desktop-shell control, no settings UI, no calibration UI, no
status UI, and no Web Preview consumption change.

## 8. Gates 1 Through 7 Checker Evidence Summary

- **Gate 1:** synthetic/smoke bounded private helper stdout/stderr capture and high-volume child
  output safety evidence.
- **Gate 2:** explicit smoke-path isolation and default-runtime guard evidence proving the helper
  smoke path is not entered when `--helper-runtime-smoke` is omitted.
- **Gate 3:** unsafe helper diagnostic fail-closed public stdout guard evidence: non-zero exit,
  empty public stdout, and unsafe child stderr kept private.
- **Gate 4:** explicit failure-case public stdout guard evidence for launch-failure, nonzero-exit,
  and timeout smoke cases using existing fallback MotionFrame behavior.
- **Gate 5:** normal/success explicit smoke path public stream guard evidence for `--frames 3`.
- **Gate 6:** normal/success explicit smoke path frame-count variation evidence for `--frames 1` and
  `--frames 5`.
- **Gate 7:** normal/success explicit smoke path zero-frame public stream guard evidence for
  `--frames 0`.

These gates remain closed and are not reopened by this document.

## 9. Explicit Out-of-Scope Surfaces

This document does not approve, implement, or imply approval for:

- production H2 integration;
- default helper runtime wiring;
- production supervisor behavior;
- diagnostics-safety policy engine behavior;
- fallback MotionFrame emission;
- MotionFrame / Motion Protocol changes;
- Electron / Web Preview changes;
- dependency changes;
- telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior;
- camera access changes;
- helper-owned camera capture;
- raw frame / pixel / tensor IPC;
- high-rate raw frame transport;
- real parent-to-child control channel;
- production forced termination;
- restart / backoff;
- backend/model/runtime selection;
- readiness claims;
- foundation implementation.

## 10. Recommended Smallest Future Implementation Slice

Recommended slice: **a Native Core-only, explicit-smoke-only foundation boundary assertion slice that
adds one CI-safe checker/gate for a new `--helper-runtime-smoke` foundation boundary mode without
changing default runtime behavior.**

The smallest safe shape for a future owner-approved gate would be:

- allowed only in Native Core smoke/checker files named by the future gate;
- invoked only through an explicit smoke argument or smoke checker path;
- no production/default `lvk-tracker-core` wiring;
- no Electron, Web Preview, MotionFrame schema, Motion Protocol, dependency, network, camera access,
  backend/model/runtime, fallback emission, production supervisor, or diagnostics-policy changes;
- evidence limited to public stdout/stderr cleanliness and helper stdout/stderr privacy for that one
  explicit smoke boundary.

This is smallest and safest because it preserves all user-facing and production/default paths while
turning this inventory into one executable boundary check before any production foundation work is
considered. It is implementation-gate-ready, not implementation: the slice remains unapproved until a
future owner-approved implementation gate is reviewed and merged.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 Foundation Gate 1 decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_DECISION.md)
- [H2 foundation implementation planning decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_PLANNING_DECISION.md)
- [H2 helper runtime zero-frame guard closeout](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md)
- [H2 implementation gate requirements](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
