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

## Next Candidate Evaluation Plan

Use this plan for the next local validation PR so LVK can compare candidate backends without selecting or adding one prematurely. Keep the PR source-grounded: record what was actually measured, and mark unavailable hardware, model, license, or runtime information as not yet reviewed.

### Candidate order

1. OpenCV Haar smoke may be used only as an optional baseline when a trusted local cascade XML path is available on the validation machine. Do not commit the cascade XML and do not treat Haar rectangle detection as product-quality tracking.
2. MediaPipe Face Landmarker is the first product-quality candidate to research and evaluate for local landmark, pose, blink, mouth, and expression coverage.
3. ONNX Runtime with a local model is the second candidate, only after a specific model, license, redistribution path, and runtime setup are identified.

### Evaluation gates before implementation

Before adding a backend dependency, model file, cascade XML, or runtime behavior, a candidate PR must review and document:

- Local-only operation is confirmed, with no raw frame persistence, upload, external frame processing, telemetry, or analytics.
- Required runtime packages, native dependencies, build flags, and platform setup are identified.
- Required model, task, cascade, or data files are identified without committing them.
- License, notice, and redistribution risk are reviewed for every runtime and model/data artifact.
- Native Core boundary fit is confirmed; backend code stays behind camera, preprocessing, detector/tracker, and MotionFrame writer seams.
- MotionFrame schema impact is assessed, with no schema expansion unless a separate schema PR is explicitly planned.
- Packaging/runtime setup risk is assessed for local development and future distribution.
- Diagnostics fields needed for measurement are listed before implementation.
- Fallback and lost-face behavior expectations are defined.

### Required local measurements

Collect these values from local diagnostics whenever a candidate is actually run:

- effective FPS
- `captureDurationMs`
- `detectionDurationMs`
- `totalFrameDurationMs`
- `hasFace` / `lostOrNoFace` rate
- startup and shutdown behavior
- detector/backend name reported in diagnostics
- stability notes, including jitter, intermittent frame read failures, and any camera permission or runtime setup issues

### Non-goals for the next candidate PR

- Do not select the final tracking backend.
- Do not add cloud inference or remote frame processing.
- Do not commit model files, task files, cascade XML, raw frames, logs, screenshots, binaries, or build artifacts.
- Do not add UI dependencies on backend runtime packages.
- Do not expand the MotionFrame schema unless that change is intentionally planned in a separate schema PR.

### Recommended next local-validation PR

Run the next candidate validation on the Windows DevPC with Claude Code or another local agent that has direct camera access. Choose either an OpenCV Haar smoke using a trusted local cascade path, or a MediaPipe/ONNX feasibility spike that stops at documented dependency, model, license, runtime, and diagnostics requirements. Record evidence with the diagnostics summarizer, keep raw frames local and uncommitted, and state clearly that no backend has been selected.

## Diagnostics Evidence Workflow

Use this workflow in a future backend evaluation PR after collecting real local measurements. The template below is evidence scaffolding only; leaving it blank or filling it with assumptions is not a validation result by itself.

- Capture diagnostics from stderr-only `[pipeline] periodic:` and `[face] periodic:` lines. Keep stdout reserved for newline-delimited MotionFrame JSON so bridges and protocol consumers remain unchanged.
- Summarize the captured stderr log with `node tools/summarize-native-diagnostics.mjs <stderr-log-path>`. This summarizer reads safe metadata such as pipeline timing fields, `detectionDurationMs`, `hasFace`, detector counts, and has-face / lost-face rates; it must not consume raw frames, pixels, image dumps, or MotionFrame stdout.
- Run `pnpm test:native-diagnostics-summarize` before relying on the summarizer in an evaluation PR.
- Confirm in the PR notes that raw camera frames stayed local to Native Core memory, no uploads or telemetry occurred, no external frame processing was used, and no model files, cascade XML files, raw frames, generated binaries, or build artifacts were committed.
- Treat OpenCV Haar as a smoke/baseline path only. It can provide local detector wiring and diagnostics evidence when OpenCV, a local camera, and a local cascade path are available, but it is not product-quality VTuber tracking and must not be selected as the final backend by this template.

Copy this Markdown block into a future backend evaluation PR only after real local evidence has been collected:

```md
## Diagnostics Evidence

- Date:
- Machine / OS:
- Candidate:
- Camera source:
- Detector / backend:
- Frame count:
- Command used:
- Summarizer command: node tools/summarize-native-diagnostics.mjs <stderr-log-path>
- Summarizer output:
  - pipeline:
  - face:
- Notes / assumptions:
- Raw frame handling confirmation:
  - Raw camera frames stayed local to Native Core memory:
  - No uploads, telemetry, or external frame processing occurred:
  - No raw frames, screenshots, model files, cascade XML files, generated binaries, or build artifacts were committed:
  - stdout remained MotionFrame JSON; diagnostics remained safe stderr metadata:
- Decision impact:
```

## Diagnostics Evidence

### Pass 1 — Dummy/Noop Baseline (2026-06-16)

- Date: 2026-06-16
- Machine / OS: WSL2 — Linux 6.6.87.2-microsoft-standard-WSL2, x86_64
- Candidate: dummy/noop baseline
- Camera source: `dummy`
- Detector / backend: `noop`
- Frame count: 120
- Command used:
  ```bash
  ./native/tracker-core/build/lvk-tracker-core \
    --camera-source dummy \
    --face-detector noop \
    --frames 120 \
    --realtime \
    --log-pipeline-status \
    --pipeline-status-interval 10 \
    --log-face-status \
    --face-status-interval 10 \
    > /tmp/lvk-native-motionframe.jsonl \
    2> /tmp/lvk-native-diagnostics.log
  ```
- Summarizer command: `node tools/summarize-native-diagnostics.mjs /tmp/lvk-native-diagnostics.log`
- Summarizer output:
  - pipeline: 12 periodic reports · `captureDurationMs` avg 0.002495ms · `preprocessDurationMs` avg 0.000506ms · `trackingDurationMs` avg 0.006476ms · `writeDurationMs` avg 0.070878ms · `totalFrameDurationMs` avg 0.080512ms
  - face: 12 periodic reports · `detectionDurationMs` avg 0.000382ms · `hasFaceCount` 0 · `lostOrNoFaceCount` 12 · `hasFaceRate` 0 · `lostOrNoFaceRate` 1 · detectors: `noop` ×12
- Notes / assumptions:
  - `noop` detector always returns `hasFace=false`; `lostOrNoFaceRate=1` is the expected baseline result, not a failure.
  - `writeDurationMs` dominates per-frame cost in `--realtime` mode (stdout flush before pacing); this is expected per README.
  - `totalFrameDurationMs` avg ~0.08ms confirms the pipeline stages are sub-millisecond in dummy/noop mode.
  - OpenCV camera smoke attempted on the same machine (`--camera-source opencv --frames 3 --log-camera-status`). Camera failed to open with `Failed to start local camera source: opencv.` This is the expected result for WSL2 without camera forwarding to `/dev/video0`. CMake confirmed OpenCV was available (core + videoio + imgproc + objdetect); the camera path requires a machine with direct webcam access.
  - Webcam/OpenCV camera, Electron GUI, and OBS Browser Source checks were not performed. This machine is WSL2 without a forwarded webcam device.
- Raw frame handling confirmation:
  - Raw camera frames stayed local to Native Core memory: yes — dummy source produces no real frames.
  - No uploads, telemetry, or external frame processing occurred: yes.
  - No raw frames, screenshots, model files, cascade XML files, generated binaries, or build artifacts were committed: yes.
  - stdout remained MotionFrame JSON; diagnostics remained safe stderr metadata: yes — confirmed by inspecting 120 stdout lines (all valid MotionFrame JSON, `schemaVersion=1`, `source=native`) and 25 stderr lines (all `[pipeline] periodic:` and `[face] periodic:` lines only).
- Decision impact: Dummy/noop baseline confirmed working. Pipeline compiles and runs cleanly on WSL2. Per-stage timing baseline established — all stages sub-millisecond in dummy/noop mode. No backend selected. Next evaluation step is an OpenCV Haar smoke on a machine with direct webcam access, or a first MediaPipe/ONNX candidate evaluation.

### Pass 2 — OpenCV Camera Smoke / Noop Diagnostics (2026-06-16)

- Date: 2026-06-16
- Machine / OS: Windows 11 Pro 10.0.26200, x86-64 (DevPC with USB webcam)
- Candidate: OpenCV camera smoke
- Camera source: `opencv` (backend: MSMF, index 0, 640×480, nominalFps=30, effectiveFps≈27.0)
- Detector / backend: `noop`
- Frame count: 120 (noop diagnostics pass); 30 (initial camera smoke)
- CMake OpenCV feature summary:
  - Built with: `cmake -S native/tracker-core -B native/tracker-core/build-opencv -DCMAKE_TOOLCHAIN_FILE=C:\Users\Dev\Developments\vcpkg\scripts\buildsystems\vcpkg.cmake`
  - LVK OpenCV camera support: ON (components: core + videoio)
  - LVK OpenCV face detector support: ON (components: core + imgproc + objdetect)
  - vcpkg package: `opencv4[calib3d,core,directml,dnn,dshow,fs,gapi,highgui,intrinsics,jpeg,msmf,png,quirc,thread,tiff,webp,win32ui]:x64-windows@4.12.0#3`
- Commands used:

  ```powershell
  # Initial 30-frame camera smoke
  .\native\tracker-core\build-opencv\Release\lvk-tracker-core.exe `
    --camera-source opencv `
    --frames 30 `
    --log-camera-status `
    > $env:TEMP\lvk-opencv-camera-motionframe.jsonl `
    2> $env:TEMP\lvk-opencv-camera-diagnostics.log

  # 120-frame noop diagnostics pass
  .\native\tracker-core\build-opencv\Release\lvk-tracker-core.exe `
    --camera-source opencv `
    --face-detector noop `
    --frames 120 `
    --realtime `
    --log-camera-status `
    --camera-status-interval 10 `
    --log-pipeline-status `
    --pipeline-status-interval 10 `
    --log-face-status `
    --face-status-interval 10 `
    > $env:TEMP\lvk-opencv-noop-motionframe.jsonl `
    2> $env:TEMP\lvk-opencv-noop-diagnostics.log
  ```

- Summarizer command: `node tools/summarize-native-diagnostics.mjs $env:TEMP\lvk-opencv-noop-diagnostics.log`
- Summarizer output:
  - Summarizer returned count=0 for all fields. Root cause: PowerShell's stderr redirection (`2>`) wraps the first native-exe stderr line in a NativeCommandError prefix, which corrupts the log file header and caused the summarizer parser to produce no matches. The raw log content was inspected directly and all 12 periodic reports were present and readable.
  - Manually computed from raw stderr log (12 `[pipeline] periodic:` reports, 12 `[face] periodic:` reports):
    - pipeline: 12 periodic reports · `captureDurationMs` avg ≈38.92ms · `preprocessDurationMs` avg ≈0.00044ms · `trackingDurationMs` avg ≈0.00258ms · `writeDurationMs` avg ≈0.238ms · `totalFrameDurationMs` avg ≈39.16ms
    - face: 12 periodic reports · `detectionDurationMs` avg ≈0.000475ms · `hasFaceCount` 0 · `lostOrNoFaceCount` 12 · `hasFaceRate` 0 · `lostOrNoFaceRate` 1 · detectors: `noop` ×12
    - camera: `failedReadCount` 0 throughout · `effectiveFps` 27.0007 at shutdown
- Notes / assumptions:
  - `noop` detector always returns `hasFace=false`; `lostOrNoFaceRate=1` is the expected baseline result.
  - `captureDurationMs` avg ≈38.9ms reflects real camera frame read time at 30fps (≈33ms/frame nominal). Two periodic intervals showed elevated capture times (≈71ms and ≈67ms) consistent with occasional MSMF buffering; `failedReadCount` remained 0.
  - `effectiveFps≈27.0` is below the nominal 30fps, consistent with MSMF initialization overhead and occasional frame-delivery jitter on this host.
  - The summarizer NativeCommandError issue is a Windows/PowerShell stderr-redirection artifact. It does not affect the native binary's correctness; it affects only the log file parsability on Windows. The summarizer works correctly on Linux (Pass 1). A follow-up fix to the summarizer or the evidence workflow on Windows may be warranted.
  - OpenCV Haar smoke not run: no trusted local cascade XML path was confirmed available. Haar remains a smoke/baseline path, not product-quality tracking.
  - Electron GUI, OBS Browser Source, and OS camera permission checks were not performed in this pass (out of scope for this evidence PR).
- Raw frame handling confirmation:
  - Raw camera frames stayed local to Native Core memory: yes — opencv camera source reads frames into Native Core only; no raw pixel data is written to stdout/stderr or committed.
  - No uploads, telemetry, analytics, or external frame processing occurred: yes.
  - No raw frames, screenshots, model files, cascade XML files, generated binaries, or build artifacts were committed: yes.
  - stdout remained MotionFrame JSON; diagnostics remained safe stderr metadata: yes — confirmed by inspecting 30 stdout lines (initial smoke) and 120 stdout lines (noop pass), all valid MotionFrame JSON (`schemaVersion=1`, `source=native`); stderr contained only `[camera]`, `[pipeline]`, and `[face]` startup/periodic/shutdown lines.
- Decision impact: OpenCV camera source confirmed working on Windows 11 with MSMF backend at 640×480, effectiveFps≈27. Pipeline captures real webcam frames and emits valid MotionFrame JSON. Per-stage overhead (preprocess, tracking, write) remains sub-millisecond in noop mode; camera frame read cost dominates at ≈39ms/frame. No backend selected. Next evaluation step is a MediaPipe Face Landmarker or ONNX Runtime candidate evaluation, or an OpenCV Haar smoke when a trusted cascade XML path is available.

### Pass 3 — OpenCV Haar Smoke Baseline (2026-06-16)

- Date: 2026-06-16
- Machine / OS: Windows 11 Pro 10.0.26200, x86-64 (DevPC with USB webcam)
- Candidate: OpenCV Haar smoke baseline
- Camera source: `opencv` (backend: MSMF, index 0, 640×480, nominalFps=30, effectiveFps≈22.9)
- Detector / backend: `opencv` Haar — `haarcascade_frontalface_default.xml`
- Cascade XML source: official OpenCV 4.12.0 source tree installed locally via vcpkg (`buildtrees/opencv4/src/4.12.0-.../data/haarcascades/`); Apache 2.0 licensed; not committed to the repository
- Frame count: 120
- Command used:
  ```powershell
  .\native\tracker-core\build-opencv\Release\lvk-tracker-core.exe `
    --camera-source opencv `
    --face-detector opencv `
    --face-cascade "<vcpkg-opencv4-src>/data/haarcascades/haarcascade_frontalface_default.xml" `
    --frames 120 `
    --realtime `
    --log-camera-status `
    --camera-status-interval 10 `
    --log-pipeline-status `
    --pipeline-status-interval 10 `
    --log-face-status `
    --face-status-interval 10 `
    > $env:TEMP\lvk-opencv-haar-motionframe.jsonl `
    2> $env:TEMP\lvk-opencv-haar-diagnostics.log
  ```
- Summarizer command: `node tools/summarize-native-diagnostics.mjs $env:TEMP\lvk-opencv-haar-diagnostics.log`
- Summarizer output (Windows UTF-16 LE log parsed correctly after PR #112 fix):
  - pipeline: 12 periodic reports · `captureDurationMs` avg 2.08ms · `preprocessDurationMs` avg 0.000225ms · `trackingDurationMs` avg 34.72ms · `writeDurationMs` avg 0.058ms · `totalFrameDurationMs` avg 36.86ms
  - face: 12 periodic reports · `detectionDurationMs` avg 34.72ms · `hasFaceCount` 0 · `lostOrNoFaceCount` 12 · `hasFaceRate` 0 · `lostOrNoFaceRate` 1 · detectors: `opencv` ×12
- Notes / assumptions:
  - `hasFaceCount=0` / `lostOrNoFaceRate=1`: no face was detected during this 120-frame run. This is a smoke/baseline pass to confirm the Haar detector pipeline wires up and runs end-to-end; face detection quality and real-world detection rate are not evaluated here.
  - `trackingDurationMs` avg 34.72ms dominates the pipeline cost. This is the Haar cascade classification time per frame. Compare to noop baseline avg 0.0026ms (Pass 2) — Haar adds ~34ms of detection overhead per frame at 640×480.
  - `captureDurationMs` avg 2.08ms is much lower than the noop run (38.9ms). In `--realtime` mode with a slow detector (Haar ~35ms/frame), the camera buffers frames between detections, reducing the apparent per-frame capture wait.
  - `effectiveFps≈22.9` at 640×480 with Haar enabled. The nominal 30fps is not achievable with Haar at this resolution on this host.
  - The stdout MotionFrame `tracking.status` was `"lost"` throughout (consistent with `hasFaceCount=0`). Lost-state frames preserved the camera timestamp and emitted neutral tracking values; eye openness remained at the current neutral default (`leftOpen=1.0`, `rightOpen=1.0`).
  - Haar detection quality at this resolution and under real lighting conditions is not evaluated here. Rectangle-only face detection is not suitable as a product-quality VTuber tracking backend.
  - Electron GUI, OBS Browser Source, and OS camera permission checks not performed; out of scope for this evidence PR.
- Raw frame handling confirmation:
  - Raw camera frames stayed local to Native Core memory: yes.
  - No uploads, telemetry, analytics, or external frame processing occurred: yes.
  - No raw frames, screenshots, model files, cascade XML files, generated binaries, or build artifacts were committed: yes. Cascade XML path is local to the vcpkg buildtrees directory and was not committed.
  - stdout remained MotionFrame JSON; diagnostics remained safe stderr metadata: yes — confirmed 120 stdout lines (all valid MotionFrame JSON, `schemaVersion=1`, `source=native`); stderr contained only `[camera]`, `[pipeline]`, and `[face]` startup/periodic/shutdown lines.
- Decision impact: OpenCV Haar detector pipeline confirmed wiring end-to-end on Windows 11 with MSMF backend. Haar detection cost ~34ms/frame at 640×480 limits effective FPS to ~23fps on this host. No face was detected in this smoke run; detection quality was not evaluated. **OpenCV Haar remains a smoke/baseline path only and is not selected as the tracking backend.** Next evaluation step: MediaPipe Face Landmarker candidate research and local setup evaluation.

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
