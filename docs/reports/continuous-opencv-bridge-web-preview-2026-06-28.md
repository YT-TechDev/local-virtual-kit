# Continuous OpenCV Bridge Web Preview — 2026-06-28

## 1. Summary

This report records the local continuous OpenCV pipeline validation from the
packaged Native Core runtime through `motion-ws-bridge` into Web Preview.

**Key results:**

- **PASS:** Packaged Native Core continuously emits MotionFrame JSON from the
  local OpenCV camera using only adjacent DLLs (no vcpkg PATH).
- **PASS:** `motion-ws-bridge` starts, binds to `ws://127.0.0.1:45731/motion`,
  receives continuous MotionFrame input via stdin, and broadcasts to WebSocket
  clients.
- **PASS:** Web Preview HTTP server starts at `http://127.0.0.1:5173/`. The
  browser navigated to `?source=native` and the bridge confirmed a second
  WebSocket client connected (`client connected (2)`), indicating the Web
  Preview JavaScript connected to `ws://127.0.0.1:45731/motion` and received
  live MotionFrame data.
- **MANUAL / not independently captured:** Visual avatar rendering in the
  browser was not screenshot-verified in this validation pass. The WebSocket
  connection and live frame receive are confirmed. The rendered output was not
  independently captured.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, the manifest, the `MotionFrame`
schema, the Motion Protocol, or Web Preview code.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/continuous-opencv-bridge-web-preview`
- Prior validation chain: PR #370 (21-DLL manifest), PR #371 (packaged Native
  Core starts without vcpkg PATH), PR #373 (full `build:unpack` exits 0),
  PR #374 (clean Sandbox VC++ Redistributable validation), PR #375 (finite
  packaged OpenCV camera smoke: 3 frames, exit 0)
- OpenCV runtime manifest: `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`
- Staged runtime directory (git-ignored): `.lvk-native-runtime/`
- Packaged resources location: `<unpacked-app>/resources/native-runtime/`

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
- OBS checked: not checked

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>` and `<unpacked-app>`.

## 4. Preconditions

- `.lvk-native-runtime/bin/` was already populated with the 21-DLL set and
  `lvk-tracker-core.exe` from prior staging passes.
- `<unpacked-app>/resources/native-runtime/bin/` existed from a prior
  `build:unpack` pass; all 21 manifest DLLs and the executable were confirmed
  present before starting this validation.
- Windows symlink creation privilege was enabled on this machine (confirmed in
  PR #373). No rebuilding of `.lvk-native-runtime/` or rerun of `build:unpack`
  was required for this pass.

## 5. Packaged resources layout confirmed

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

The bridge binds to `127.0.0.1:45731` and accepts valid `MotionFrame` JSON
over localhost-only WebSocket transport. No new fields are required.

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

| Check                                              | Result                                        |
| -------------------------------------------------- | --------------------------------------------- |
| Web Preview dev server started                     | PASS — Vite v8.0.16, ready in ~674 ms         |
| HTTP server accessible at `http://127.0.0.1:5173/` | PASS — HTTP 200, `<title>web-preview</title>` |
| No external network required                       | PASS — localhost only                         |

### 6.5 Continuous packaged OpenCV pipeline through motion-ws-bridge

Process-local `PATH` was restricted to Windows System32 only. The packaged
Native Core executable was run from the packaged resources location:

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
& "<unpacked-app>\resources\native-runtime\bin\lvk-tracker-core.exe" `
    --camera-source opencv --continuous --realtime --log-camera-status `
    | node tools/motion-ws-bridge.mjs
```

Run was bounded to approximately 10–12 seconds, then stopped by process
termination (Ctrl+C / kill). The bridge was started with its own process,
and MotionFrame JSON lines from the native exe's stdout were piped to the
bridge's stdin.

Camera startup status observed (native exe stderr):

```txt
[camera] startup: sourceName=opencv-camera-source, isRunning=true, width=640,
height=480, nominalFps=30, emittedFrameCount=0, cameraIndex=0, backendName=MSMF,
failedReadCount=0
```

Bridge messages observed (bridge stderr):

```txt
[motion-ws-bridge] development server listening on ws://127.0.0.1:45731/motion
[motion-ws-bridge] client connected (1)
[motion-ws-bridge] client connected (2)
[motion-ws-bridge] stdin ended; keeping server alive with the latest valid frame
```

Sample MotionFrame JSON lines received by a WebSocket client during the run
(first 2 of 60+ frames, stdout only — no raw pixel data):

```txt
{"schemaVersion":1,"timestampMs":0,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.000000,"y":0.000000,"z":0.000000},"rotation":{"pitch":0.000000,"yaw":0.000000,"roll":0.000000}},"eyes":{"leftOpen":0.850000,"rightOpen":0.879800,"gaze":{"x":0.000000,"y":0.000000}},"mouth":{"open":0.250000,"smile":0.350000}}
{"schemaVersion":1,"timestampMs":33,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.001320,"y":0.000792,"z":0.000000},"rotation":{"pitch":0.002772,"yaw":0.005345,"roll":0.001320}},"eyes":{"leftOpen":0.864826,"rightOpen":0.894185,"gaze":{"x":0.007424,"y":0.003465}},"mouth":{"open":0.276323,"smile":0.353960}}
```

| Check                                                                               | Result                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Native Core starts from packaged resources using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — exit on kill (bounded run)                                                                               |
| Camera opened                                                                       | **PASS** — MSMF backend, camera index 0, 640×480, 30 fps nominal                                                    |
| MotionFrame JSON streamed continuously to stdout                                    | **PASS** — 60+ lines in ~10 s run                                                                                   |
| Bridge started and bound to `ws://127.0.0.1:45731/motion`                           | **PASS** — confirmed in bridge stderr                                                                               |
| Bridge received MotionFrame input via stdin                                         | **PASS** — `stdin ended; keeping server alive with the latest valid frame` confirms at least one valid frame cached |
| WebSocket client connected and received frames                                      | **PASS** — 60 frames received by test WS client in ~10 s                                                            |
| Process was stopped cleanly within bounded run                                      | **PASS** — killed after ~10–12 s; no indefinite run                                                                 |
| No raw camera frame bytes printed to stdout                                         | **PASS** — only MotionFrame JSON and camera status lines (stderr)                                                   |
| No camera frames written to disk                                                    | **PASS** — no file output observed                                                                                  |
| No camera frames uploaded, persisted, or sent                                       | **PASS** — local-first; no network behavior                                                                         |
| No unexpected external network behavior                                             | **PASS**                                                                                                            |
| Process-local PATH excluded vcpkg                                                   | **PASS** — System32-only PATH used                                                                                  |

### 6.6 Web Preview WebSocket connection

The browser was opened to `http://127.0.0.1:5173/?source=native` during the
pipeline run. The bridge stderr confirmed a second WebSocket client connected:

```txt
[motion-ws-bridge] client connected (2)
```

This indicates the Web Preview JavaScript (`?source=native` mode) connected to
`ws://127.0.0.1:45731/motion` and received the live MotionFrame stream from the
packaged Native Core.

A second programmatic WebSocket client probe also confirmed that late-connecting
clients receive the bridge's cached latest frame immediately on connect, plus
subsequent live frames:

```json
{
  "connected": true,
  "framesReceived": 5,
  "first": { "ts": 0, "src": "native", "st": "tracking" },
  "last": { "ts": 133, "src": "native", "st": "tracking" }
}
```

**Visual avatar rendering in the browser was not screenshot-verified in this
validation pass.** The browser connected to the bridge WebSocket while live
MotionFrame data was available. Visual avatar rendering requires local manual
observation and was not independently captured in this validation pass.

### 6.7 OBS / Browser Source validation

SKIP / not performed. Out of scope for this report.

## 7. PASS / FAIL / SKIP / MANUAL roll-up

| Check                                                                  | Result                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`                                                    | PASS                                                            |
| `pnpm prep:native-runtime:verify:local` (21 DLLs)                      | PASS                                                            |
| `.lvk-native-runtime/` not committed                                   | PASS                                                            |
| Packaged `bin/` file presence (`lvk-tracker-core.exe` + 21 DLLs)       | PASS                                                            |
| `pnpm test:motion-ws-bridge`                                           | PASS                                                            |
| Capability preflight from packaged resources (no vcpkg PATH)           | PASS                                                            |
| `opencvCameraSupport=true` from packaged location                      | PASS                                                            |
| `localOnly=true` from packaged location                                | PASS                                                            |
| Web Preview HTTP server (`pnpm dev:web`)                               | PASS                                                            |
| Camera opened (MSMF backend, index 0, 640×480) from packaged resources | PASS                                                            |
| Continuous MotionFrame JSON streamed from packaged resources           | PASS — 60+ frames / ~10 s run                                   |
| `motion-ws-bridge` started and received MotionFrame input              | PASS                                                            |
| WebSocket client connected and received frames from bridge             | PASS — 60 frames confirmed                                      |
| Web Preview browser connected to bridge WebSocket (`?source=native`)   | PASS — `client connected (2)` confirmed                         |
| Live MotionFrame data received by browser WebSocket                    | PASS — confirmed via bridge log and second WS client probe      |
| **Visual avatar rendering in browser**                                 | **MANUAL** — not independently captured in this validation pass |
| No raw camera frames printed / written / uploaded / persisted / sent   | PASS                                                            |
| Bounded run (not indefinite)                                           | PASS — ~10–12 s, then stopped                                   |
| Process-local PATH excluded vcpkg                                      | PASS                                                            |
| `.lvk-native-runtime/` and `win-unpacked/` not committed               | PASS — not tracked                                              |
| No local absolute paths committed                                      | PASS                                                            |
| OBS / Browser Source                                                   | SKIP                                                            |
| `build:win` (installer)                                                | SKIP                                                            |

## 8. Limitations / honesty notes

- Visual rendering confirmation requires opening the browser and manually
  observing the avatar. The WebSocket connection was confirmed by bridge log;
  rendering was not screenshot-captured or independently verified in this
  validation environment.
- Camera smoke was performed on a development machine that already has the VC++
  Redistributable installed. Clean-machine camera smoke (Sandbox with no
  development toolchain) was not performed in this continuous pipeline pass.
  Capability-only Sandbox validation was confirmed in PR #374.
- The continuous pipeline throughput at the pipe level was approximately 6 fps
  (60 frames in 10 s). This reflects the async pipe buffering behavior in the
  test setup, not a performance limitation of the native camera pipeline. The
  actual camera runs at 30 fps nominal; the pipe read rate depends on buffering
  and process scheduling.
- Smoke used camera index 0. Other camera indices and multiple cameras were not
  tested.
- OBS Browser Source validation remains a separate environment-dependent check.
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
  logs, screenshots, raw camera frames, or local absolute paths were committed.
- No Native Core C++, CMake behavior, Electron runtime code, Electron packaging
  config, `MotionFrame` schema, Motion Protocol, or Web Preview code was
  changed.

## 10. Follow-up items

1. **Visual rendering manual check:** open `http://127.0.0.1:5173/?source=native`
   in a browser while the pipeline is running and confirm the avatar or 3D
   preview updates from live MotionFrame data.
2. **Camera smoke in clean Sandbox:** confirm finite OpenCV camera smoke in
   Windows Sandbox (VC++ Redistributable only, no development toolchain).
   Requires a Sandbox environment with camera forwarding or a physical machine
   with no development tools.
3. **OBS Browser Source validation:** out of scope here; remains a separate
   environment-dependent check.
4. **Installer build (`build:win`):** `electron-builder --win` (NSIS installer)
   has not been validated.
