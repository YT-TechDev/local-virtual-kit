# Architecture Design

## 1. Overview

LVK uses a hybrid native + web architecture.

```txt
Webcam
  ↓
C++ Native Tracking Core
  ↓
MotionFrame Protocol
  ↓
React / Three.js / React Three Fiber Preview
  ↓
Electron Desktop App / OBS Browser Source
```

## 2. Architectural Goals

- Keep camera processing local.
- Keep tracking independent from UI.
- Keep avatar rendering independent from tracking internals.
- Allow renderer development with dummy data.
- Allow Electron to manage native process lifecycle.
- Allow future avatar format expansion.

## 3. Component Responsibilities

### Native Tracking Core

Location:

```txt
native/tracker-core/
```

Responsibilities:

- camera input
- frame preprocessing
- face detection
- landmark extraction
- head pose estimation
- eye/mouth/expression estimation
- normalization
- smoothing
- MotionFrame output

### Motion Protocol

Location:

```txt
packages/motion-protocol/
```

Responsibilities:

- MotionFrame TypeScript types
- C++ structure draft
- sample/dummy frames
- future validation utilities

### Web Preview / Avatar Renderer

Location:

```txt
apps/web-preview/
packages/avatar-renderer/
examples/basic-r3f-avatar/
```

Responsibilities:

- receive MotionFrame
- apply motion mapping
- render avatar using R3F
- provide OBS-safe route
- support dummy mode

### Electron Desktop App

Location:

```txt
apps/desktop/
```

Responsibilities:

- start/stop native tracker process
- manage local settings
- provide calibration UI
- display preview URL
- show tracker status

## 4. Process Model

v0.1 should prefer a separate native process.

```txt
Electron Main Process
  ├─ starts native tracker executable
  ├─ manages local config
  └─ opens desktop UI

Native Tracker Process
  ├─ reads webcam
  ├─ generates MotionFrame
  └─ sends MotionFrame through WebSocket

Web Preview
  ├─ connects to MotionFrame WebSocket
  ├─ maps MotionFrame to avatar motion
  └─ renders OBS-compatible preview
```

## 5. Communication

v0.1 uses:

```txt
WebSocket + JSON
```

Draft local endpoint:

```txt
ws://127.0.0.1:45731/motion
```

Future options:

- compact JSON
- binary WebSocket
- UDP
- shared memory
- native OBS bridge

## 6. Runtime Modes

- Dummy Preview Mode: frontend-only renderer development
- Native Dummy Mode: native process emits artificial MotionFrame
- Real Tracking Mode: webcam → native tracker → MotionFrame → preview

## 7. Local-first Privacy Model

- Raw camera frames stay local.
- MotionFrame values are transmitted locally.
- No external camera upload in v0.1.
- Cloud features are out of scope for v0.1.

## 8. R3F Flow Library Integration

v0.1 uses plain R3F.

Future:

```txt
examples/flow-avatar
  → optional example using the user's R3F flow library
```

This example should be added only after the library becomes public and stable.
