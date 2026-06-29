# Electron In-Process MotionFrame Bridge — Implementation Report

Date: 2026-06-29
Branch: `feat/electron-in-process-motion-bridge`

---

## Problem

In packaged Electron builds, `tools/motion-ws-bridge.mjs` is absent from the bundle because it resides under `tools/` and is not included via `extraResources`. `NativePipelineManager.start()` previously spawned this file as a child process, so every packaged launch immediately failed with a bridge-not-found error. Dev mode worked; packaged mode did not.

---

## Solution

Implement the MotionFrame WebSocket bridge inside Electron main as an in-process Node.js TCP server. Both dev and packaged modes now use the same code path with no external script dependency.

Key decisions:
- Uses only `node:net` and `node:crypto` (Node.js built-ins available in Electron main). No new packages.
- Conservative JSON validation: parses line, checks non-null object with finite `timestampMs`. Does not import `@lvk/motion-protocol` (not a desktop dependency).
- Binds exclusively to `127.0.0.1:45731/motion`, not `0.0.0.0`.
- Caches the latest valid frame text; sends it to new clients on connect; broadcasts subsequent frames to all active clients.
- `tools/motion-ws-bridge.mjs` is retained as a standalone dev utility but is no longer spawned by Electron.

---

## Changed Files

| File | Change |
|------|--------|
| `apps/desktop/src/main/motionBridgeServer.ts` | **New.** In-process WebSocket bridge server. Exports `startMotionBridgeServer`, `stopMotionBridgeServer`, `publishMotionFrameLine`. |
| `apps/desktop/src/main/nativePipeline.ts` | Replaced external bridge subprocess with in-process bridge calls. Added readline interface to pipe tracker stdout to `publishMotionFrameLine`. Removed `bridgeProcess` field and `describeBridgeProcessError`. |
| `apps/desktop/src/preload/api.ts` | `MotionBridgeStatus`: replaced `'manual_dev_tool'` with `'not_started'`. |
| `apps/desktop/src/renderer/src/App.tsx` | Updated label map to match new `'not_started'` status value. |
| `tools/check-electron-native-pipeline-lifecycle-transitions.mjs` | Rewrote sections B–F for in-process bridge architecture. |
| `tools/check-electron-helper-lifecycle-exit-diagnostic.mjs` | Removed bridge-process exit checks; added in-process bridge error-callback and `stopMotionBridgeServer` checks. |
| `tools/check-electron-helper-spawn-diagnostic.mjs` | Removed `describeBridgeProcessError` section; added in-process bridge error wording checks. |
| `tools/check-electron-native-runtime-status-contract.mjs` | Updated initial `motionBridgeStatus` check from `'manual_dev_tool'` to `'not_started'`. |

---

## Bridge Architecture

```
Native Core stdout
  └─ readline (createInterface)
       └─ publishMotionFrameLine(line)
            ├─ validate JSON (non-null object, finite timestampMs)
            ├─ skip if timestamp not newer than cached
            ├─ cache latestFrameText
            └─ broadcast to all connected WebSocket clients

WebSocket clients (Web Preview / OBS Browser Source)
  └─ ws://127.0.0.1:45731/motion
       └─ on new client connect: send latestFrameText if available
```

### Lifecycle

- `start()`: calls `startMotionBridgeServer(onError)` before spawning the tracker. On error, sets `motionBridgeStatus: 'error'`, terminates tracker, calls `stopMotionBridgeServer()`.
- `stop()`: closes readline, awaits `terminateProcess(trackerProcess)`, calls `stopMotionBridgeServer()`.
- `cleanupOnQuit()`: closes readline, kills tracker synchronously, calls `stopMotionBridgeServer()`.
- `terminateBridgeAfterTrackerExit()`: closes readline, sets `motionBridgeStatus: 'stopping'`, calls `stopMotionBridgeServer()`, sets `motionBridgeStatus: 'exited'`.

---

## Checks Run

| Check | Result |
|-------|--------|
| `pnpm format:check` | PASS |
| `pnpm --filter @lvk/desktop typecheck` | PASS |
| `pnpm --filter @lvk/desktop build` | PASS (main: 30.80 kB) |
| `pnpm --filter @lvk/desktop build:unpack` | PASS |
| `node tools/check-electron-helper-spawn-diagnostic.mjs` | PASS |
| `node tools/check-electron-helper-lifecycle-exit-diagnostic.mjs` | PASS |
| `node tools/check-electron-native-pipeline-lifecycle-transitions.mjs` | PASS |
| `node tools/check-electron-native-runtime-status-contract.mjs` | PASS |
| `pnpm test:motion-ws-bridge` | PASS |
| `check-native-runtime-capabilities.mjs` | SKIP — pre-existing `STATUS_DLL_NOT_FOUND` (OpenCV vcpkg DLLs not on PATH in this environment; unrelated to bridge changes) |

---

## Not Validated (Requires Graphical Session)

- Manual Electron GUI launch and native pipeline start/stop
- Visual confirmation that the Web Preview connects to the in-process bridge
- OBS Browser Source frame reception from the in-process bridge

These require an interactive desktop session with the native runtime staged and OpenCV DLLs on PATH.

---

## Safety Confirmations

- No MotionFrame protocol schema changes.
- No new external network behavior. Bridge binds to `127.0.0.1` only.
- No telemetry, analytics, or cloud upload added.
- No DLLs, build outputs, native binaries, or `win-unpacked/` committed.
- No local absolute paths committed.
- No raw camera frames captured, stored, or transmitted.
- No new npm/pnpm dependencies added.

---

## Remaining Follow-Ups

- Manual Electron GUI validation with native runtime staged and vcpkg DLLs on PATH.
- Confirm Web Preview and OBS Browser Source receive MotionFrames from the in-process bridge in a real packaged session.
