# LVK Tracker Core

This is the first minimal C++ Native Tracker skeleton for LVK.

The executable can always run with the safest default dummy camera source. When CMake finds OpenCV, it can also build a local OpenCV camera source for Native Core-only webcam capture. Both paths still pass frame metadata to `DummyMotionTracker` and write deterministic MotionFrame-shaped dummy JSON lines to stdout so later Electron process lifecycle and local transport work can integrate against the current protocol shape.

## Build

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
```

The dummy camera source builds without OpenCV. The optional OpenCV camera source is enabled only when CMake can discover an OpenCV development package with `find_package(OpenCV QUIET COMPONENTS core videoio)`. When found, OpenCV is linked only into the native `lvk-tracker-core` executable; Electron, Web Preview, and `packages/motion-protocol` do not gain OpenCV dependencies.

## Run

```bash
./native/tracker-core/build/lvk-tracker-core
```

By default, the executable emits 120 JSON lines.

A smaller finite frame count can be requested with:

```bash
./native/tracker-core/build/lvk-tracker-core --frames 10
```

For development flows that need progressive dummy output, add `--realtime` to pace stdout at approximately the dummy camera source nominal FPS while preserving deterministic `timestampMs` values:

```bash
./native/tracker-core/build/lvk-tracker-core --frames 600 --realtime
```

Without `--realtime`, the executable preserves the default fast deterministic output behavior.

To inspect the current local dummy camera source state without changing stdout, add `--log-camera-status`:

```bash
./native/tracker-core/build/lvk-tracker-core --frames 10 --log-camera-status
```

Camera diagnostics are written to stderr only. Stdout remains newline-delimited MotionFrame JSON, so the desktop and WebSocket bridge pipelines can keep treating stdout as protocol data. The diagnostics report the source name, running state, dimensions, nominal or effective FPS, emitted frame count, camera index, backend name, failed read count, and shutdown effective FPS when available. Raw frames are never printed or written.

The native CLI now makes the camera source and dummy source parameters explicit:

- `--camera-source dummy` selects the dummy camera source. `dummy` remains the default and safest development source.
- `--camera-source opencv` selects the Native Core-only OpenCV local camera source when this binary was configured with OpenCV support.
- `--camera-index N` configures the OpenCV camera device index. `N` must be an integer from 0 to 16.
- `--camera-width N` configures the requested camera source width. `N` must be an integer from 1 to 7680.
- `--camera-height N` configures the requested camera source height. `N` must be an integer from 1 to 4320.
- `--camera-fps N` configures the requested camera source nominal FPS. `N` must be between 1 and 240.
- `--camera-status-interval N` writes periodic camera diagnostics every `N` emitted frames when `--log-camera-status` is also set. `N` must be between 1 and 100000. If omitted, diagnostics remain startup/shutdown only.

For example:

```bash
./native/tracker-core/build/lvk-tracker-core --frames 3 --camera-source dummy --camera-width 1280 --camera-height 720 --camera-fps 30 --log-camera-status
```

The dummy source is still a metadata-only source with dummy tracking values. The OpenCV source reads local webcam frames into Native Core memory, converts only frame metadata into the existing `CameraFrame`, and still uses dummy tracking values. Real face detection, landmark extraction, and VTuber tracking are not implemented yet.

For desktop-managed development pipelines that should keep running until stopped by the parent process, use continuous realtime mode:

```bash
./native/tracker-core/build/lvk-tracker-core --continuous --realtime
```

## OpenCV camera source

`--camera-source opencv` is available only in native builds where CMake found OpenCV. In those builds it opens a local webcam through OpenCV `VideoCapture`, reads frames inside the native process, and emits the existing MotionFrame JSON schema through the unchanged dummy tracker pipeline. Raw frame pixels remain local to Native Core memory; they are not written to disk and are not printed to stdout or stderr.

Example finite smoke test:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --frames 3 --log-camera-status
```

Example continuous local capture:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --continuous --realtime --log-camera-status
```

Example OpenCV diagnostics with periodic status every 60 emitted frames:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --camera-index 0 --continuous --realtime --log-camera-status --camera-status-interval 60
```

To choose a camera device explicitly:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --camera-index 0 --continuous --realtime --log-camera-status --camera-status-interval 60
```

This is local camera capture only. `DummyMotionTracker` still provides MotionFrame values, and the MotionFrame schema is unchanged. If OpenCV is not found at configure time, dummy builds still succeed and requesting `--camera-source opencv` fails clearly at runtime. Electron, Web Preview, and `packages/motion-protocol` do not gain OpenCV dependencies.

## Development WebSocket bridge

For local Web Preview development with `?source=native`, pipe the native dummy stdout into the development-only MotionFrame WebSocket bridge:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
./native/tracker-core/build/lvk-tracker-core --camera-source dummy --continuous --realtime | node tools/motion-ws-bridge.mjs
```

For OpenCV-backed local capture in builds configured with OpenCV support:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --camera-index 0 --continuous --realtime --log-camera-status --camera-status-interval 60 | node tools/motion-ws-bridge.mjs
```

The bridge binds only to `ws://127.0.0.1:45731/motion`, accepts newline-delimited MotionFrame JSON from stdin, and broadcasts valid native frames to connected browser previews. It is temporary development tooling, not the final production native transport.

## Desktop Shell development pipeline

After the native tracker has been built, the LVK Desktop Shell can start and stop the current development native pipeline from Electron Main Process. The shell can choose either `--camera-source dummy` or the Native Core-only `--camera-source opencv --camera-index 0` path, adds `--camera-status-interval 60` for OpenCV diagnostics, pipes stdout into `tools/motion-ws-bridge.mjs`, and serves frames at `ws://127.0.0.1:45731/motion` for the Web Preview native source URL.

This Desktop Shell control is development-only. OpenCV mode is local capture-only, `DummyMotionTracker` still provides MotionFrame values, and real face tracking or the final production native transport remain out of scope.

## Camera input status

Native camera input supports a local dummy abstraction and, when enabled at configure time, a Native Core-only OpenCV camera source. `DummyCameraSource` creates synthetic frame metadata such as sequence number, timestamp, dimensions, and nominal FPS. Its diagnostics use `cameraIndex=-1`, `backendName=dummy`, and `failedReadCount=0`. `OpenCvCameraSource` reads local webcam frames through OpenCV and exposes only metadata to the existing tracker interface. Its diagnostics include the requested camera index, OpenCV backend name when available, and a count of failed or empty `VideoCapture::read` attempts. Raw image storage/output, telemetry, upload, and external network behavior are intentionally not implemented.

## Frame preprocessing boundary

The native pipeline now includes a small `FramePreprocessor` seam between `CameraSource` and `MotionTracker`. The current implementation uses `NoopFramePreprocessor`, which returns metadata matching the original `CameraFrame` dimensions and does not allocate or expose image buffers.

This boundary intentionally does not resize, crop, color-convert, grayscale-convert, equalize, detect faces, extract landmarks, or produce real VTuber tracking values yet. Raw camera frames remain local to Native Core and are not exposed to Electron, Web Preview, stdout, stderr, or disk. Future local preprocessing should live behind this Native Core abstraction after the pipeline boundary is stable; real-device camera validation is intentionally deferred until then.

## Face tracking pipeline boundary

The native pipeline now includes a generic `FaceDetector` interface and a `FaceTrackingPipeline` seam on top of the existing `FramePreprocessor` boundary. The current implementation uses `NoopFaceDetector`, which returns no detected face, zero confidence, and zeroed bounds without inspecting image data or using OpenCV face-detection modules.

`FaceTrackingPipeline` now maps positive `FaceDetectionResult` metadata into safe `TrackingSample` values through a small factory layer. The mapper clamps confidence, derives only a coarse normalized face position from detector bounds, and keeps rotation, eyes, gaze, and mouth values neutral until local landmarks exist. A safe lost-sample helper also exists for future no-face handling.

The default `NoopFaceDetector` still returns no face, so the pipeline keeps falling back to `DummyMotionTracker` for the same deterministic MotionFrame values as before. No real face detection, OpenCV face detection, landmark extraction, lost-state policy change, or real VTuber tracking values are implemented yet. OpenCV capture may exist for local Native Core-only camera input, but OpenCV face detection is intentionally not implemented in this phase.

Raw frames remain local to Native Core memory and are not exposed to Electron, Web Preview, stdout, stderr, or disk. Local real-device validation remains deferred until the camera, preprocessing, and tracking boundaries are stable.

## Tracking abstraction

Current native tracking is provided by `DummyMotionTracker`. It is a small replacement point between the camera frame source and MotionFrame JSON output, preserving the existing deterministic dummy values while keeping real face tracking out of scope for this skeleton.

`TrackingSample` owns the native tracking status and confidence used by MotionFrame serialization. The current dummy tracker emits `TrackingStatus::Tracking` with confidence `1.0`; future local face detection or lost-state work can set `lost` or lower confidence without changing the MotionFrame writer shape.

MotionFrame JSON serialization is handled by the native MotionFrame writer module, keeping stdout formatting separate from CLI parsing, camera source lifecycle, realtime pacing, and tracking/value estimation.

## Output policy

- Emits one JSON object per line.
- Uses `schemaVersion: 1`.
- Uses `source: "native"`.
- Uses tracking status and confidence from `TrackingSample`; current dummy output remains `tracking.status: "tracking"` and `tracking.confidence: 1`.
- Emits the current `face.position`, `face.rotation`, `eyes`, and `mouth` MotionFrame fields.
- Does not emit stale fields such as `face.detected`, `head.*`, `eyes.blink`, or `emotion`.

## Out of scope

- Real face detection or landmark extraction.
- Real VTuber tracking values.
- MediaPipe, ONNX Runtime, or other face-tracking dependencies.
- Production native WebSocket or localhost transport.
- Production Electron/native transport packaging.
- Remote processing, telemetry, analytics, or cloud upload.
