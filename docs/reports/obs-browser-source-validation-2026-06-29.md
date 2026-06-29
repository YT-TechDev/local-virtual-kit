# OBS Browser Source Validation — 2026-06-29

## 1. Summary

This report records the local OBS Browser Source validation following the prior
validation chain that established continuous packaged OpenCV pipeline through
`motion-ws-bridge` into Web Preview (PR #376).

**Key results:**

- **PASS:** `pnpm format:check` — all files formatted.
- **PASS:** `pnpm prep:native-runtime:verify:local` — all 21 manifest DLLs
  present in staging directory.
- **PASS:** `pnpm test:motion-ws-bridge` — bridge smoke passed.
- **PASS:** `pnpm --filter @lvk/desktop build:unpack` — exits 0; packaged
  resources `<unpacked-app>/resources/native-runtime/bin/` confirmed with
  `lvk-tracker-core.exe` and all 21 manifest DLLs (run in prior session; not
  re-run in this pass).
- **PASS:** Capability preflight from packaged resources (no vcpkg PATH) —
  `opencvCameraSupport=true`, `localOnly=true`, exit 0.
- **PASS:** Web Preview HTTP server started at `http://127.0.0.1:5173/` — HTTP 200. OBS-friendly URL `http://localhost:5173/?mode=obs&source=native` also
  returns HTTP 200.
- **PASS:** Continuous packaged OpenCV pipeline — camera opened (MSMF, index 0,
  640×480, 30 fps nominal), MotionFrame JSON emitted in bounded run from
  packaged resources with no vcpkg PATH.
- **PASS:** `motion-ws-bridge` started and bound to
  `ws://127.0.0.1:45731/motion`.
- **PASS:** OBS Studio 32.1.2 installed (`obs64.exe` v32.1.2 at standard
  location).
- **PASS:** OBS Studio launched (PID confirmed, window title confirmed).
- **PASS:** Browser Source source type available — `obs-browser.dll` plugin
  present in OBS installation.
- **MANUAL:** OBS Browser Source configured with local Web Preview URL —
  requires GUI interaction; confirmed OBS is running and browser plugin is
  present; actual Browser Source scene configuration requires local GUI
  observation.
- **MANUAL:** Visual avatar rendering in OBS canvas — local manual observation
  required; not independently captured.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, the manifest, the `MotionFrame`
schema, the Motion Protocol, or Web Preview code.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/obs-browser-source-validation`
- Prior validation chain: PR #370 (21-DLL manifest), PR #371 (packaged Native
  Core starts without vcpkg PATH), PR #373 (full `build:unpack` exits 0),
  PR #374 (clean Sandbox VC++ Redistributable validation), PR #375 (finite
  packaged OpenCV camera smoke: 3 frames, exit 0), PR #376 (continuous packaged
  OpenCV → `motion-ws-bridge` → Web Preview WebSocket connection confirmed)
- OpenCV runtime manifest:
  `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`
- Staged runtime directory (git-ignored): `.lvk-native-runtime/`
- Packaged resources location: `<unpacked-app>/resources/native-runtime/`
- OBS Browser Source URL (per guide): `http://localhost:5173/?mode=obs&source=native`
- OBS version: 32.1.2

## 3. Environment

- OS: Windows 11 Pro (x64)
- Node / pnpm: Node v24.16.0 / pnpm 11.5.0
- Native Core configuration tested: Release (x64)
- OpenCV found by CMake: yes (modular vcpkg OpenCV 4)
- LVK OpenCV camera support: ON
- LVK OpenCV face detector support: ON
- OpenCV runtime DLLs source: local vcpkg release bin
  (`<vcpkg-root>/installed/x64-windows/bin`)
- Windows camera permission: granted (camera opened successfully)
- Webcam available: yes — camera index 0, MSMF backend, 640×480, 30 fps nominal
- OS camera permission granted: yes — camera opened without error
- OBS Studio: 32.1.2 — installed and running

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>` and `<unpacked-app>`.

## 4. Preconditions

- `.lvk-native-runtime/bin/` was confirmed populated with 21-DLL set and
  `lvk-tracker-core.exe` via `pnpm prep:native-runtime:verify:local`.
- `<unpacked-app>/resources/native-runtime/bin/` existed from a prior
  `build:unpack` pass (exit 0 recorded in prior session); all 21 manifest DLLs
  and the executable were confirmed present before starting this validation. No
  rebuild was required for this pass.

## 5. Packaged resources layout confirmed

The packaged `<unpacked-app>/resources/native-runtime/bin/` directory contains
`lvk-tracker-core.exe` and all 21 manifest DLLs (confirmed from prior pass):

```txt
<unpacked-app>/resources/native-runtime/bin/
  abseil_dll.dll
  jpeg62.dll
  liblzma.dll
  libpng16.dll
  libprotobuf.dll
  libsharpyuv.dll
  libwebp.dll
  libwebpdecoder.dll
  libwebpdemux.dll
  libwebpmux.dll
  lvk-tracker-core.exe
  opencv_calib3d4.dll
  opencv_core4.dll
  opencv_dnn4.dll
  opencv_features2d4.dll
  opencv_flann4.dll
  opencv_imgcodecs4.dll
  opencv_imgproc4.dll
  opencv_objdetect4.dll
  opencv_videoio4.dll
  tiff.dll
  z.dll
```

## 6. Checks and results

### 6.1 Repository / staging checks

| Check                                              | Command                                 | Result                              |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| Formatting                                         | `pnpm format:check`                     | PASS                                |
| Manifest DLL staging verification (21 DLLs)        | `pnpm prep:native-runtime:verify:local` | PASS — all 21 manifest DLLs present |
| `.lvk-native-runtime/` not committed (git-ignored) | `git status`                            | PASS — not tracked                  |

`pnpm format:check` output:

```txt
Checking formatting...
All matched files use Prettier code style!
```

`pnpm prep:native-runtime:verify:local` output:

```txt
All 21 required DLL(s) present in destination.
```

### 6.2 Motion WebSocket bridge smoke

```bash
pnpm test:motion-ws-bridge
```

Result: **PASS** — `MotionFrame WebSocket bridge smoke check passed.`

The bridge binds to `127.0.0.1:45731` and accepts valid `MotionFrame` JSON over
localhost-only WebSocket transport. No new fields are required.

### 6.3 Capability preflight from packaged resources

Process-local `PATH` was restricted to Windows System32 only — no vcpkg
directory was included:

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
& "<unpacked-app>\resources\native-runtime\bin\lvk-tracker-core.exe" --print-runtime-capabilities
```

| Check                                                                               | Result                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Native Core starts from packaged resources using ONLY adjacent DLLs (no vcpkg PATH) | PASS — exit 0                                              |
| `--print-runtime-capabilities` output received                                      | PASS                                                       |
| `opencvCameraSupport=true`                                                          | PASS                                                       |
| `opencvFaceDetectorSupport=true`                                                    | PASS                                                       |
| `localOnly=true`                                                                    | PASS                                                       |
| `cameraOpened=false`, `motionFramesEmitted=false`                                   | PASS — capability mode opens no camera and emits no frames |
| No raw camera frames printed / written / uploaded / persisted                       | PASS — output is sanitized key=value text only             |

Capability output observed (no vcpkg PATH, packaged resources location):

```txt
LVK native runtime capabilities
opencvCameraSupport=true
opencvFaceDetectorSupport=true
supportedCameraSources=dummy,opencv
supportedFaceDetectors=noop,opencv
cameraOpened=false
motionFramesEmitted=false
localOnly=true
```

Exit code: 0

### 6.4 Web Preview start

Command:

```bash
pnpm dev:web
# resolves to: pnpm --filter @lvk/web-preview dev
```

| Check                                                       | Result                |
| ----------------------------------------------------------- | --------------------- |
| Web Preview dev server started                              | PASS — Vite v8.0.16   |
| HTTP 200 at `http://127.0.0.1:5173/`                        | PASS                  |
| HTTP 200 at `http://localhost:5173/?mode=obs&source=native` | PASS                  |
| No external network required                                | PASS — localhost only |

### 6.5 Continuous packaged OpenCV pipeline through motion-ws-bridge

Process-local `PATH` was restricted to Windows System32 only. Multiple bounded
runs were performed across this validation pass (each ~10–25 seconds, then
stopped by process termination):

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
& "<unpacked-app>\resources\native-runtime\bin\lvk-tracker-core.exe" `
    --camera-source opencv --continuous --realtime --log-camera-status `
    | node tools/motion-ws-bridge.mjs
```

Camera startup status observed in each run (native exe stderr):

```txt
[camera] startup: sourceName=opencv-camera-source, isRunning=true, width=640,
height=480, nominalFps=30, emittedFrameCount=0, cameraIndex=0, backendName=MSMF,
failedReadCount=0
```

Bridge log observed in each run:

```txt
[motion-ws-bridge] development server listening on ws://127.0.0.1:45731/motion
```

Sample MotionFrame JSON line (first of multiple lines, stdout only — no raw
pixel data):

```txt
{"schemaVersion":1,"timestampMs":0,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.000000,"y":0.000000,"z":0.000000},"rotation":{"pitch":0.000000,"yaw":0.000000,"roll":0.000000}},"eyes":{"leftOpen":0.850000,"rightOpen":0.879800,"gaze":{"x":0.000000,"y":0.000000}},"mouth":{"open":0.250000,"smile":0.350000}}
```

| Check                                                                               | Result                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Native Core starts from packaged resources using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — killed after bounded run                              |
| Camera opened                                                                       | **PASS** — MSMF backend, camera index 0, 640×480, 30 fps nominal |
| MotionFrame JSON streamed continuously to stdout                                    | **PASS** — multiple lines emitted in each bounded run            |
| Bridge started and bound to `ws://127.0.0.1:45731/motion`                           | **PASS** — confirmed in bridge stderr                            |
| Bridge received MotionFrame input via stdin                                         | **PASS** — lines forwarded from native exe stdout                |
| Process stopped cleanly within bounded run                                          | **PASS** — each run ~10–25 s, then stopped; no indefinite run    |
| No raw camera frame bytes printed to stdout                                         | **PASS** — only MotionFrame JSON and camera status lines         |
| No camera frames written to disk                                                    | **PASS** — no file output observed                               |
| No camera frames uploaded, persisted, or sent                                       | **PASS** — local-first; no network behavior                      |
| Process-local PATH excluded vcpkg                                                   | **PASS** — System32-only PATH used                               |

### 6.6 OBS Studio availability

OBS Studio was located in the standard installation path. The browser plugin
was confirmed present. The OBS process was running with the expected window
title.

```txt
Path: C:\Program Files\obs-studio\bin\64bit\obs64.exe
FileVersion: 32.1.2
ProductVersion: 32.1.2
Process: obs64.exe (PID confirmed)
Window title: OBS 32.1.2 - プロファイル: 無題 - シーン: 無題
Browser plugin: obs-browser.dll (64bit plugin directory)
```

| Check                                | Result                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| OBS Studio installed                 | **PASS** — OBS 32.1.2 found at standard installation path      |
| OBS Studio launched                  | **PASS** — process running, window title confirmed             |
| OBS version                          | **32.1.2**                                                     |
| Browser Source source type available | **PASS** — `obs-browser.dll` present in 64bit plugin directory |

### 6.7 OBS Browser Source configuration

OBS Studio 32.1.2 was running with the browser plugin available. The Web
Preview HTTP server was confirmed accessible at both:

- `http://127.0.0.1:5173/` — HTTP 200
- `http://localhost:5173/?mode=obs&source=native` — HTTP 200

The packaged Native Core continuous OpenCV pipeline was running through
`motion-ws-bridge` during the validation window, with the bridge listening on
`ws://127.0.0.1:45731/motion`.

**Browser Source scene configuration requires direct GUI interaction with the
OBS application.** The OBS native WebSocket server was not enabled (port 4455
not active), so programmatic scene manipulation was not available.

Adding and observing the Browser Source in OBS requires a local operator to:

1. Open OBS → click the `+` button in the Sources panel.
2. Select **Browser**.
3. Enter URL: `http://localhost:5173/?mode=obs&source=native`
4. Set Width: 1280, Height: 720.
5. Click OK and observe the OBS canvas.

| Check                               | Result                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| OBS Studio launched                 | **PASS** — OBS 32.1.2 running                                             |
| Browser plugin available            | **PASS** — `obs-browser.dll` present                                      |
| Web Preview HTTP accessible for OBS | **PASS** — both URLs return HTTP 200                                      |
| Pipeline running during OBS window  | **PASS** — camera open, bridge listening on `ws://127.0.0.1:45731/motion` |
| Browser Source added in OBS         | **MANUAL** — requires local GUI interaction                               |
| Local Web Preview URL loaded in OBS | **MANUAL** — requires local GUI observation                               |
| OBS canvas shows Web Preview        | **MANUAL** — requires local GUI observation                               |
| Live motion updates visible in OBS  | **MANUAL** — requires local GUI observation; not independently captured   |

### 6.8 Visual rendering observation

**MANUAL** — Visual rendering in OBS canvas requires a local operator to add
the Browser Source and observe the canvas. The infrastructure (OBS installed,
browser plugin present, Web Preview HTTP accessible, pipeline running, bridge
listening) is confirmed PASS. Visual rendering was not independently captured in
this validation pass.

## 7. PASS / FAIL / SKIP / MANUAL roll-up

| Check                                                                  | Result                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm format:check`                                                    | PASS                                                              |
| `pnpm prep:native-runtime:verify:local` (21 DLLs)                      | PASS                                                              |
| `.lvk-native-runtime/` not committed (git-ignored)                     | PASS                                                              |
| Packaged `bin/` file presence (`lvk-tracker-core.exe` + 21 DLLs)       | PASS                                                              |
| `pnpm test:motion-ws-bridge`                                           | PASS                                                              |
| Capability preflight from packaged resources (no vcpkg PATH)           | PASS                                                              |
| `opencvCameraSupport=true` from packaged location                      | PASS                                                              |
| `localOnly=true` from packaged location                                | PASS                                                              |
| Web Preview HTTP server (`pnpm dev:web`)                               | PASS                                                              |
| HTTP 200 at `http://localhost:5173/?mode=obs&source=native`            | PASS                                                              |
| Camera opened (MSMF backend, index 0, 640×480) from packaged resources | PASS                                                              |
| Continuous MotionFrame JSON streamed from packaged resources           | PASS — multiple frames in bounded runs                            |
| `motion-ws-bridge` started and bound to `ws://127.0.0.1:45731/motion`  | PASS                                                              |
| Bridge received MotionFrame input via stdin                            | PASS                                                              |
| No raw camera frames printed / written / uploaded / persisted / sent   | PASS                                                              |
| Bounded runs (not indefinite)                                          | PASS — each run ~10–25 s, then stopped                            |
| Process-local PATH excluded vcpkg                                      | PASS                                                              |
| `.lvk-native-runtime/` and `win-unpacked/` not committed               | PASS — not tracked                                                |
| No local absolute paths committed                                      | PASS                                                              |
| **OBS Studio installed**                                               | **PASS** — OBS 32.1.2 at standard path                            |
| **OBS Studio launched**                                                | **PASS** — process running, window title confirmed                |
| **OBS version**                                                        | **32.1.2**                                                        |
| **Browser Source source type available**                               | **PASS** — `obs-browser.dll` confirmed                            |
| Browser Source added in OBS scene                                      | **MANUAL** — GUI interaction required                             |
| Local Web Preview URL loaded in OBS Browser Source                     | **MANUAL** — GUI observation required                             |
| OBS canvas shows Web Preview                                           | **MANUAL** — GUI observation required                             |
| Live motion updates observed in OBS canvas                             | **MANUAL** — GUI observation required; not independently captured |
| OBS scene files / recordings committed                                 | PASS (none committed)                                             |
| `build:win` (installer)                                                | SKIP                                                              |

## 8. Limitations / honesty notes

- **OBS Browser Source scene configuration was not independently verified.**
  OBS 32.1.2 is installed and running with the browser plugin present. The Web
  Preview URL is accessible and the pipeline was running during the OBS
  validation window. Adding the Browser Source to a scene and observing the
  canvas requires direct GUI interaction that was not performed in this
  automated pass. Visual rendering in OBS canvas is labeled MANUAL.
- OBS's built-in WebSocket server (port 4455) was not enabled, so programmatic
  scene manipulation via the OBS WebSocket API was not available.
- The continuous pipeline was confirmed to start, open the camera, and emit
  MotionFrame JSON across multiple bounded runs. Bridge startup was confirmed.
  The `pnpm test:motion-ws-bridge` smoke confirms the bridge accepts WebSocket
  clients and broadcasts frames.
- Camera smoke was performed on a development machine that already has the VC++
  Redistributable installed. Clean-machine camera smoke remains a separate check.
- Smoke used camera index 0. Other camera indices were not tested.
- `build:win` (NSIS installer) was not run.
- Code signing was not validated.

## 9. Local-first / privacy confirmation

- No raw camera frames were printed, written, uploaded, persisted, or logged by
  any check in this pass. Only MotionFrame JSON (protocol output) and camera
  status log lines (key=value) were printed to stdout/stderr.
- No global `PATH` was mutated. The only `PATH` used for runtime checks was
  process-local to each command invocation and excluded the vcpkg directory.
- No runtime download of OpenCV or native dependencies was introduced.
- No telemetry, analytics, cloud upload, external frame processing, hidden
  network calls, or new network behavior was introduced.
- No actual DLLs, Native Core binaries, build artifacts, generated package
  outputs, `.lvk-native-runtime/` contents, `win-unpacked/` directory, raw
  logs, screenshots, raw camera frames, OBS scene files, OBS recordings, or
  local absolute paths were committed.
- No Native Core C++, CMake behavior, Electron runtime code, Electron packaging
  config, `MotionFrame` schema, Motion Protocol, or Web Preview code was
  changed.

## 10. Follow-up items

1. **OBS Browser Source scene validation (manual):** With OBS 32.1.2 open,
   `pnpm dev:web` running, and the packaged continuous pipeline piped through
   `motion-ws-bridge`, manually add a Browser Source in OBS pointing to
   `http://localhost:5173/?mode=obs&source=native` (Width: 1280, Height: 720)
   and confirm the Web Preview renders in the OBS canvas. Observe whether live
   motion updates are visible while the pipeline runs. Record result as
   PASS/MANUAL in a follow-up commit or note.
2. **OBS WebSocket server:** Enable OBS's built-in WebSocket server (Tools →
   obs-websocket Settings → Enable WebSocket server) to allow future automated
   scene configuration and headless Browser Source testing.
3. **Visual rendering manual check:** Open
   `http://localhost:5173/?mode=obs&source=native` in a standard browser while
   the pipeline is running and confirm the avatar or 3D preview updates from
   live MotionFrame data.
4. **Camera smoke in clean Sandbox:** Confirm finite OpenCV camera smoke in
   Windows Sandbox (VC++ Redistributable only, no development toolchain).
5. **Installer build (`build:win`):** `electron-builder --win` (NSIS installer)
   has not been validated.
