# Tracking Backend Evaluation

## Status

- Phase 6.5 planning / evaluation checklist.
- No dependency or runtime changes in this PR.
- No backend selected yet.

## Purpose

LVK needs a source-grounded scorecard for comparing local-only tracking backend candidates before the Face Tracking MVP. The goal is to choose a product-quality path for landmark, pose, eye, mouth, and expression tracking without weakening the existing Native Core, MotionFrame, Electron, and Web Preview boundaries.

This document also prevents the optional OpenCV Haar rectangle detector from being treated as product-quality VTuber tracking. Haar detection is useful as a smoke/baseline path, but it does not satisfy LVK's planned tracking pipeline by itself.

## Current Baseline

- The existing dummy/noop path remains the safe default for deterministic development, tests, and fallback behavior.
- The optional OpenCV camera source and optional OpenCV Haar detector are smoke/baseline paths for local camera capture, detector wiring, fallback behavior, and diagnostics.
- `detectionDurationMs` exists as stderr-only safe timing metadata for backend evaluation; stdout remains MotionFrame JSON.
- Product-quality landmark extraction, head pose estimation, gaze, eye openness, mouth/expression tracking, smoothing, and calibration-quality tracking are still future work.

## Non-Negotiable Constraints

- Raw camera frames stay local to Native Core memory.
- No upload, telemetry, analytics, or external frame processing.
- Backend logic stays behind Native Core abstractions such as camera source, preprocessing, detector/tracker, and MotionFrame writer seams.
- Electron, Web Preview, and Motion Protocol must not gain backend runtime dependencies.
- The current MotionFrame schema must remain unless a schema change is intentionally coordinated across Motion Protocol documentation, validation, and renderer compatibility work.

## Candidate Comparison Scorecard

Use this table as an evaluation worksheet. Fill in measured or reviewed evidence in a follow-up backend evaluation PR; do not treat the notes below as validation results.

| Candidate                                      | Local-first fit                                        | Expected tracking quality                                      | Latency/FPS evaluation need                                                             | Packaging risk                                                                  | Model/data redistribution risk                                                     | Native Core boundary fit                                         | v0.1 suitability                                                    |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| OpenCV Haar baseline                           | High for local smoke use                               | Low for product VTuber tracking; rectangle-only baseline       | Measure as baseline using stderr diagnostics, including `detectionDurationMs`           | Already optional, but local OpenCV setup can vary                               | Cascade XML must not be committed; review source/license if used locally           | Fits only as optional Native Core detector smoke path            | Useful for smoke/baseline only; not sufficient as final backend     |
| MediaPipe Face Landmarker                      | Evaluate local-only setup and offline runtime behavior | Evaluate landmark, pose, blink, mouth, and expression coverage | Measure inference timing, FPS stability, and lost-face behavior locally                 | Evaluate native build, binary size, platform setup, and distribution complexity | Review model/task file license and redistribution terms before committing anything | Must stay behind Native Core tracker abstraction                 | Candidate for product-quality evaluation; not selected yet          |
| ONNX Runtime + local landmark/expression model | Evaluate local model-only execution                    | Depends on selected model; evaluate before selection           | Measure model inference timing, FPS stability, and frame-to-MotionFrame conversion cost | Evaluate ONNX Runtime packaging, providers, and platform setup                  | Review selected model license, weights, notices, and redistribution terms          | Must stay behind Native Core tracker abstraction                 | Candidate only after a specific local model is reviewed             |
| Other local-only model pipeline                | Must preserve local-only processing                    | Evaluate against LVK tracking fields and renderer needs        | Measure end-to-end timing and diagnostics with safe stderr metadata                     | Evaluate toolchain, binary size, platform support, and maintenance cost         | Review any model/data files before distribution                                    | Must preserve Native Core ownership and avoid UI/runtime leakage | Candidate if it beats above options while preserving LVK boundaries |

## Evaluation Criteria

A backend candidate should be compared against these criteria before any dependency, runtime behavior, or model file is added:

- stable face lock
- low jitter
- predictable lost-face behavior
- head rotation support
- eye openness / blink support
- mouth open / smile or expression support
- confidence/lost-state behavior
- timing diagnostics using stderr-only safe metadata such as `detectionDurationMs`
- packaging/runtime setup complexity
- license/model redistribution review
- MotionFrame compatibility

## Local Validation Checklist

Use this checklist when a future PR evaluates a candidate on local hardware. Mark assumptions clearly when a machine, camera, dependency, or model is unavailable.

- Build Native Core.
- Keep the dummy/noop path working.
- Run OpenCV Haar only as a baseline when local OpenCV, a local cascade path, and a camera are available.
- Record stderr diagnostics, including `detectionDurationMs`, without changing stdout MotionFrame JSON.
- Do not record or commit raw frames.
- Do not commit model files or cascade files.
- Mark untested hardware/backend assumptions clearly.

## Decision Record Template

Copy this template into a future backend evaluation or decision PR after evidence is collected.

```md
## Tracking Backend Decision Record

- Date:
- Candidate:
- Local-only status:
- Required runtime/dependencies:
- Required model/data files:
- MotionFrame schema impact:
- Measured diagnostics:
- Packaging notes:
- Privacy notes:
- Decision:
- Follow-up PRs:
```
