# Requirements

This document defines product scope. It should not repeat agent workflow, Git rules, or implementation prompts.

---

## 1. Product Identity

- Product name: **Local Virtual Kit**
- Short name: **LVK**
- Repository: `local-virtual-kit`
- Purpose: local-first avatar tracking and rendering for VTuber and virtual character workflows.

---

## 2. Product Goal

LVK should provide a stable starter foundation where a local native tracker emits normalized motion data and a web-based renderer animates an avatar from that data.

The first release is a developer-friendly foundation, not a complete consumer VTuber suite.

---

## 3. Core Requirements

### Local-first privacy

- Camera frames are processed locally.
- Camera frames are not sent to external servers in v0.1.
- Any network transport in v0.1 must be local by default.

### Native tracking foundation

The Native Core should eventually estimate:

- tracking status and confidence
- normalized face position
- normalized head rotation as `face.rotation.pitch/yaw/roll`
- eye openness as `eyes.leftOpen/rightOpen`
- gaze as `eyes.gaze.x/y`
- mouth values as `mouth.open/smile`

The renderer should not depend on native tracking internals.

### MotionFrame contract

- `MotionFrame` is the shared data contract between Native Core and Renderer.
- The current schema is defined in `docs/MOTION_PROTOCOL.md` and `packages/motion-protocol`.
- Do not invent fields such as `face.detected`, `head.*`, or `eyes.blink` unless the protocol is intentionally changed in the same PR.

### Avatar preview

- Use React, Three.js, and React Three Fiber.
- v0.1 uses plain handwritten R3F.
- The user's separate R3F flow library is optional future work only.

### Electron app

Electron should provide:

- launcher/app shell
- tracking start/stop controls
- settings UI
- calibration UI
- preview URL management
- native process status

---

## 4. v0.1 Scope

v0.1 should include, in small reviewable steps:

- pnpm workspace
- `packages/motion-protocol`
- dummy MotionFrame generator
- basic R3F preview driven by dummy MotionFrame
- native tracker skeleton
- local WebSocket JSON transport draft
- Electron shell integration
- settings/calibration placeholders
- OBS-compatible preview route draft

---

## 5. v0.1 Non-goals

Do not add these to core v0.1 unless the project owner explicitly changes scope:

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

---

## 6. Success Criteria

The MVP is successful when:

1. The app runs locally.
2. The renderer can animate an avatar from dummy MotionFrame data.
3. The native process can emit MotionFrame-shaped data.
4. The preview can receive MotionFrame data through local transport.
5. The avatar reacts to head, eye, and mouth values.
6. Electron can control the native process at a basic level.
7. An OBS-friendly preview can be opened in a browser or OBS Browser Source.
8. Architecture boundaries remain clear.

---

## 7. Scope Control

When adding a feature, prefer the smallest step that strengthens the foundation.

If a task touches multiple layers, split it unless the change is required to keep the contract working end-to-end.
