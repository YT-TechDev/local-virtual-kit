# Tracking Helper Process H1 Closeout Review

## Status

Status: H1 closeout review memo.
Recommendation: H1 implementation evidence is sufficient for project-owner closeout review.
This document does not approve H2 real frame access, H3 production integration, or a
production helper backend.

This memo is a source-grounded review of the existing H1a–H1e implementation. It is **not**
a new implementation plan and selects no backend. It summarizes the evidence already merged
into `main` so the project owner can decide whether to formally close H1. For the
implementation status and slice-by-slice criteria, see
[`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md).
For the design and phase boundaries, see
[`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
and [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md).

## 1. Summary

- H1 was scoped as a **non-camera synthetic helper-process prototype**: no camera, no model,
  no raw frames, no pixels, and no tensors.
- H1a–H1e now cover the synthetic stdout contract (H1a), helper-result → existing
  `TrackingSample` / MotionFrame mapping (H1b), standalone child-process supervision (H1c),
  the explicit opt-in runtime normal path (H1d), and the explicit opt-in runtime fallback
  path (H1e).
- On this evidence, H1 can be considered **ready for project-owner closeout review** as a
  synthetic non-camera prototype.
- H2 (real frame access) and H3 (production integration) remain blocked until explicit
  future approval. No production helper backend is selected.

## 2. Evidence

| Slice | PR   | Evidence                                                                                                                                          | Closeout note                                       |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| H1a   | #125 | Synthetic helper emits its internal stdout contract with safe stderr diagnostics and no MotionFrame.                                              | Proves helper-side synthetic contract only.         |
| H1b   | #126 | Helper result maps into the existing `TrackingSample` / MotionFrame shape with clamping; helper-only fields dropped.                              | No MotionFrame schema change.                       |
| H1c   | #127 | Standalone child-process supervision smoke covers normal completion, non-zero exit, and timeout.                                                  | Not production process management.                  |
| H1d   | #128 | Explicit `--helper-runtime-smoke <helper-path>` normal path emits MotionFrame-only stdout; helper output stays private.                           | Default runtime unchanged when the flag is omitted. |
| H1e   | #130 | Explicit `--helper-runtime-smoke-case launch-failure\|nonzero-exit\|timeout` emits one safe fallback MotionFrame (status `lost`, confidence `0`). | No restart/backoff or production fallback policy.   |

The H1d and H1e behaviors are checked by `tools/check-helper-runtime-integration.mjs` and
`tools/check-helper-runtime-fallback.mjs`, which assert that tracker stdout is MotionFrame
JSON only (`schemaVersion: 1`, `source: "native"`), reject helper-internal markers on
stdout, and require stderr to use the safe `[helper-runtime-smoke]` prefix with no raw
pixels, images, frame dumps, model contents, or secrets.

## 3. H1 Closeout Checklist

- [x] Synthetic helper only (no camera, no model, no raw frames, no pixels, no tensors).
- [x] Helper stdout stays private child-process data read by Native Core only.
- [x] `lvk-tracker-core` stdout remains MotionFrame JSON only.
- [x] Helper internal result does not enter Motion Protocol.
- [x] MotionFrame schema unchanged (`schemaVersion: 1`).
- [x] Standalone child-process supervision smoke exists (normal / non-zero exit / timeout).
- [x] Runtime normal-path smoke exists (H1d).
- [x] Runtime fallback-path smoke exists (H1e).
- [x] Safe diagnostics only (stderr metadata; no raw pixels/images/paths/secrets).
- [x] Default tracker runtime is unchanged when the smoke flags are omitted.
- [x] No Electron / Web Preview / Motion Protocol dependency changes.

## 4. Explicit Non-Closeout Items (future work)

The following are **not required** to close H1 and remain future work. They must not be
added without separate, explicit approval:

- Production restart / backoff policy.
- Graceful stop control over stdin.
- Continuous live helper streaming.
- A production helper backend.
- Backend selection.
- MediaPipe / Python Tasks production approval.
- Model / task file bundling.
- Real frame access.
- Raw frame / pixel / tensor IPC.
- H2 platform-specific IPC security proof.

## 5. Recommendation

- Recommended owner decision: **close H1 as a synthetic non-camera prototype.**
- Recommended next phase: **H2 design preparation only, not implementation.**
- Before any H2 implementation, create a separate design PR that proves local-only
  operation, no persistence, safe diagnostics, bounded backpressure, crash behavior, and
  platform-specific IPC security. This mirrors the H2 entry gates in
  [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  §13 and [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  §5.

## 6. Next Candidate Work

Two safe next options, neither of which adds raw frame access or production backend code:

- **Option A — H2 design preparation PR (design-only).** Document the local-only,
  no-persistence, safe-diagnostics, bounded-backpressure, crash-behavior, and
  platform-specific IPC-security requirements that must be satisfied before any real frame
  ever crosses the helper boundary. No code, no dependency, no backend selection.
- **Option B — Helper prototype cleanup / docs maintenance PR (safe cleanup only).** Tidy
  existing helper-prototype docs and smoke wiring without changing runtime behavior, schema,
  or scope.

Both options stay within H1 boundaries. Neither approves H2, H3, a production backend, or
raw frame / pixel / tensor access.

## 7. Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, phases H0–H3, and H2 entry gates.
- [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md)
  — helper-process boundary options and raw-frame IPC stance.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
