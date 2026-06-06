# Architecture

This document defines system boundaries. It should not duplicate Git workflow or coding-agent instructions.

---

## 1. Overview

LVK uses a hybrid native + web architecture.

```txt
Webcam
  ↓
C++ Native Tracking Core
  ↓
MotionFrame Protocol
  ↓
React / Three.js / React Three Fiber Web Preview
  ↓
Electron Desktop App and OBS Browser Source workflow
```

The system should be developed layer by layer, with `MotionFrame` as the stable contract between tracking and rendering.

---

## 2. Architectural Goals

- Keep raw camera processing local.
- Keep tracking independent from UI.
- Keep rendering independent from native implementation details.
- Allow renderer development with dummy data.
- Allow Electron to manage native process lifecycle.
- Keep each layer replaceable behind clear contracts.

---

## 3. Components

### Native Tracking Core

Planned location:

```txt
native/tracker-core/
```

Owns:

- camera input
- frame preprocessing
- face detection
- landmark or feature extraction
- head pose estimation
- eye/mouth value estimation
- normalization
- smoothing
- MotionFrame output

Does not own:

- React UI
- Electron settings UI
- avatar rendering
- cloud sync
- account/payment logic

### Motion Protocol

Location:

```txt
packages/motion-protocol/
```

Owns:

- TypeScript MotionFrame types
- dummy frame generation
- schema compatibility rules
- future validation helpers

Does not own:

- React components
- Three.js/R3F objects
- Electron process management
- OpenCV/MediaPipe runtime logic
- native platform APIs

### Web Preview / Avatar Renderer

Current location:

```txt
apps/web-preview/
```

Possible future package:

```txt
packages/avatar-renderer/
```

Owns:

- consuming MotionFrame data
- mapping MotionFrame values to avatar-specific motion
- R3F rendering
- dummy preview mode
- OBS-friendly preview route

Does not own:

- native tracking implementation
- raw camera frame processing in v0.1
- native process lifecycle management
- desktop settings persistence

### Electron Desktop App

Location:

```txt
apps/desktop/
```

Owns:

- app shell
- settings UI
- calibration UI
- native process start/stop
- preview URL/status display
- local configuration management

Does not own:

- tracking algorithms
- deep avatar rendering internals
- camera frame upload
- server-side processing

---

## 4. Process Model

v0.1 should prefer a separate native process.

```txt
Electron Main Process
  ├─ starts/stops native tracker executable
  ├─ manages local config
  └─ opens desktop UI

Native Tracker Process
  ├─ reads webcam locally
  ├─ generates MotionFrame
  └─ sends MotionFrame through local transport

Web Preview
  ├─ connects to MotionFrame source
  ├─ maps MotionFrame to avatar state
  └─ renders OBS-friendly preview
```

---

## 5. Communication

Default v0.1 transport:

```txt
WebSocket + JSON over localhost
```

Draft endpoint:

```txt
ws://127.0.0.1:45731/motion
```

Future options may include compact JSON, binary WebSocket, UDP, shared memory, or a native OBS bridge. Do not introduce these until needed.

---

## 6. Runtime Modes

- **Dummy Preview Mode**: frontend-only renderer development using TypeScript dummy MotionFrame data.
- **Native Dummy Mode**: native process emits artificial MotionFrame data.
- **Real Tracking Mode**: webcam → native tracker → MotionFrame → preview.

---

## 7. Privacy Model

- Raw camera frames stay local.
- MotionFrame values are transmitted locally by default.
- No external camera upload in v0.1.
- Cloud features are out of scope for v0.1.

---

## 8. Optional Flow Avatar Example

v0.1 core uses plain R3F.

A future optional example may use the user's R3F flow library only after that library is public and stable:

```txt
examples/flow-avatar
```

This must remain optional and must not replace the stable baseline preview.
