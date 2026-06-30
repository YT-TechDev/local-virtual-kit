# Packaged Electron Native Visual Output Validation — 2026-06-30

## 1. Summary

This report records the manual visual output validation of the packaged Electron
app's native pipeline path — the remaining gap after the 2026-06-30 packaged
Electron GUI native pipeline validation pass (PR #380) confirmed process spawn,
in-process bridge binding, and WebSocket frame delivery.

**Scope:** Packaged `desktoplvk.exe` → Electron UI pipeline start
(camera-source=opencv) → in-process MotionFrame bridge at
`ws://127.0.0.1:45731/motion` → browser Web Preview `?source=native` visual
output → OBS Browser Source `?mode=obs&source=native` visual output → Electron
UI pipeline stop.

**Outcome:** All programmatic observations PASS. Browser-visible avatar
animation from the packaged native pipeline confirmed MANUAL (human observation).
OBS Browser Source loading Web Preview and showing live visual updates confirmed
MANUAL (human observation). Clean stop confirmed.

---

## 2. Environment

- OS: Windows 11 Pro x64 (10.0.26200)
- Packaged Electron app: `<unpacked-app>/desktoplvk.exe`
- electron-builder mode: `--dir` (win-unpacked)
- Node.js: v24.16.0 / pnpm 11.5.0
- Web Preview dev server: `pnpm dev:web` at `http://localhost:5173`
- Packaged native runtime: `<unpacked-app>/resources/native-runtime/bin/lvk-tracker-core.exe`
  (102,912 bytes, from prior build pass)
- 21 OpenCV vcpkg DLLs confirmed present in `resources/native-runtime/bin/`
- OBS Studio: 32.1.2 (confirmed installed in prior pass, PR #377)
- Prior validation chain: PR #377 (OBS), PR #379 (in-process bridge), PR #380
  (packaged GUI pipeline start/stop)

Local absolute paths are intentionally represented with placeholders.

---

## 3. Baseline Checks

| Check              | Command                                | Result                                                   |
| ------------------ | -------------------------------------- | -------------------------------------------------------- |
| Branch             | `git branch --show-current`            | `test/packaged-electron-native-visual-output-validation` |
| Working tree       | `git status`                           | PASS — clean                                             |
| Formatting         | `pnpm format:check`                    | PASS                                                     |
| Desktop type check | `pnpm --filter @lvk/desktop typecheck` | PASS                                                     |

No rebuild was required. The existing `dist/win-unpacked/` output was built
earlier on the same date (06/30/2026) and includes the packaged-mode `cwd` fix
from PR #380. Source confirmed clean via `git status`.

---

## 4. Packaged Resources Confirmed

`<unpacked-app>/resources/native-runtime/bin/` contents:

```txt
22 files total: lvk-tracker-core.exe (102,912 bytes) + 21 OpenCV vcpkg DLLs
abseil_dll.dll, jpeg62.dll, liblzma.dll, libpng16.dll, libprotobuf.dll,
libsharpyuv.dll, libwebp.dll, libwebpdecoder.dll, libwebpdemux.dll,
libwebpmux.dll, opencv_calib3d4.dll, opencv_core4.dll, opencv_dnn4.dll,
opencv_features2d4.dll, opencv_flann4.dll, opencv_imgcodecs4.dll,
opencv_imgproc4.dll, opencv_objdetect4.dll, opencv_videoio4.dll, tiff.dll, z.dll
```

---

## 5. Validation Steps and Results

### 5.1 Web Preview start

Command:

```bash
pnpm dev:web
```

| Check                                                       | Result                 |
| ----------------------------------------------------------- | ---------------------- |
| Web Preview dev server started                              | PASS — Vite dev server |
| HTTP 200 at `http://localhost:5173/`                        | PASS                   |
| HTTP 200 at `http://localhost:5173/?source=native`          | PASS                   |
| HTTP 200 at `http://localhost:5173/?mode=obs&source=native` | PASS                   |

### 5.2 Packaged Electron app launch

- Launched `<unpacked-app>/desktoplvk.exe`
- Main process PID 9980; child processes confirmed (GPU, renderer)
- Window HWND 198514 confirmed via process enumeration

| Check                    | Result           |
| ------------------------ | ---------------- |
| Packaged app launched    | PASS — PID 9980  |
| Electron process running | PASS — confirmed |

### 5.3 Native pipeline start from Electron UI

- Camera source: **OpenCV camera** selected in Electron UI
- Activated **Start native pipeline** button
- UI feedback: **"Native runtime started."** visible

Observations immediately after start:

| Observation                                      | Result                                           |
| ------------------------------------------------ | ------------------------------------------------ |
| `lvk-tracker-core.exe` spawned                   | PASS — PID 11732, Parent PID 9980                |
| Port 45731 listening                             | PASS — `TCP 127.0.0.1:45731 0.0.0.0:0 LISTENING` |
| Bridge binds to `127.0.0.1` only (not `0.0.0.0`) | PASS — netstat shows loopback-only               |

### 5.4 In-process MotionFrame bridge connectivity

WebSocket handshake and frame reception via Node.js client:

| Observation                         | Result                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| TCP connection to `127.0.0.1:45731` | PASS — connected                                                              |
| WebSocket HTTP 101 upgrade received | PASS                                                                          |
| MotionFrame frames received         | PASS — 3 frames received                                                      |
| Frame fields                        | `schemaVersion`, `timestampMs`, `source`, `tracking`, `face`, `eyes`, `mouth` |
| `source` field                      | `"native"`                                                                    |
| `tracking.status`                   | `"tracking"`                                                                  |
| Frame interval                      | ~33 ms (~30 fps)                                                              |

Sample frame (fields only, no raw values):

```
Frame 1: timestampMs=67833 source=native tracking=tracking
Frame 2: timestampMs=67867 source=native tracking=tracking
Frame 3: timestampMs=67900 source=native tracking=tracking
keys=[schemaVersion,timestampMs,source,tracking,face,eyes,mouth]
```

### 5.5 Browser Web Preview visual validation

URL: `http://localhost:5173/?source=native`

| Observation                                          | Result                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Page loads                                           | PASS — HTTP 200                                                                              |
| Native source WebSocket connection / frame reception | PASS — confirmed via bridge check (section 5.4)                                              |
| Avatar visual output updates                         | MANUAL — visually observed by human; avatar animation responding to native MotionFrame input |
| Updates tied to native MotionFrame input             | MANUAL — observed while packaged native pipeline active on port 45731                        |
| No screenshots or recordings committed               | PASS — none committed                                                                        |

### 5.6 OBS Browser Source visual validation

OBS Studio 32.1.2 (confirmed in prior pass). Browser Source added:

- URL: `http://localhost:5173/?mode=obs&source=native`
- Width: 1280, Height: 720

| Observation                            | Result                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| OBS Studio available                   | PASS — OBS 32.1.2 installed and running (confirmed prior pass PR #377)        |
| Browser Source added in OBS scene      | MANUAL — performed via OBS GUI (Sources `+` → Browser)                        |
| Local Web Preview URL loaded in OBS    | MANUAL — OBS canvas shows Web Preview content; visually observed by human     |
| Visual output updates in OBS canvas    | MANUAL — live motion updates visible in OBS canvas while native pipeline runs |
| OBS scene files / recordings committed | PASS — none committed                                                         |

### 5.7 Native pipeline stop from Electron UI

- Activated **Stop native pipeline** button in Electron UI
- UI feedback: **"Native runtime stopped."** visible

Post-stop observations:

| Observation                       | Result                                                            |
| --------------------------------- | ----------------------------------------------------------------- |
| `lvk-tracker-core.exe` terminated | PASS — no process found                                           |
| Port 45731 not listening          | PASS — no `LISTENING` entry (TIME_WAIT entries normal OS cleanup) |
| UI stop feedback visible          | PASS — "Native runtime stopped." confirmed                        |

---

## 6. Safety Confirmations

- No camera frames captured, stored, committed, or transmitted externally.
- Bridge bound exclusively to `127.0.0.1:45731`. Not `0.0.0.0`.
- No global `PATH` mutated. Packaged tracker env is process-local.
- No screenshots committed. No raw logs committed. No local absolute paths committed.
- No MotionFrame protocol schema changes.
- No new npm/pnpm dependencies added.
- No telemetry, analytics, cloud upload, or new network behavior introduced.
- No DLLs, native binaries, build outputs, `.lvk-native-runtime/`, or
  `win-unpacked/` committed.

---

## 7. Not Validated / Limitations

- Visual avatar animation and OBS canvas rendering are MANUAL observations —
  not independently captured. No screenshot or recording was made.
- Camera smoke was performed on a development machine that already has the VC++
  Redistributable installed. Clean-machine camera smoke remains a separate check.
- `build:win` (NSIS installer) was not validated.
- Code signing was not validated.
- OBS WebSocket server was not enabled; programmatic scene configuration was not
  used.
- Only camera index 0 was tested.

---

## 8. Follow-ups

- Clean-machine camera smoke (VC++ Redistributable only, no dev toolchain).
- Installer build (`build:win` NSIS) not yet validated.
