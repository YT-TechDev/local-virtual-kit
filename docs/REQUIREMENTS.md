# Requirements Definition

## 1. Project Naming

- Product name: Local Virtual Kit
- Short name: LVK
- Repository name: `local-virtual-kit`
- Product description: Local-first avatar tracking and rendering kit for VTuber and virtual character workflows.

## 2. Purpose

LVK provides a local-first foundation where webcam-based face tracking drives a lightweight avatar renderer.

The project prioritizes privacy, low-latency local processing, modular architecture, and extensibility.

## 3. Product Vision

LVK should become a practical starter foundation for developers and creators who want to build custom avatar tools using a hybrid native + web architecture.

It starts as a technically solid starter kit, not a full consumer-grade VTuber production suite.

## 4. Target Users

Primary users:

- Indie VTuber beginners who want a lightweight local avatar workflow
- Developer creators who want to customize tracking/rendering pipelines
- Web/R3F developers interested in realtime character control
- Streamers who want a simple OBS-compatible avatar preview

## 5. Core Requirements

### Local Processing

- Camera frames must be processed locally.
- Camera frames must not be sent to external servers in v0.1.

### Face Tracking

The tracker should emit at least:

- face detection state
- confidence
- face position
- head yaw/pitch/roll
- eye open/blink values
- mouth open/smile values
- simple expression values

### MotionFrame Contract

The native tracking layer must emit normalized MotionFrame data.

MotionFrame is the contract between tracking and rendering.

### Avatar Preview

The initial preview should use React, Three.js, and React Three Fiber.

v0.1 should use plain handwritten R3F without depending on the user's separate R3F flow library.

### Electron Desktop App

Electron should provide:

- launcher
- tracking start/stop control
- settings UI
- calibration UI
- preview URL management
- native process status

## 6. MVP Scope

v0.1 includes:

- documentation
- pnpm workspace
- `packages/motion-protocol`
- dummy MotionFrame generator
- basic R3F preview
- native tracker skeleton
- WebSocket JSON transport
- Electron shell
- settings/calibration placeholders
- OBS-compatible preview route

## 7. v0.1 Non-goals

v0.1 does not include:

- full Live2D support
- full VRM support
- hand tracking
- full body tracking
- cloud sync
- accounts
- payments
- marketplace
- native OBS plugin
- required dependency on the user's R3F flow library

## 8. Success Criteria

The MVP is successful when:

1. The app can run locally.
2. The renderer can animate an avatar from dummy MotionFrame data.
3. The native process can emit MotionFrame-shaped data.
4. The preview can receive MotionFrame data through WebSocket.
5. The avatar reacts to head, eye, and mouth values.
6. Electron can control the native process at a basic level.
7. The OBS preview route can be opened in a browser/OBS.
8. Architecture boundaries remain clear.

## 9. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Tracking complexity grows too early | Start with dummy MotionFrame and renderer first |
| Native/Desktop build complexity | Use separate native process + WebSocket for v0.1 |
| Renderer/tracker debugging becomes mixed | Maintain dummy mode and clear protocol boundaries |
| R3F flow library is not yet stable | Keep it out of v0.1 core and add later as optional example |
