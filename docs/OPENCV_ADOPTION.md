# OpenCV Adoption Design
## Status
Proposed / not implemented yet.
This is a documentation-only design note. It does not add OpenCV as a dependency, does not modify CMake, and does not implement real camera capture, face detection, or landmark extraction.
## Summary Decision
Recommended approach:
- Use OpenCV first for local camera capture and basic preprocessing in the Native Core only.
- Do not rely on OpenCV alone as the final face landmark or VTuber tracking solution.
- Keep the real tracking model choice separate from the camera capture decision.
- Keep the current dummy camera and dummy tracker path available for tests and development.
- Do not add OpenCV until the next implementation PR that actually adds `OpenCvCameraSource`.
OpenCV is a good candidate for Phase 6 camera input and early preprocessing. Phase 7 face tracking should still evaluate a dedicated strategy such as MediaPipe, ONNX Runtime, or another local model pipeline.
## Current LVK Native State
The current native tracker core is already split into small replacement points:
- `CameraSource` / `DummyCameraSource` define a camera input abstraction. The current source emits synthetic frame metadata only.
- `CameraSourceOptions` and `createCameraSource(...)` make camera-source selection explicit. Only `dummy` is currently supported.
- `MotionTracker` / `DummyMotionTracker` convert a `CameraFrame` into a native `TrackingSample`.
- `motion_frame_writer` serializes `TrackingSample` into the current MotionFrame JSON shape.
- `main.cpp` owns CLI parsing, camera source lifecycle, realtime pacing, stop signals, diagnostics, and stdout emission.
- Electron owns the development native pipeline lifecycle and keeps the renderer sandboxed.
This state is ready for an OpenCV adoption decision because the camera source and tracker abstractions exist. It is not yet ready for broad face-tracking implementation because real frames, preprocessing, model choice, calibration, and diagnostics still need to be added in stages.

The Native Core now also has a generic `FaceDetector` / `FaceTrackingPipeline` seam between `FramePreprocessor` and MotionFrame sample generation. The current detector is a no-op and intentionally does not add OpenCV face detection, landmark extraction, or real tracking values yet.

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
- Add CMake dependency configuration only in the implementation PR that adds a real OpenCV-backed source.
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
Likely useful modules for LVK Phase 6:
- `opencv_core`: `cv::Mat`, timing/data primitives.
- `opencv_videoio`: camera and video capture.
- `opencv_imgproc`: color conversion, resize, crop, grayscale, histogram/equalization if needed.
Potential but not final tracking modules:
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
| Area | Recommendation | Reason |
| --- | --- | --- |
| Camera capture | Yes, first adoption target | `cv::VideoCapture` gives a practical local webcam path behind `CameraSource`. |
| Basic preprocessing | Yes, after capture works | Color conversion, resize/crop, and grayscale are well-scoped Native Core operations. |
| Face detection | Maybe, as a temporary baseline only | Useful for early experiments, but not enough for expressive VTuber tracking. |
| Landmark extraction | No, not by OpenCV alone | Final landmark quality should be decided separately with a dedicated model/strategy. |
| All tracking responsibilities | No | OpenCV should not define MotionFrame, renderer mapping, Electron lifecycle, or avatar behavior. |
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
  opencv_camera_source.h/.cpp        (future)
  frame_preprocessor.h/.cpp          (future)
  tracker.h/.cpp
  face_tracker.h/.cpp                (future)
  motion_frame_writer.h/.cpp
  main.cpp

Why this separation helps:

* Keeps OpenCV out of Electron, Web Preview, and MotionFrame protocol packages.
* Allows DummyCameraSource to remain the default or fallback for tests and development.
* Allows future model choices without changing the MotionFrame protocol.
* Keeps privacy boundaries local and explicit.
* Keeps main.cpp focused on CLI, lifecycle, pacing, diagnostics, and pipeline wiring.

Recommended Staged Plan

Stage 1: OpenCV Capture Source

* Add OpenCV dependency to native/tracker-core only.
* Add OpenCvCameraSource behind the existing CameraSource interface.
* Add --camera-source opencv or a clearer device-specific source name.
* Keep dummy as the default if this is safer for CI and development.
* Do not add face tracking yet.
* Emit dummy tracking values from real camera frame metadata to prove capture/lifecycle/diagnostics.
* Preserve current MotionFrame schema.

Stage 2: Local Frame Preprocessing

* Add FramePreprocessor behind a native-only abstraction.
* Add basic resize/crop/color conversion only when needed.
* Add diagnostics for capture FPS, preprocessing time, dropped frames, and frame dimensions.
* Keep all raw and derived frame buffers local.

Stage 3: Face Tracking Strategy

* Add FaceTracker or replace DummyMotionTracker behind the existing tracker abstraction.
* Evaluate OpenCV detection, MediaPipe, ONNX Runtime, or another local model path separately.
* Emit only the current MotionFrame schema.
* Do not expose model internals to Web Preview.

Stage 4: Smoothing and Calibration

* Add smoothing only after real tracking values exist.
* Add neutral pose, eye open baseline, mouth closed baseline, and camera framing calibration.
* Keep Electron responsible for calibration UI and Native Core responsible for local calibration application.

Decision Matrix

Option	Local-first fit	Build complexity	Tracking quality potential	Packaging risk	v0.1 suitability
OpenCV for capture/preprocessing	High	Medium	Low by itself, but enables pipeline	Medium	Good for Phase 6
OpenCV for face detection	High	Medium	Low to medium	Medium	Temporary baseline only
MediaPipe	High if local-only	Medium to high	High for landmarks	Medium to high	Better for Phase 7 evaluation
ONNX Runtime	High if local model only	Medium	Depends on selected model	Medium	Good only after model choice
Platform APIs	High	High per platform	Capture only	Medium	Not smallest Phase 6 path
No external dependency yet	High	Low	None for real camera/tracking	Low	Good for docs/dummy-only, not enough for Phase 6

Risks and Mitigations

Risk	Mitigation
Dependency size grows quickly	Add minimal OpenCV modules only; avoid broad dependency upgrades.
Build complexity increases	Keep OpenCV in one native PR; document local setup and CI behavior clearly.
Packaging becomes fragile	Verify runtime library discovery on Windows first, then Linux/macOS separately.
Platform camera permission issues	Treat permissions/backend behavior as explicit diagnostics, not silent failure.
WSL camera behavior differs from real Windows	Use WSL for development only; validate real capture on host OS.
Latency or dropped frames	Add capture FPS and dropped-frame diagnostics before tracking.
False sense that OpenCV solves landmarks	Keep capture/preprocessing separate from face tracking/model selection.
Privacy regression	Keep raw frames in Native Core memory only; never add upload/telemetry/network behavior.

Non-goals

* No real camera implementation in this PR.
* No dependency changes in this PR.
* No CMake dependency configuration changes in this PR.
* No MotionFrame schema changes.
* No Web Preview changes.
* No Electron behavior changes.
* No face detection implementation.
* No landmark extraction implementation.
* No telemetry, analytics, cloud upload, or external runtime behavior.

Final Recommendation

The next implementation PR should add OpenCV only as a Native Core dependency and implement OpenCvCameraSource behind the existing CameraSource interface. It should keep DummyCameraSource available, preserve the current MotionFrame schema, and avoid face detection or landmark extraction.

The success criteria for that next PR should be:

* --camera-source opencv opens a local webcam on at least one primary target platform.
* Raw frames remain local to the native process.
* The native pipeline still emits current MotionFrame JSON.
* Tracking values remain dummy or metadata-derived until Phase 7.
* Diagnostics clearly report camera open/read failures, dimensions, FPS, and frame counts.
* Electron and Web Preview do not gain OpenCV dependencies.
