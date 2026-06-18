# Tracking Helper Process H1 Completion Criteria

## Status

Status: H1 closeout criteria / implementation status memo.
Scope: non-camera synthetic helper prototype only.
This document does not approve H2 real frame access or H3 production integration.

This memo records what H1 currently means for LVK's helper-process prototype, which H1 slices are
already implemented, and what remains a project-owner decision before H1 is considered fully closed.
It is source-grounded in the H1a-H1d implementation and the helper-process design documents; it does
not select a backend or expand runtime scope.

## What H1 Means

H1 is the **non-camera synthetic helper prototype** for a Native Core-owned helper process. In current
terms, H1 means:

- Native Core owns the helper-process prototype and remains the sole MotionFrame producer.
- The helper side is synthetic-only: no camera, no model, no raw frames, no pixels, and no tensors.
- Helper stdout is private child-process data consumed by Native Core only; `lvk-tracker-core` stdout
  must remain public MotionFrame JSON only.
- The helper result shape is Native Core-internal and must not be added to Motion Protocol.
- Existing MotionFrame schema and `schemaVersion: 1` remain unchanged.
- Electron, Web Preview, and `packages/motion-protocol` do not gain helper runtime dependencies.
- H1 is not a production helper backend and does not approve H2 real-frame access or H3 production
  integration.

## H1 Slice Status

| Slice | PR   | Status   | What it proved                                                                                                                                                                                                                     | Not proved                                                                                             |
| ----- | ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| H1a   | #125 | Complete | Standalone `lvk-synthetic-helper` emits a synthetic internal stdout contract with safe stderr diagnostics and no MotionFrame output.                                                                                               | Native Core runtime use, process supervision, or fallback behavior.                                    |
| H1b   | #126 | Complete | Native Core-internal helper result values map into the existing `TrackingSample` / MotionFrame shape with clamping and helper-only fields dropped.                                                                                 | Process supervision, live helper stdout parsing, or runtime wiring.                                    |
| H1c   | #127 | Complete | Standalone child-process supervision smoke covers normal completion, helper non-zero failure, and timeout/termination while keeping child output private.                                                                          | Real tracker runtime wiring or integrated runtime fallback policy.                                     |
| H1d   | #128 | Complete | Explicit opt-in `lvk-tracker-core --helper-runtime-smoke <helper-path>` launches the synthetic helper, keeps helper stdout/stderr private, and emits only existing MotionFrame JSON on tracker stdout for the normal path.         | Runtime failure/timeout fallback behavior through the integrated smoke path.                           |
| H1e   | #130 | Complete | Explicit opt-in `--helper-runtime-smoke-case launch-failure\|nonzero-exit\|timeout` validates safe fallback MotionFrame output for expected helper launch failure, non-zero exit, and timeout while keeping helper output private. | Production restart/backoff, graceful stop control, real frame access, or production backend selection. |

H1a-H1e are complete. Strict H1 closeout can now be reviewed by the project owner; restart/backoff, graceful stop control, H2 real-frame access, and production backend selection remain out of scope.

## H1 Completion Checklist

### Completed

- [x] Synthetic helper contract exists.
- [x] Helper stdout remains internal and is not MotionFrame.
- [x] Helper result type is Native Core-internal.
- [x] Helper result maps into the existing MotionFrame shape.
- [x] Child-process supervision smoke covers normal / failure / timeout at standalone level.
- [x] `lvk-tracker-core` has an explicit opt-in helper runtime smoke path.
- [x] Default tracker runtime remains unchanged when the smoke flag is omitted.
- [x] No MotionFrame schema change.
- [x] No Electron/Web Preview/Motion Protocol changes.
- [x] No camera/model/raw frame access.

### Not yet complete / requires decision

- [x] Runtime failure path from `--helper-runtime-smoke` is validated through a dedicated checker.
- [x] Runtime timeout path from `--helper-runtime-smoke` is validated through a dedicated checker.
- [x] Runtime fallback MotionFrame policy is proven in the integrated runtime smoke.
- [ ] Restart/backoff remains out of scope and should not be added unless explicitly approved.
- [ ] Graceful stop control over stdin is not implemented; current H1 uses bounded helper runs and
      termination smoke only.

## Recommended Next Step

Recommended next step: project-owner H1 closeout review.

H1e now provides the dedicated integrated smoke evidence for launch failure, helper non-zero exit,
and helper timeout fallback behavior without changing the default runtime and without adding
production restart/backoff.

This closeout review is limited to H1 evidence. It is not an H2 implementation plan and does not
approve real frame access.

## H2 Entry Gates

H2 remains blocked until explicitly approved. Before any helper touches raw frames, pixels, or
tensors, an H2 design/implementation PR must prove local-only operation, no persistence, no upload,
no telemetry, no analytics, no external frame processing, safe diagnostics, bounded backpressure,
crash behavior, platform-specific IPC security, and no MotionFrame schema change unless that schema
change is intentionally proposed and reviewed. See
[`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md) and
[`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md) for the
source architecture boundaries.

## Non-Goals

- No backend selection.
- No production helper backend.
- No MediaPipe production approval.
- No Python runtime production approval.
- No model/task bundling approval.
- No raw frame/pixel/tensor IPC approval.
- No camera/webcam validation.
- No Electron/Web Preview dependency.
- No MotionFrame schema change.
