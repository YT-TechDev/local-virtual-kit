# Roadmap

This document describes the intended implementation sequence. It is not a fixed instruction to repeat completed work.

Before choosing the next task, inspect the current repository state and open PRs.

---

## Phase 0 - Documentation and Foundation

Goal:

- define product scope
- define architecture boundaries
- define MotionFrame protocol
- define development policy

Expected output:

- focused `docs/*.md` files
- no duplicated implementation instructions
- clear source-of-truth rules

---

## Phase 1 - Workspace and Protocol

Goal:

- set up pnpm workspace
- create `packages/motion-protocol`
- add MotionFrame types
- add dummy MotionFrame generator
- add basic protocol tests where useful

Notes:

- If this already exists, do not recreate it.
- If another package imports `@lvk/motion-protocol`, make sure clean dev/build flows can resolve it.

---

## Phase 2 - Basic R3F Preview

Goal:

- create plain R3F preview
- drive a primitive avatar with dummy MotionFrame
- keep mapping typed and readable
- add or prepare an OBS-friendly preview route

Quality bar:

- avoid one-line compressed core components
- avoid `any` in shared mapping paths
- keep dummy mode independent from native tracking
- run available web-preview checks before merge

---

## Phase 3 - Native Tracker Skeleton

Goal:

- create C++ / CMake native skeleton
- produce MotionFrame-shaped dummy output
- prepare local transport integration

Do not start heavy camera/tracking dependencies before the skeleton and protocol output are clear.

---

## Phase 4 - Local Transport

Goal:

- send MotionFrame over localhost WebSocket JSON
- reconnect safely
- tolerate missing/delayed/out-of-order frames in the renderer

Draft endpoint:

```txt
ws://127.0.0.1:45731/motion
```

---

## Phase 5 - Electron Shell

Goal:

- start/stop native tracker process
- display preview URL and tracker status
- provide settings/calibration placeholders
- keep process management out of the renderer

---

## Phase 6 - Camera Input

Goal:

- add camera capture abstraction
- log camera state and FPS
- keep raw frames local

---

## Phase 7 - Face Tracking MVP

Goal:

- add face detection or landmark extraction
- estimate head rotation
- estimate eye openness/gaze
- estimate mouth open/smile
- emit current MotionFrame schema

---

## Phase 8 - Smoothing and Calibration

Goal:

- add smoothing
- add deadzone
- add neutral pose calibration
- expose basic calibration UI through Electron

---

## Phase 9 - OBS Workflow Polish

Goal:

- improve preview route
- improve setup docs
- prepare public demo workflow

---

## Phase 10 - Optional Flow Avatar Example

Prerequisite:

- the user's R3F flow library is public and stable

Goal:

- add optional `examples/flow-avatar`
- keep it separate from the core renderer
- keep the plain R3F preview as the stable baseline

---

## Next Task Selection Rule

When asked for the next task:

1. read `docs/AGENTS.md`
2. inspect the current source tree and open PRs
3. identify the earliest incomplete phase
4. propose one small PR-sized task
5. avoid repeating completed setup work
