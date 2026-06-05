# Technical Stack

## 1. Stack Overview

```txt
Native Core: C++ / CMake
Desktop App: Electron / React / TypeScript
Web Preview: React / Three.js / React Three Fiber / TypeScript
Workspace: pnpm monorepo
Protocol: MotionFrame over WebSocket JSON
```

## 2. Native Core

- Language: C++17 or C++20
- Build system: CMake
- Candidate libraries: OpenCV, MediaPipe Face Landmarker, ONNX Runtime later if needed

v0.1 should first implement a native skeleton and dummy sender before adding heavy tracking dependencies.

## 3. Desktop App

- Framework: Electron
- UI: React + TypeScript
- Responsibility: app shell, settings, calibration, native process lifecycle, preview URL

## 4. Web Preview

- React
- TypeScript
- Vite
- Three.js
- React Three Fiber

v0.1 uses plain handwritten R3F.

## 5. Monorepo

Recommended:

```txt
pnpm workspace
```

Layout:

```txt
apps/desktop
apps/web-preview
native/tracker-core
packages/motion-protocol
packages/avatar-renderer
examples/basic-r3f-avatar
examples/flow-avatar
```

## 6. Package Naming

Future package names may use:

```txt
@lvk/motion-protocol
@lvk/avatar-renderer
@lvk/tracker-bridge
@lvk/config
```

## 7. Dependency Policy

- Keep `motion-protocol` lightweight and framework-independent.
- Keep native dependencies isolated under `native/tracker-core`.
- Do not make the user's R3F flow library a v0.1 required dependency.
- Add dependencies only when the current phase needs them.

## 8. Testing Strategy

Frontend:

- typecheck
- unit tests for motion mapping
- dummy MotionFrame tests
- preview smoke tests

Native:

- CMake build checks
- MotionFrame serialization tests
- native dummy sender checks
- camera/tracking tests later
