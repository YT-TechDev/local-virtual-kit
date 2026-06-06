# Technical Stack

This document defines technology choices, package boundaries, and dependency policy. It should not repeat product requirements or agent workflow.

---

## 1. Stack Summary

| Area | Stack |
| --- | --- |
| Workspace | pnpm monorepo |
| Native Core | C++ / CMake |
| Desktop App | Electron / React / TypeScript |
| Web Preview | React / TypeScript / Vite / Three.js / React Three Fiber |
| Protocol | MotionFrame over local WebSocket JSON |
| Initial renderer data | Dummy MotionFrame from `@lvk/motion-protocol` |

---

## 2. Current Workspace Shape

```txt
apps/
  desktop/
  web-preview/
packages/
  motion-protocol/
```

Planned future areas:

```txt
native/tracker-core/
packages/avatar-renderer/
examples/basic-r3f-avatar/
examples/flow-avatar/
```

Do not create future packages until the current task needs them.

---

## 3. Native Core

- Language: C++17 or C++20
- Build system: CMake
- Candidate libraries: OpenCV, MediaPipe Face Landmarker, ONNX Runtime if needed later

v0.1 should start with a native skeleton and dummy MotionFrame sender before adding heavy tracking dependencies.

---

## 4. Web Preview

Use:

- React
- TypeScript
- Vite
- Three.js
- React Three Fiber

v0.1 renderer rules:

- use plain handwritten R3F
- keep dummy preview mode working
- keep MotionFrame mapping readable and typed
- do not add the user's separate R3F flow library as a required dependency

---

## 5. Electron App

Use Electron for:

- desktop shell
- settings UI
- calibration UI
- native process lifecycle
- preview URL/status display

Do not implement tracking logic inside Electron.

---

## 6. Motion Protocol Package

Package:

```txt
packages/motion-protocol
```

Package name:

```txt
@lvk/motion-protocol
```

Rules:

- framework-independent
- no React dependency
- no Three.js/R3F dependency
- no Electron dependency
- no OpenCV/MediaPipe runtime dependency
- safe for both renderer and native bridge code to reference

When importing this package from another workspace package, make sure the package resolves in clean dev/build flows. Do not rely on manually generated untracked `dist` files unless the workflow builds them first.

---

## 7. Dependency Policy

Before adding a dependency, ask:

1. Is it required for the current task?
2. Does it belong in the target package?
3. Does it violate an architecture boundary?
4. Can the task be completed with a smaller local implementation first?

Prefer small dependency changes. Avoid broad dependency upgrades inside feature PRs.

---

## 8. Verification Commands

Run only commands that exist for the current package/workspace.

Common commands:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Targeted examples:

```bash
pnpm --filter @lvk/motion-protocol build
pnpm --filter @lvk/motion-protocol typecheck
pnpm --filter @lvk/web-preview build
pnpm --filter @lvk/web-preview typecheck
```

If a command is unavailable or not run, report that honestly.
