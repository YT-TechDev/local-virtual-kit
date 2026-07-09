# Local Virtual Kit (LVK)

Local Virtual Kit is a local-first avatar tracking and rendering kit for VTuber and virtual character workflows.

LVK is currently in early development. The current public baseline is **v0.4.0: local runtime confidence and native pipeline readiness** after the v0.3.0 local tracking quality release-readiness pass. The v0.2.0 baseline can produce MotionFrame face-position output from local OpenCV face bounds, and the Web Preview can consume that localhost MotionFrame stream.

v0.4.0 captures native dummy pipeline WebSocket smoke coverage, Electron native runtime readiness status, Electron no-frame startup warning behavior, Web Preview native-source status guidance, and renderer-side calibration preset polish. It does not change MotionFrame, Motion Protocol, runtime behavior, backend selection, dependencies, model artifacts, runtime downloads, telemetry, cloud upload, remote inference, external frame processing, or hidden network behavior.

## Core principles

- Keep camera frames local.
- Do not send camera frames to external servers.
- Do not add telemetry, analytics, cloud upload, remote inference, external frame processing, hidden network behavior, or runtime downloads without explicit future approval.
- Keep tracking, protocol, desktop, and renderer responsibilities separate.
- Use `MotionFrame` as the stable contract between the native core and renderer.
- Keep the baseline renderer in plain React Three Fiber.

## Current architecture

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

## Workspace layout

```txt
apps/
  desktop/        Electron desktop shell
  web-preview/    React / Three.js / R3F preview
native/
  tracker-core/   C++ / CMake native tracker skeleton
packages/
  motion-protocol/ MotionFrame types and dummy frame helpers
```

## Packages

- `@lvk/desktop` owns the desktop shell, settings, calibration UI, and native process lifecycle.
- `@lvk/web-preview` owns MotionFrame consumption, mapping, and avatar rendering.
- `@lvk/motion-protocol` owns shared MotionFrame types, constants, and dummy MotionFrame generation.

`@lvk/motion-protocol` must remain framework-independent. It should not depend on React, Three.js, React Three Fiber, Electron, OpenCV, or native platform APIs.

## Development

Install dependencies:

```bash
pnpm install
```

Run the web preview:

```bash
pnpm dev:web
```

Open one of the local preview URLs:

- `http://localhost:5173/?source=dummy` uses frontend dummy `MotionFrame` data.
- `http://localhost:5173/?source=native` connects to the local `MotionFrame` endpoint at `ws://127.0.0.1:45731/motion`.
- `http://localhost:5173/?mode=obs&source=native` uses the native source with the OBS-friendly preview layout.

Run the desktop app:

```bash
pnpm dev:desktop
```

The Electron desktop app shows these preview URLs and can start or stop the development native pipeline after the native tracker has been built.

Build the native tracker:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
```

For native preview development, build the tracker, start `pnpm dev:web`, then use `pnpm dev:desktop` to start or stop the development native pipeline. Raw camera frames stay local, and `MotionFrame` transport is localhost-only.

Build all packages:

```bash
pnpm build
```

Run type checks:

```bash
pnpm typecheck
```

Run tests where package test scripts exist:

```bash
pnpm test
```

Run lint where package lint scripts exist:

```bash
pnpm lint
```

## MotionFrame

`MotionFrame` is the shared data contract between the native tracking core and the renderer. The current schema lives in `packages/motion-protocol` and is documented in `docs/MOTION_PROTOCOL.md`.

Renderer-specific values such as avatar bones, morph target weights, smoothing, or blink derivation should stay in the renderer or mapping layer unless the protocol is intentionally changed.

## Privacy model

LVK is local-first. Raw camera frames must remain local. Telemetry, analytics, cloud upload, remote inference, remote camera processing, external frame processing, runtime downloads, and hidden network behavior are out of scope unless explicitly approved for a future version.

## Documentation

For the post-v0.2 entrypoint, use these current source-of-truth documents first:

- `docs/releases/v0.4.0.md` - current local runtime confidence and native pipeline readiness notes.
- `docs/releases/v0.3.0.md` - local tracking quality and release-readiness notes.
- `docs/releases/v0.2.0.md` - Local OpenCV Face-Following MVP baseline and known limitations.
- `docs/ROADMAP.md` - implementation sequence and v0.4+ direction.
- `docs/LOCAL_RUNTIME_CHECKLIST.md` - local/manual validation boundaries and runtime checklist.

Start contributor or agent work with `docs/AGENTS.md`, then read only the focused document relevant to the task.

Architecture, MotionFrame, and development policy references remain focused here:

- `docs/ARCHITECTURE.md` - Native Core, Motion Protocol, Web Preview, and Electron boundaries.
- `docs/TECH_STACK.md` - workspace packages, dependencies, and commands.
- `docs/MOTION_PROTOCOL.md` - stable `MotionFrame` schema and compatibility rules.
- `docs/MOTION_MAPPING.md` - renderer-side mapping from `MotionFrame` values.
- `docs/DEVELOPMENT_POLICY.md` - workflow, checks, PR, and validation-claim rules.

## Git policy

Do not push directly to `main`. Use a dedicated branch and open a small, reviewable pull request for changes.
