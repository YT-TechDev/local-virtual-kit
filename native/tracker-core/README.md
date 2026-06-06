# LVK Tracker Core

This is the first minimal C++ Native Tracker skeleton for LVK.

The current executable does not access a camera, open a network transport, or run real tracking. It emits deterministic MotionFrame-shaped dummy JSON lines to stdout so later Electron process lifecycle and local transport work can integrate against the current protocol shape.

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

## Output policy

- Emits one JSON object per line.
- Uses `schemaVersion: 1`.
- Uses `source: "native"`.
- Uses `tracking.status: "tracking"` and `tracking.confidence: 1`.
- Emits the current `face.position`, `face.rotation`, `eyes`, and `mouth` MotionFrame fields.
- Does not emit stale fields such as `face.detected`, `head.*`, `eyes.blink`, or `emotion`.

## Out of scope

- Camera capture.
- Face detection or landmark extraction.
- OpenCV, MediaPipe, ONNX Runtime, or other heavy tracking dependencies.
- WebSocket or localhost transport.
- Electron process lifecycle integration.
- Remote processing, telemetry, analytics, or cloud upload.
