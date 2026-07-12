# Roadmap

This document describes the intended implementation sequence. It is not a fixed instruction to repeat completed work.

Before choosing the next task, inspect the current repository state and open PRs.

For current release-prep work, v0.9.0 is the completed OBS Browser Source Workflow Polish release. Keep changes small, preserve local-first camera/privacy boundaries, and do not change the `MotionFrame` schema unless explicitly planned. v0.9.0 keeps OBS routes localhost-based, camera frames local, renderer calibration browser-local, and Native Core / MotionFrame ownership boundaries unchanged.

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

Implementation outcome for v0.9.0:

- typed Electron runtime-status exposure for the OBS dummy URL
- dedicated Desktop OBS Browser Source setup panels with Copy/Open actions for dummy and native routes
- recommended `1920 × 1080` starting dimensions and localhost/privacy guidance
- focused Web Preview OBS route-contract checker coverage
- persisted renderer calibration remains compatible with OBS rendering
- no MotionFrame, Motion Protocol, Native Core, dependency, telemetry, cloud, remote inference, runtime download, or network-behavior expansion

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

v0.5.0 followed up with Native Core backend evaluation foundation work: a `TrackingBackend` / `FaceTrackingPipelineBackend` seam, dummy/noop boundary preservation, optional OpenCV Haar-style baseline boundary preservation, backend parity `MotionFrame` checker coverage, and backend evaluation evidence notes. v0.5.0 does not select a production backend/model/runtime, add runtime downloads, change MotionFrame or Motion Protocol, or claim new webcam / OBS / packaged Electron / local hardware readiness validation.

v0.6.0 followed up with Local backend candidate validation spike work: OpenCV cascade-backed baseline evidence, a first local backend candidate route decision choosing MediaPipe Face Landmarker as a feasibility spike route, a no-dependency fail-closed MediaPipe candidate scaffold behind the Native Core boundary, and MotionFrame compatibility evidence for default vs explicit face-pipeline behavior. v0.6.0 does not select a production backend/model/runtime, add MediaPipe or ONNX dependencies, add runtime downloads, change MotionFrame or Motion Protocol, or claim new webcam / OBS / Electron GUI / packaged Electron / hardware readiness validation.

v0.7.0 followed up with MediaPipe local feasibility foundation work: a source-grounded dependency and task/model asset route decision, a disabled-by-default CMake feasibility option that fails fast at configure time when enabled, and automated checker evidence for that boundary. v0.7.0 does not integrate or enable MediaPipe, add dependencies or task/model assets, add runtime downloads or inference, change MotionFrame or Motion Protocol, or claim new webcam / OBS / Electron GUI / packaged Electron / hardware readiness validation.

v0.8.0 followed up with the first user-facing Web Preview renderer calibration workflow: persistent Balanced / Steady / Responsive preset selection, versioned fail-safe browser-local renderer calibration state, native neutral-pose capture/reset, calibration panel UX/accessibility improvements, and OBS control exclusion. v0.8.0 does not expand MotionFrame, Motion Protocol, Native Core, localhost transport, camera access, tracking backend selection, network behavior, telemetry, cloud upload, remote inference, or privacy scope.

v0.9.0 followed up with OBS Browser Source workflow polish: Electron OBS dummy URL exposure, Desktop OBS setup Copy/Open actions for dummy and native routes, focused Web Preview OBS route-contract checker coverage, and renderer calibration compatibility with OBS rendering. v0.9.0 keeps architecture and privacy boundaries unchanged: no MotionFrame or Motion Protocol changes, no Native Core behavior changes, no dependencies, no telemetry, no cloud upload, no remote inference, no runtime downloads, and no new network behavior.

Future post-v0.9.0 direction should not begin another docs-only Gate cycle by default. Inspect the current repository state and open issues before selecting work, and prefer one visible implementation milestone. Possible categories include avatar preview/renderer integration, visible local tracking UX or tracking-quality improvement, or calibration validation with owner-side runtime evidence; this roadmap does not approve any one category as the next milestone. Any real MediaPipe integration must remain separately approved and scoped.

## Release Entry Points

- v0.9.0 release-readiness notes: `docs/releases/v0.9.0.md`.
- v0.8.0 release-readiness notes: `docs/releases/v0.8.0.md`.
- v0.7.0 release-readiness notes: `docs/releases/v0.7.0.md`.
- v0.6.0 release-readiness notes: `docs/releases/v0.6.0.md`.
- v0.5.0 release-readiness notes: `docs/releases/v0.5.0.md`.
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
