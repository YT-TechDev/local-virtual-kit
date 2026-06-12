# OpenCV Adoption Design

## Status

Current implementation state, source-grounded as of this planning note:

- Native Core has a safe default `dummy` camera source and `noop` face detector path for deterministic development output.
- Native Core can optionally build an OpenCV camera source when CMake finds OpenCV `core` + `videoio`. This path opens a local camera through Native Core only and preserves the existing MotionFrame JSON output path.
- Native Core can optionally build an OpenCV Haar-cascade face detector when CMake finds OpenCV `core` + `imgproc` + `objdetect` and the user provides a local cascade XML path at run time.
- The generic `FaceDetector` / `FaceTrackingPipeline` seam exists between frame preprocessing and MotionFrame sample generation, but product-quality landmark tracking is not implemented yet.
- Landmark extraction, head pose estimation, gaze, eye openness, mouth/expression tracking, smoothing, and calibration-quality tracking are still future work.
- Codex, cloud runners, CI, WSL, and other headless environments may build or test dummy paths without validating real camera hardware, OS camera permissions, camera backend behavior, or local cascade availability. Do not claim real camera validation unless it was actually run on a machine with the target camera setup.

This remains a documentation-only design note. It does not add dependencies, model files, cascade files, generated assets, or runtime behavior.

## Summary Decision

Recommended approach:

- Treat OpenCV as useful Native Core infrastructure for local camera capture, frame metadata, basic preprocessing, and a baseline/smoke detector only.
- Do not rely on Haar cascade face boxes or OpenCV alone as the final face landmark or VTuber tracking solution.
- Evaluate a dedicated local landmark/model backend before product-grade face tracking work.
- Keep the current dummy camera and dummy/noop tracker paths available for tests, development, and fallback behavior.
- Keep the backend choice behind Native Core abstractions so Electron, Web Preview, and `packages/motion-protocol` do not gain OpenCV or model-runtime ownership.

## Current LVK Native State

The current native tracker core is split into replacement points that let LVK improve tracking quality without crossing architecture boundaries:

- `CameraSource` / `DummyCameraSource` define a camera input abstraction. `dummy` remains the default and safest development source.
- Optional `OpenCvCameraSource` support is available only in native builds where CMake found the required OpenCV camera components. It reads local webcam frames into Native Core memory and does not expose raw frames to stdout, Electron, or Web Preview.
- `CameraSourceOptions` and `createCameraSource(...)` keep camera-source selection explicit.
- `FramePreprocessor`, `FaceDetector`, and `FaceTrackingPipeline` provide seams for local preprocessing and detector/model work.
- `NoopFaceDetector` remains the default detector. The optional OpenCV detector is an opt-in Haar-cascade smoke/baseline path that requires a user-provided local cascade XML file.
- `MotionTracker` / `DummyMotionTracker` and `motion_frame_writer` preserve the current MotionFrame JSON shape.
- `main.cpp` owns CLI parsing, camera source lifecycle, realtime pacing, stop signals, diagnostics, and stdout emission.
- Electron owns development native process lifecycle and status/settings surfaces; it must not own tracking algorithms.

This state is ready for backend evaluation and local smoke testing. It is not yet product-quality face tracking.

## OpenCV Research Notes

### License

OpenCV 4.5.0 and later are licensed under the Apache License 2.0 according to the official OpenCV license page. Earlier OpenCV versions used the 3-clause BSD license.
Official sources:

- [OpenCV license page](https://opencv.org/license/)
- [OpenCV repository LICENSE](https://github.com/opencv/opencv/blob/4.x/LICENSE)
  Decision impact:
- Apache 2.0 is generally suitable for LVK OSS usage.
- A future dependency PR should still review notice, attribution, patent, and third-party binary packaging requirements before release distribution.
- This document is not legal advice.

### C++ and CMake Integration

OpenCV provides C++ APIs and official CMake examples. The official CMake tutorial demonstrates `find_package(OpenCV REQUIRED)` and linking with `${OpenCV_LIBS}`.
Official sources:

- [Using OpenCV with gcc and CMake](https://docs.opencv.org/4.x/db/df5/tutorial_linux_gcc_cmake.html)
- [OpenCV installation overview](https://docs.opencv.org/4.x/d0/d3d/tutorial_general_install.html)
  Future LVK implementation guidance:
- Keep OpenCV usage inside `native/tracker-core`.
- Prefer a minimal component set such as `core`, `imgproc`, and `videoio` if the installed OpenCV package supports component-based discovery.
- Do not add OpenCV to Electron, Web Preview, or `packages/motion-protocol`.
- Keep OpenCV dependency configuration scoped to `native/tracker-core`; do not add OpenCV to Electron, Web Preview, or `packages/motion-protocol`.

### Webcam Capture Capabilities

OpenCV's `cv::VideoCapture` supports camera capture by device index, backend selection through API preferences, `isOpened()` checks, `read(...)`, `grab()`, `retrieve(...)`, and `release()`.
Official source:

- [cv::VideoCapture class reference](https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html)
  Relevant LVK usage:
- Open local webcam by camera index or future camera setting.
- Read frames into local `cv::Mat` memory.
- Retrieve width, height, FPS, and backend diagnostics when available.
- Convert OpenCV frame metadata into the existing `CameraFrame` / future frame buffer structure.

### Relevant Modules

Useful OpenCV modules for LVK camera/preprocessing work:

- `opencv_core`: `cv::Mat`, timing/data primitives.
- `opencv_videoio`: camera and video capture.
- `opencv_imgproc`: color conversion, resize, crop, grayscale, histogram/equalization if needed.
  Baseline or experimental modules, not final tracking decisions by themselves:
- `opencv_objdetect`: possible basic Haar/LBP-style face detection experiments.
- `opencv_dnn`: possible local model inference experiments, but not a tracking strategy by itself.

### Platform and Packaging Notes

OpenCV is cross-platform and officially lists desktop support for Windows, Linux, macOS, and other platforms.
Official sources:

- [OpenCV platforms](https://opencv.org/platforms/)
- [OpenCV Windows installation](https://docs.opencv.org/4.x/d3/d52/tutorial_windows_install.html)
- [OpenCV Linux installation](https://docs.opencv.org/4.x/d7/d9f/tutorial_linux_install.html)
  Implementation notes for LVK:
- **Windows**: likely the primary real camera test target. Packaging must include required OpenCV runtime DLLs with the native executable.
- **Linux**: likely uses system camera devices and backend support such as V4L2 depending on the installed OpenCV build.
- **WSL**: should be treated as development-only for real webcam work unless USB/camera device forwarding is explicitly configured. Microsoft documents that USB device attachment to WSL requires `usbipd-win`; this is not a smooth default end-user camera path.
- **macOS**: useful later, but app permissions, signing/notarization, and camera permission prompts should be handled as a dedicated packaging task.
- **Electron workflow**: OpenCV should stay in the native process. Electron should package/start/stop the native executable and display status, not load or process camera frames.
  WSL source:
- [Microsoft: Connect USB devices to WSL](https://learn.microsoft.com/en-us/windows/wsl/connect-usb)
  Packaging assumptions to verify in implementation PR:
- Runtime library paths and DLL/shared-library discovery.
- Native executable location in development vs packaged Electron builds.
- Camera permissions and backend behavior per OS.
- Whether OpenCV should be statically or dynamically linked for early releases.

## Should LVK Use OpenCV For This?

| Area                          | Recommendation                      | Reason                                                                                          |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Camera capture                | Yes, first adoption target          | `cv::VideoCapture` gives a practical local webcam path behind `CameraSource`.                   |
| Basic preprocessing           | Yes, after capture works            | Color conversion, resize/crop, and grayscale are well-scoped Native Core operations.            |
| Face detection                | Maybe, as a temporary baseline only | Useful for early experiments, but not enough for expressive VTuber tracking.                    |
| Landmark extraction           | No, not by OpenCV alone             | Final landmark quality should be decided separately with a dedicated model/strategy.            |
| All tracking responsibilities | No                                  | OpenCV should not define MotionFrame, renderer mapping, Electron lifecycle, or avatar behavior. |

## Quality-first face tracking direction

LVK should optimize for stable, product-grade local face tracking rather than accepting the first detector that returns a face rectangle. The OpenCV Haar-cascade path is useful for smoke testing camera capture, detector wiring, diagnostics, and fallback behavior, but Haar boxes must not be treated as the final tracking solution.

Decisions for future tracking work:

- OpenCV remains useful for local camera capture, frame metadata, basic preprocessing, and baseline/smoke face detection.
- A dedicated landmark/model backend should be evaluated before the Face Tracking MVP is considered product-grade.
- Candidate future backends include:
  - MediaPipe Face Landmarker.
  - ONNX Runtime with a local face landmark or expression model.
  - Other local-only model pipelines if they preserve LVK's process, privacy, and package boundaries.
- Backend selection must stay behind Native Core abstractions such as the camera, preprocessing, detector/tracker, and MotionFrame writer seams.
- Raw camera frames must remain local to Native Core memory.
- LVK must not add cloud upload, telemetry, analytics, or external frame processing for camera frames.

### Quality bar for the future Face Tracking MVP

A future Face Tracking MVP should meet reviewable quality criteria before it is presented as product-grade tracking:

- Stable face lock under normal desktop lighting and framing, without frequent false lost-face transitions.
- Low visible jitter in normalized head, eye, and mouth values after any Native Core smoothing/calibration.
- Predictable lost-face behavior, including clear confidence/lost-state handling and a safe fallback when tracking cannot continue.
- Usable FPS and timing diagnostics for capture, preprocessing, backend inference/detection, and emitted MotionFrame output.
- Head rotation support sufficient for common VTuber preview movement, rather than only a 2D face box center.
- Eye openness and blink support with documented calibration or threshold behavior.
- Mouth open and smile or expression support good enough to drive the existing MotionFrame fields intentionally.
- Local-only handling for raw and derived camera frames.
- Clear fallback behavior when the selected backend, model file, cascade file, camera, or native feature flag is unavailable.
- No MotionFrame schema changes unless they are intentionally coordinated through Motion Protocol documentation, validation, and renderer compatibility work.

## What OpenCV Should Not Own in LVK

OpenCV must not own:

- MotionFrame schema or compatibility policy.
- Renderer mapping, smoothing, or avatar-specific behavior.
- Electron UI, settings UI, calibration UI, or process lifecycle.
- Local transport protocol or WebSocket behavior.
- Cloud/network behavior, telemetry, analytics, upload, or remote processing.
- The final decision for face landmark/model inference.
- Packaging policy outside the native runtime dependency requirements.

## Alternatives and Adjacent Options

### No OpenCV for v0.1

Good if the goal is to keep v0.1 dummy-only and avoid build complexity. Bad if Phase 6 requires real webcam capture soon.

### Platform Camera APIs

Direct Windows/macOS/Linux camera APIs can reduce dependency size and improve platform-specific control, but they increase implementation and maintenance cost. This is not the smallest useful Phase 6 path.

### MediaPipe

Potentially strong for face landmarks and tracking quality. It is a separate tracking/model decision and may carry build, packaging, and runtime integration complexity. It should not be chosen just to solve camera capture.

### ONNX Runtime

Useful if LVK selects a local landmark or expression model distributed as ONNX. It does not solve camera capture by itself and should remain behind `MotionTracker` / future `FaceTracker` abstractions.

### Lightweight Custom Capture Wrappers

Possible later if OpenCV packaging cost becomes too high. For now, custom wrappers are likely more work than an OpenCV-backed Phase 6 source.

## Responsibility Boundary

### OpenCV-backed Camera Source

Owns:

- Local webcam opening.
- Frame read loop.
- Camera index or selected device handling once Electron exposes settings.
- Frame dimensions and FPS metadata.
- Local-only raw frame memory.
- Camera read diagnostics.
  Does not own:
- MotionFrame schema.
- Avatar mapping.
- Electron UI.
- Cloud/network behavior.
- Face landmark model choice.

### Preprocessing

Owns:

- Color conversion if needed.
- Resizing/cropping if needed.
- Grayscale/equalization only if useful.
- Local-only derived image buffers.
- Preprocessing diagnostics such as frame size and timing.
  Does not own:
- Final MotionFrame output.
- Renderer smoothing.
- Calibration UI.
- Camera device lifecycle.

### Face Tracking / Estimation

Owns:

- Face detection, landmark, or model inference once selected.
- Converting local frame features into normalized tracking values.
- Producing `TrackingSample`-like output.
- Tracking confidence and lost-state decisions.
  Does not own:
- Local transport.
- Renderer mapping.
- Electron process management.
- MotionFrame schema changes unless intentionally coordinated.

### MotionFrame Writer

Owns:

- Serializing `TrackingSample`-like output into current MotionFrame JSON.
- Preserving stdout as newline-delimited protocol output.
- Keeping current `schemaVersion: 1` fields unless the protocol changes intentionally.
  Does not own:
- Camera capture.
- Detection algorithm.
- Renderer behavior.
- OpenCV frame ownership.

### Electron

Owns:

- Starting and stopping the native process.
- Status and settings UI.
- Future camera selection UI.
- Future calibration UI.
- Packaged native executable lifecycle.
  Does not own:
- Tracking algorithm.
- Raw frame processing.
- OpenCV runtime logic.
- MotionFrame value estimation.

### Web Preview

Owns:

- MotionFrame consumption.
- Avatar mapping and rendering.
- OBS-friendly preview behavior.
- Renderer fallback/tolerance for missing, delayed, or lost tracking frames.
  Does not own:
- Camera capture.
- Native tracking.
- OpenCV dependency.
- Raw frame access in v0.1.

## Proposed Native Module Direction

Future module layout, not implemented in this PR:

```txt
native/tracker-core/src/
  camera_source.h/.cpp
  opencv_camera_source.h/.cpp
  frame_preprocessor.h/.cpp
  tracker.h/.cpp
  face_tracker.h/.cpp                (future backend/model work)
  motion_frame_writer.h/.cpp
  main.cpp
```

Why this separation helps:

* Keeps OpenCV out of Electron, Web Preview, and MotionFrame protocol packages.
* Allows DummyCameraSource to remain the default or fallback for tests and development.
* Allows future model choices without changing the MotionFrame protocol.
* Keeps privacy boundaries local and explicit.
* Keeps main.cpp focused on CLI, lifecycle, pacing, diagnostics, and pipeline wiring.

## Recommended Staged Plan

### Stage 1: OpenCV Capture Source

* Current state: optional OpenCV camera capture exists in Native Core builds where the required OpenCV components are found.
* Keep `DummyCameraSource` as the default and safe fallback for CI, development, and environments without a real camera.
* Continue validating that raw camera frames stay local, stdout remains MotionFrame JSON only, and Electron/Web Preview do not gain OpenCV dependencies.
* Preserve current MotionFrame schema.

### Stage 2: Local Frame Preprocessing

* Add FramePreprocessor behind a native-only abstraction.
* Add basic resize/crop/color conversion only when needed.
* Add diagnostics for capture FPS, preprocessing time, dropped frames, and frame dimensions.
* Keep all raw and derived frame buffers local.

### Stage 3: Tracking Backend Evaluation

* Treat OpenCV Haar detection as a baseline/smoke detector only.
* Evaluate MediaPipe Face Landmarker, ONNX Runtime with a local landmark/expression model, or another local-only model path behind Native Core abstractions.
* Keep dummy/noop mode and current MotionFrame output working throughout evaluation.
* Emit only the current MotionFrame schema unless a schema change is intentionally coordinated.
* Do not expose raw frames, model internals, or backend runtime details to Web Preview.

### Stage 4: Smoothing and Calibration

* Add smoothing only after real tracking values exist.
* Add neutral pose, eye open baseline, mouth closed baseline, and camera framing calibration.
* Keep Electron responsible for calibration UI and Native Core responsible for local calibration application.

## Decision Matrix

| Option | Local-first fit | Build complexity | Tracking quality potential | Packaging risk | v0.1 suitability |
| --- | --- | --- | --- | --- | --- |
| OpenCV for capture/preprocessing | High | Medium | Low by itself, but enables pipeline | Medium | Good for Phase 6 |
| OpenCV for face detection | High | Medium | Low to medium | Medium | Temporary baseline only |
| MediaPipe | High if local-only | Medium to high | High for landmarks | Medium to high | Better for backend evaluation |
| ONNX Runtime | High if local model only | Medium | Depends on selected model | Medium | Good only after model choice |
| Platform APIs | High | High per platform | Capture only | Medium | Not smallest Phase 6 path |
| No external dependency yet | High | Low | None for real camera/tracking | Low | Good for docs/dummy-only, not enough for real camera/tracking |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Dependency size grows quickly | Keep optional dependencies scoped to Native Core and avoid broad dependency upgrades. |
| Build complexity increases | Keep feature detection and local setup documentation clear; preserve dummy builds. |
| Packaging becomes fragile | Verify runtime library discovery on Windows first, then Linux/macOS separately. |
| Platform camera permission issues | Treat permissions/backend behavior as explicit diagnostics, not silent failure. |
| WSL camera behavior differs from real Windows | Use WSL for development only; validate real capture on host OS. |
| Latency or dropped frames | Add capture FPS and dropped-frame diagnostics before tracking. |
| False sense that OpenCV solves landmarks | Keep capture/preprocessing and Haar smoke detection separate from product-quality landmark/backend selection. |
| Privacy regression | Keep raw frames in Native Core memory only; never add upload/telemetry/network behavior. |

## Non-goals

* No dependency changes in this PR.
* No CMake dependency configuration changes in this PR.
* No MotionFrame schema changes.
* No Web Preview changes.
* No Electron behavior changes.
* No new face detection implementation.
* No landmark extraction implementation.
* No telemetry, analytics, cloud upload, or external runtime behavior.

## Final Recommendation

The next tracking implementation work should evaluate a product-quality local landmark/model backend behind Native Core abstractions before expanding the Face Tracking MVP. OpenCV should continue to serve capture, preprocessing, frame metadata, and baseline/smoke detection needs, while dummy/noop mode and the current MotionFrame output remain stable.

The success criteria for that evaluation should be:

* Candidate backends are compared on local-only operation, tracking quality, latency/FPS diagnostics, packaging risk, and fit with LVK boundaries.
* OpenCV Haar detection remains clearly labeled as a baseline/smoke path, not final VTuber-grade tracking.
* Raw frames remain local to the native process.
* The native pipeline still emits current MotionFrame JSON unless schema work is intentionally coordinated.
* Dummy mode remains available for CI and development.
* Electron and Web Preview do not gain OpenCV, MediaPipe, ONNX Runtime, or model-specific dependencies.
