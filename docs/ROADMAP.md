# Roadmap

## Phase 0 - Documentation and Foundation

- Add `docs/` documentation.
- Define LVK architecture.
- Define MotionFrame protocol.
- Define development policy.

## Phase 1 - Workspace and Protocol

- Set up pnpm workspace.
- Create `packages/motion-protocol`.
- Add MotionFrame types and dummy generator.

## Phase 2 - Basic R3F Preview

- Create plain R3F preview.
- Drive avatar with dummy MotionFrame.
- Add OBS-compatible preview route draft.

## Phase 3 - Native Tracker Skeleton

- Create C++ / CMake native skeleton.
- Emit dummy MotionFrame over WebSocket.

## Phase 4 - Electron Shell

- Add Electron app shell.
- Start/stop native tracker process.
- Show preview URL and status.

## Phase 5 - Camera Input

- Add camera capture abstraction.
- Log camera state and FPS.

## Phase 6 - Face Tracking MVP

- Add face detection / landmarks.
- Estimate head, eyes, mouth, and simple expression values.

## Phase 7 - Smoothing and Calibration

- Add smoothing.
- Add deadzone.
- Add neutral pose calibration.

## Phase 8 - OBS Workflow Polish

- Improve preview route.
- Improve setup docs.
- Prepare public demo workflow.

## Phase 9 - Flow Avatar Example

Prerequisite: the user's R3F flow library is public and stable.

- Add `examples/flow-avatar`.
- Keep it optional.
- Keep `basic-r3f-avatar` as the stable baseline.
