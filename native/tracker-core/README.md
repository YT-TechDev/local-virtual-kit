# LVK Tracker Core

This is the first minimal C++ Native Tracker skeleton for LVK.

The current executable does not access a real camera, open a network transport, or run real tracking. It uses a local dummy camera source abstraction that emits synthetic frame metadata only, then passes each frame to `DummyMotionTracker` and writes deterministic MotionFrame-shaped dummy JSON lines to stdout so later Electron process lifecycle and local transport work can integrate against the current protocol shape.

## Build

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
```

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

Camera diagnostics are written to stderr only. Stdout remains newline-delimited MotionFrame JSON, so the desktop and WebSocket bridge pipelines can keep treating stdout as protocol data. The diagnostics report the dummy source name, running state, dimensions, nominal FPS, emitted frame count, and shutdown effective FPS.

The native CLI now makes the camera source and dummy source parameters explicit:

- `--camera-source dummy` selects the dummy camera source. `dummy` is the only supported source for now.
- `--camera-width N` configures the dummy source width. `N` must be an integer from 1 to 7680.
- `--camera-height N` configures the dummy source height. `N` must be an integer from 1 to 4320.
- `--camera-fps N` configures the dummy source nominal FPS. `N` must be between 1 and 240.

For example:

```bash
./native/tracker-core/build/lvk-tracker-core --frames 3 --camera-source dummy --camera-width 1280 --camera-height 720 --camera-fps 30 --log-camera-status
```

This is still a dummy metadata source with dummy tracking values; real camera capture and real face tracking are not implemented yet. This PR does not implement real camera capture.

For desktop-managed development pipelines that should keep running until stopped by the parent process, use continuous realtime mode:

```bash
./native/tracker-core/build/lvk-tracker-core --continuous --realtime
```

## Development WebSocket bridge

For local Web Preview development with `?source=native`, pipe the native dummy stdout into the development-only MotionFrame WebSocket bridge:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
./native/tracker-core/build/lvk-tracker-core --continuous --realtime | node tools/motion-ws-bridge.mjs
```

The bridge binds only to `ws://127.0.0.1:45731/motion`, accepts newline-delimited MotionFrame JSON from stdin, and broadcasts valid native frames to connected browser previews. It is temporary development tooling, not the final production native transport.

## Desktop Shell development pipeline

After the native tracker has been built, the LVK Desktop Shell can start and stop the current development dummy pipeline from Electron Main Process. The shell runs the built tracker with `--continuous --realtime`, pipes stdout into `tools/motion-ws-bridge.mjs`, and serves frames at `ws://127.0.0.1:45731/motion` for the Web Preview native source URL.

This Desktop Shell control is development-only and still does not add camera capture, real tracking, or the final production native transport.

## Camera input status

Native camera input is currently a local dummy abstraction. `DummyCameraSource` creates synthetic frame metadata such as sequence number, timestamp, dimensions, and nominal FPS so the tracker can be wired for future capture work without touching real devices. Real camera capture, raw image storage/output, OpenCV, telemetry, upload, and network behavior are intentionally not implemented yet.

## Tracking abstraction

Current native tracking is provided by `DummyMotionTracker`. It is a small replacement point between the camera frame source and MotionFrame JSON output, preserving the existing deterministic dummy values while keeping real face tracking out of scope for this skeleton.

## Output policy

- Emits one JSON object per line.
- Uses `schemaVersion: 1`.
- Uses `source: "native"`.
- Uses `tracking.status: "tracking"` and `tracking.confidence: 1`.
- Emits the current `face.position`, `face.rotation`, `eyes`, and `mouth` MotionFrame fields.
- Does not emit stale fields such as `face.detected`, `head.*`, `eyes.blink`, or `emotion`.

## Out of scope

- Real camera capture.
- Face detection or landmark extraction.
- OpenCV, MediaPipe, ONNX Runtime, or other heavy tracking dependencies.
- Production native WebSocket or localhost transport.
- Production Electron/native transport packaging.
- Remote processing, telemetry, analytics, or cloud upload.
