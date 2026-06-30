# Packaged Electron GUI Native Pipeline Validation — 2026-06-30

## 1. Summary

This report records the manual GUI validation of the packaged Electron app's native
pipeline start/stop flow using the in-process MotionFrame WebSocket bridge introduced
in PR #379.

**Scope:** `apps/desktop/dist/win-unpacked/desktoplvk.exe` → Electron UI native pipeline
start (camera-source=opencv) → packaged `lvk-tracker-core.exe` spawn → in-process
MotionFrame bridge at `ws://127.0.0.1:45731/motion` → Web Preview `?source=native` →
Electron UI pipeline stop.

**Bug found and fixed during validation:** `NativePipelineManager.start()` passed
`cwd: repoRoot` to the tracker spawn. In packaged mode `findRepoRoot()` falls back
to `resolve(__dirname, '../../../..')` — a path that does not exist inside the packaged
app directory. Node.js `child_process.spawn` throws ENOENT when the `cwd` option
refers to a non-existent directory, with the error message incorrectly citing the
executable path. Fix: use `dirname(packagedTrackerPath)` as `cwd` when the packaged
tracker path is used, falling back to `repoRoot` for dev mode.

**Outcome:** All automated observations PASS. Bridge binds exclusively to `127.0.0.1`.
MotionFrame data received from the packaged pipeline. Clean stop confirmed via UI.
OBS Browser Source frame reception and browser-visible avatar animation remain MANUAL.

---

## 2. Environment

- OS: Windows 11 Pro x64 (10.0.26200)
- Electron packaged app: `apps/desktop/dist/win-unpacked/desktoplvk.exe`
- electron-builder mode: `--dir` (win-unpacked)
- Node.js: v24.16.0 / pnpm 11.5.0
- Electron version: 39.8.10
- Web Preview dev server: `pnpm dev:web` at `http://localhost:5173`
- Packaged native runtime: `resources/native-runtime/bin/lvk-tracker-core.exe` (102,912 bytes, signed)
- 21 OpenCV vcpkg DLLs confirmed present in `resources/native-runtime/bin/`

---

## 3. Bug Found During Validation

**File:** `apps/desktop/src/main/nativePipeline.ts`

**Original code (line 427–432):**
```typescript
this.trackerProcess = spawn(trackerExecutablePath, trackerArgs, {
  cwd: repoRoot,           // BUG: non-existent in packaged mode
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  ...(trackerEnv ? { env: trackerEnv } : {})
})
```

**Root cause:** `findRepoRoot()` walks up from `__dirname` looking for `package.json`.
In packaged Electron main, `__dirname` is inside the ASAR/app bundle. No `package.json`
is found, so the function falls back to `resolve(__dirname, '../../../..')` — a path
that does not exist as a filesystem directory. `child_process.spawn` throws `ENOENT`
when `options.cwd` is a non-existent path. The error message reports the executable
path as missing (misleading), not the cwd.

**Symptom:** First pipeline start attempt produced:
```
Native tracker status: Error
Motion bridge status: Exited
Latest status: Native tracker stopped unexpectedly. Stopping the MotionFrame bridge.
Latest error: Missing/inaccessible helper binary (ENOENT): spawn
  <app>/resources/native-runtime/bin/lvk-tracker-core.exe ENOENT
```
The binary itself is present and executable (verified: direct `Start-Process` succeeds,
`--print-runtime-capabilities` outputs correctly).

**Fix applied:**
```typescript
this.trackerProcess = spawn(trackerExecutablePath, trackerArgs, {
  cwd: packagedTrackerPath ? dirname(packagedTrackerPath) : repoRoot,
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  ...(trackerEnv ? { env: trackerEnv } : {})
})
```

In packaged mode the tracker runs from its own `bin/` directory. Tracker args contain
no relative paths, so no relative-path resolution depends on `repoRoot`.

---

## 4. Validation Steps and Results

### 4.1 Packaged binary preflight

Confirmed before rebuild:

| Item | Result |
| --- | --- |
| `desktoplvk.exe` present in `dist/win-unpacked/` | PASS |
| `lvk-tracker-core.exe` in `resources/native-runtime/bin/` (102,912 bytes, signed) | PASS |
| 21 OpenCV vcpkg DLLs in `resources/native-runtime/bin/` | PASS |
| Direct spawn of tracker (`--print-runtime-capabilities`) | PASS — `opencvCameraSupport=true`, `opencvFaceDetectorSupport=true` |

### 4.2 Rebuild with bug fix

After applying the `cwd` fix:

| Check | Result |
| --- | --- |
| `pnpm --filter @lvk/desktop typecheck` | PASS |
| `pnpm --filter @lvk/desktop build:unpack` | PASS |

### 4.3 Packaged Electron app launch

- Launched `dist/win-unpacked/desktoplvk.exe`
- Electron process tree: PID 12900 (main), GPU process, renderer process
- Window HWND: 984242, position (278, 48), size 980×720
- UI confirmed: "LVK DESKTOP PREVIEW" header, preview URLs, native runtime overview

### 4.4 Native pipeline start from Electron UI

- Changed camera source to "OpenCV camera" via keyboard Tab navigation in the Electron UI
- Status confirmed before start: `nativeTrackerStatus: not_started`, `motionBridgeStatus: not_started`
- Activated "Start native pipeline" button via keyboard (Tab + Space)
- UI feedback after start: **"Native runtime started."** notification visible

Observations immediately after start:

| Observation | Result |
| --- | --- |
| `lvk-tracker-core.exe` process spawned | PASS — PID 13220 |
| Tracker parent PID = Electron PID 12900 | PASS — confirmed via WMI `ParentProcessId` |
| Port 45731 listening | PASS — `TCP 127.0.0.1:45731 0.0.0.0:0 LISTENING` |
| Bridge binds to `127.0.0.1` only (not `0.0.0.0`) | PASS — netstat confirms loopback-only |

### 4.5 In-process MotionFrame bridge connectivity

Connected via raw TCP WebSocket handshake to `ws://127.0.0.1:45731/motion`:

| Observation | Result |
| --- | --- |
| TCP connection to `127.0.0.1:45731` | PASS — connected |
| WebSocket HTTP 101 upgrade received | PASS |
| `Sec-WebSocket-Accept` header verified | PASS |
| MotionFrame frames received | PASS — 3 frames received |
| Frame fields | `schemaVersion`, `timestampMs`, `source`, `tracking`, `face`, `eyes`, `mouth` |
| `source` field | `"native"` |
| `tracking.status` | `"tracking"` |
| Frame interval | ~33 ms (~30 fps) |

Sample frame (fields only, no raw values):
```
timestampMs=198900 source=native tracking=tracking
keys=[schemaVersion,timestampMs,source,tracking,face,eyes,mouth]
```

### 4.6 Web Preview server

| Observation | Result |
| --- | --- |
| `http://localhost:5173/?source=native` HTTP status | PASS — 200 OK, `text/html` |
| Web Preview page content loads | PASS |
| Browser-visible avatar animation from packaged bridge | SKIP — interactive browser not available in this session; WebSocket frame delivery verified programmatically via 4.5 |

### 4.7 Native pipeline stop from Electron UI

- Activated "Stop native pipeline" button via keyboard (Tab + Space) from the Electron UI
- UI feedback after stop: **"Native runtime stopped."** notification visible

Post-stop observations:

| Observation | Result |
| --- | --- |
| `lvk-tracker-core.exe` process terminated | PASS — no process found |
| Port 45731 not listening | PASS — no `LISTENING` entry (TIME_WAIT connections normal OS cleanup) |
| `nativeTrackerStatus` in diagnostics | `Exited` |
| `motionBridgeStatus` in diagnostics | `Exited` |
| Latest status in diagnostics | `"Native MotionFrame pipeline stopped."` |
| "Start native pipeline" button re-enabled in UI | PASS — visible as enabled |
| "Stop native pipeline" button disabled in UI | PASS — visible as grayed |

### 4.8 Loopback / local-first confirmation

- Bridge bound exclusively to `127.0.0.1:45731` — confirmed via `netstat` (no `0.0.0.0:45731` entry)
- No camera frames were captured, stored, printed, committed, or transmitted
- No external network connections initiated
- Tracker spawned by Electron main with process-local env (`buildNativeRuntimeEnv` sets PATH to bin dir + System32 only; global `process.env.PATH` not mutated)

---

## 5. Safety Confirmations

- No camera frames captured, stored, committed, or transmitted externally.
- Bridge binds to `127.0.0.1` only. Not `0.0.0.0`.
- No global `PATH` mutated. Packaged tracker env is process-local.
- No screenshots committed. No raw logs committed. No local absolute paths committed.
- No MotionFrame protocol schema changes.
- No new npm/pnpm dependencies added.
- No telemetry, analytics, cloud upload, or new network behavior introduced.

---

## 6. Remaining Follow-Ups

- OBS Browser Source frame reception from the in-process bridge: MANUAL — requires adding OBS Browser Source pointed at `http://localhost:5173/?mode=obs&source=native`, starting the pipeline, and observing the OBS canvas. Prior OBS validation pass (PR #377) confirmed OBS Studio is installed and running.
- Browser-visible avatar animation from packaged native pipeline: MANUAL — requires opening a browser window at `http://localhost:5173/?source=native` while the packaged pipeline is running and observing the avatar moving.
