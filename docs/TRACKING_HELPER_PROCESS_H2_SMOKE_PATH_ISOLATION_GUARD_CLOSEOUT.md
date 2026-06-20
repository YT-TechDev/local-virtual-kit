# Tracking Helper Process H2 Smoke-Path Isolation Guard Closeout

## Status

Status: H2 Narrow Implementation Gate 2 (explicit smoke-path isolation and default-runtime guard
coverage) closeout.
Scope: documentation-only closeout for the default-runtime guard added to the helper runtime
integration smoke check.

This closeout records implementation state only. It **does not implement anything new at runtime**,
authorizes no production integration, grants no real frame access, adds no dependency, and changes no
MotionFrame schema. The work is bounded by the owner decision
([`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md)),
which approved exactly one narrow slice: synthetic/smoke-only evidence around the explicit smoke-path
boundary.

The slice is **evidence-only**: it adds a CI-safe check assertion and does **not** edit Native Core
runtime source. The smoke-path dispatch guard it validates already exists in
`native/tracker-core/src/main.cpp`.

## Approved Gate

This is the implementation under
[`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md).
Gate 1 (bounded private capture and high-volume child output safety) is complete and closed and is
not reopened here. Gate 2 is a different, narrower follow-up: prove and preserve the boundary around
the explicit smoke path.

Source-grounded boundary: `lvk-tracker-core` enters helper runtime supervision **only** through the
explicit `--helper-runtime-smoke PATH` dispatch
(`native/tracker-core/src/main.cpp`: `if (!options.helperRuntimeSmokePath.empty()) return
runHelperRuntimeSmoke(...)`). With the flag omitted, the default path uses the dummy camera source
and emits MotionFrame JSON. The integration smoke previously covered only the explicit (positive)
path; the default-runtime guard was the missing evidence.

## Implemented Slice

- `tools/check-helper-runtime-integration.mjs`
  - Kept the existing **positive control**: `lvk-tracker-core --helper-runtime-smoke <helper>
--frames 3` produces MotionFrame-JSON-only stdout with private helper stdout/stderr and safe
    `[helper-runtime-smoke]` diagnostics.
  - Added a **default-runtime guard**: runs `lvk-tracker-core --frames 3` **without**
    `--helper-runtime-smoke` and asserts:
    - exit status 0;
    - exactly 3 stdout lines, each validating as native MotionFrame JSON via the existing
      `parseNativeMotionFrameJson` from `packages/motion-protocol` (no new dependency);
    - stdout contains **none** of the smoke-path / helper markers (`[helper-runtime-smoke]`,
      `"source":"synthetic-helper"`, helper contract `"type":"ready"` / `"result"` / `"stopped"`)
      nor any raw-leak marker — i.e. default stdout is MotionFrame JSON only;
    - stderr shows **no** `[helper-runtime-smoke]` diagnostics and no helper child markers, proving
      the smoke path was not entered and nothing private leaked.
  - CI-safe: the default path uses the dummy camera, so no real camera, OS camera permission, or
    hardware is involved.
- No Native Core runtime source was edited (the dispatch guard already exists in `main.cpp`).
- No new CMake target, no new dependency, no synthetic helper change.

### Honest scope note

This is **synthetic/smoke-only evidence**. It asserts the already-existing explicit-smoke-path
dispatch boundary; it does not add, wire, or change any runtime behavior. It does not prove
production readiness, local/manual readiness, or webcam / Electron / OBS readiness. The default-path
MotionFrame values come from the existing dummy tracking pipeline, not from a helper.

## What This Slice Does Not Do

This slice intentionally does **not**:

- wire H2 into the default `lvk-tracker-core` runtime or add default helper runtime wiring;
- implement production supervisor behavior or a production diagnostics-safety policy engine;
- implement any fallback MotionFrame emission;
- change the MotionFrame schema or Motion Protocol;
- change camera access, add helper-owned camera capture, or add raw frame / pixel / tensor IPC;
- edit Electron or Web Preview;
- add dependencies, telemetry, analytics, cloud upload, or network behavior.

`lvk-tracker-core` public stdout remains **MotionFrame JSON only**. Helper stdout / stderr remain
**private to Native Core**.

## Validation Run

Validation commands and exact results are reported in the PR description. At minimum the gate
requires `git diff --check`, `pnpm format:check` (or the repo-local `prettier --check` equivalent),
the native build, and the helper runtime integration check
(`tools/check-helper-runtime-integration.mjs`), which now exercises both the positive control and the
default-runtime guard.

Skipped checks are reported honestly with reasons in the PR. No webcam / OpenCV / OS
camera-permission, Electron, OBS, or Web Preview validation applies — those layers are untouched and
the default path uses the dummy camera.

## Safety Boundaries Preserved

- Synthetic / smoke-only; evidence-only; no runtime source change.
- Helper supervision remains reachable only through the explicit `--helper-runtime-smoke` path; the
  default runtime does not enter it.
- No camera access change; default path uses the dummy camera; no real frames, pixels, or tensors.
- No helper-owned camera capture; no raw frame / pixel / tensor IPC; no high-rate raw frame
  transport.
- No new dependency.
- No MotionFrame schema, Motion Protocol, Electron, or Web Preview change.
- Helper stdout / stderr remain private to Native Core; default stdout stays MotionFrame JSON only.
- No telemetry / analytics / cloud upload / external frame processing / hidden network calls / new
  network behavior.
- No production-readiness, local/manual, webcam, Electron, or OBS readiness claim.

## What Remains Not Implemented / Unapproved

The following remain **not implemented / not approved**:

- production H2 integration;
- default helper runtime wiring / default `lvk-tracker-core` H2 runtime wiring;
- production helper process supervisor behavior;
- production diagnostics-safety policy engine;
- fallback MotionFrame emission;
- MotionFrame schema / Motion Protocol changes;
- real parent-to-child control channel, production forced termination, restart / backoff;
- backend / model / runtime selection;
- camera access changes, helper-owned camera capture, raw frame / pixel / tensor IPC;
- Electron / Web Preview integration.

## Recommended Next Step

- This completes the approved H2 Narrow Implementation Gate 2 slice (explicit smoke-path isolation
  and default-runtime guard evidence).
- Do **not** proceed from this synthetic-only evidence to default runtime wiring, production
  supervisor behavior, a diagnostics-safety policy engine, fallback MotionFrame emission, or
  production H2 integration without a separate owner-approved gate. Those remain gated.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md)
  — owner decision approving this narrow gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
  — Gate 1 decision (complete and closed).
- [`docs/TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md)
  — Gate 1 closeout (bounded capture / high-volume).
- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
