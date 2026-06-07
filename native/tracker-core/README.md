# LVK Tracker Core

This is the first minimal C++ Native Tracker skeleton for LVK.

The current executable does not access a real camera, open a network transport, or run real tracking. It uses a local dummy camera source abstraction that emits synthetic frame metadata only, then writes deterministic MotionFrame-shaped dummy JSON lines to stdout so later Electron process lifecycle and local transport work can integrate against the current protocol shape.

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

## Development WebSocket bridge

For local Web Preview development with `?source=native`, pipe the native dummy stdout into the development-only MotionFrame WebSocket bridge:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
./native/tracker-core/build/lvk-tracker-core --frames 600 --realtime | node tools/motion-ws-bridge.mjs
```

The bridge binds only to `ws://127.0.0.1:45731/motion`, accepts newline-delimited MotionFrame JSON from stdin, and broadcasts valid native frames to connected browser previews. It is temporary development tooling, not the final production native transport.

## Desktop Shell development pipeline

After the native tracker has been built, the LVK Desktop Shell can start and stop the current development dummy pipeline from Electron Main Process. The shell runs the built tracker with `--frames 600 --realtime`, pipes stdout into `tools/motion-ws-bridge.mjs`, and serves frames at `ws://127.0.0.1:45731/motion` for the Web Preview native source URL.

This Desktop Shell control is development-only and still does not add camera capture, real tracking, or the final production native transport.

## Camera input status

Native camera input is currently a local dummy abstraction. `DummyCameraSource` creates synthetic frame metadata such as sequence number, timestamp, dimensions, and nominal FPS so the tracker can be wired for future capture work without touching real devices. Real camera capture, raw image storage/output, OpenCV, telemetry, upload, and network behavior are intentionally not implemented yet.

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
