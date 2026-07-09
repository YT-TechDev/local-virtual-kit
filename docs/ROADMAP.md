# Roadmap

This document describes the intended implementation sequence. It is not a fixed instruction to repeat completed work.

Before choosing the next task, inspect the current repository state and open PRs.

For current release-prep work, v0.4.0 is the local runtime confidence and native pipeline readiness closeout after the v0.3.0 local tracking quality release-readiness pass. Keep changes small, preserve local camera / OBS / packaged Electron validation boundaries, and do not change the `MotionFrame` schema unless explicitly planned. v0.5+ work should continue toward evidence-based local backend evaluation, calibration polish, and avatar integration planning while keeping Web Preview and Electron runtime boundaries clear.

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

## Phase 6.5 - Tracking Backend Evaluation / v0.2.0 Local OpenCV MVP

Goal:

- evaluate a product-quality local tracking backend before the full Face Tracking MVP
- treat OpenCV Haar detection as a baseline/smoke path only
- compare dedicated local landmark/model options behind Native Core abstractions
- keep dummy mode and current MotionFrame output working during evaluation

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

## v0.2.0 Release-Prep Target

v0.2.0 is the Local OpenCV Face-Following MVP release-prep target. It covers local OpenCV Haar-style face detection, Native Core diagnostics and stabilization, native `MotionFrame.face.position.x/y/z` output from face bounds, Electron development native runtime root-resolution fixes, Web Preview native MotionFrame consumption, status/fallback improvements, and renderer-side smoothing.

Known v0.2.0 limits remain explicit: no real eye, mouth, expression, or landmark tracking; no GLB/VRM/custom avatar loader; no bone or morph target mapping; no MotionFrame schema change; and no packaged Electron validation claim unless owner-performed smoke explicitly records it.

v0.3.0 followed up with post-v0.2 documentation navigation consolidation, local face-following calibration/sensitivity baseline work, packaged Electron runtime validation follow-up preparation, H2 helper-runtime supervisor planning and fail-closed guard coverage, helper launch-failure / ready-timeout guard coverage, and no-dependency synthetic helper adapter smoke coverage behind the Native Core boundary.

v0.4.0 followed up with local runtime confidence work: native dummy pipeline WebSocket smoke coverage, Electron native runtime readiness status, Electron no-frame startup warning behavior, Web Preview native-source guidance, and renderer-side calibration preset polish. v0.4.0 does not select a production backend/model/runtime, add runtime downloads, change MotionFrame or Motion Protocol, or claim new webcam / OBS / packaged Electron / local hardware readiness validation.

Future v0.5+ direction should focus on evidence-based local backend evaluation, calibration polish, and avatar integration planning without weakening LVK's local-first privacy boundary.

## Release Entry Points

- v0.4.0 release-readiness notes: `docs/releases/v0.4.0.md`.
- v0.3.0 release-readiness notes: `docs/releases/v0.3.0.md`.
- v0.2.0 baseline notes: `docs/releases/v0.2.0.md`.

## v0.2.0 Entry Points

Use these focused documents instead of expanding `docs/AGENTS.md` with issue details:

- OBS Browser Source validation: `docs/OBS_BROWSER_SOURCE_GUIDE.md` and `docs/LOCAL_RUNTIME_CHECKLIST.md`.
- OpenCV/local camera validation: `docs/LOCAL_RUNTIME_CHECKLIST.md`.
- Local diagnostics evidence and tracking backend evaluation: `docs/TRACKING_BACKEND_EVALUATION.md`.
- Web Preview native status fixes: `docs/LOCAL_RUNTIME_CHECKLIST.md`, then current Web Preview source.

OBS, webcam/OpenCV, Electron GUI, OS camera permission, and native hardware validation are local/manual checks. Do not claim them from Codex Cloud or headless CI alone.

---

## Next Task Selection Rule

When asked for the next task:

1. read `docs/AGENTS.md`
2. inspect the current source tree and open PRs
3. identify the earliest incomplete phase
4. propose one small PR-sized task
5. avoid repeating completed setup work
