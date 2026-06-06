# Local Virtual Kit (LVK)

Local Virtual Kit is a local-first avatar tracking and rendering kit for VTuber and virtual character workflows.

LVK is currently in early development. The first milestone is a small, clear foundation where a local native tracking core emits normalized motion data and a web-based React Three Fiber preview renders an avatar from that data.

## Core principles

- Keep camera frames local.
- Do not send camera frames to external servers in v0.1.
- Keep tracking, protocol, desktop, and renderer responsibilities separate.
- Use `MotionFrame` as the contract between the native core and renderer.
- Keep the baseline renderer in plain React Three Fiber for v0.1.

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

Run the desktop app:

```bash
pnpm dev:desktop
```

Run the web preview:

```bash
pnpm dev:web
```

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

LVK is local-first. Raw camera frames must remain local in v0.1. Cloud upload, telemetry, analytics, and remote camera processing are out of scope unless explicitly approved for a future version.

## Documentation

Start with `docs/AGENTS.md` for contributor and agent guidance, then read only the focused document relevant to the task.

Useful focused docs:

- `docs/ARCHITECTURE.md`
- `docs/TECH_STACK.md`
- `docs/MOTION_PROTOCOL.md`
- `docs/MOTION_MAPPING.md`
- `docs/ROADMAP.md`
- `docs/DEVELOPMENT_POLICY.md`

## Git policy

Do not push directly to `main`. Use a dedicated branch and open a small, reviewable pull request for changes.
