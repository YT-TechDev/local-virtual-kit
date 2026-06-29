# OBS Browser Source Validation — 2026-06-29

## 1. Summary

This report records the local OBS Browser Source validation attempt following the
prior validation chain that established continuous packaged OpenCV pipeline
through `motion-ws-bridge` into Web Preview (PR #376).

**Key results:**

- **PASS:** `pnpm format:check` — all files formatted.
- **PASS:** `pnpm prep:native-runtime:verify:local` — all 21 manifest DLLs
  present in staging directory.
- **PASS:** `pnpm test:motion-ws-bridge` — bridge smoke passed.
- **PASS:** `pnpm --filter @lvk/desktop build:unpack` — exits 0; packaged
  resources `<unpacked-app>/resources/native-runtime/bin/` confirmed with
  `lvk-tracker-core.exe` and all 21 manifest DLLs.
- **PASS:** Capability preflight from packaged resources (no vcpkg PATH) —
  `opencvCameraSupport=true`, `localOnly=true`, exit 0.
- **PASS:** Web Preview HTTP server started at `http://127.0.0.1:5173/` — HTTP 200.
- **PASS:** Continuous packaged OpenCV pipeline — camera opened (MSMF, index 0,
  640×480), 20+ MotionFrame JSON lines emitted in bounded run from packaged
  resources with no vcpkg PATH.
- **PASS:** `motion-ws-bridge` started and bound to
  `ws://127.0.0.1:45731/motion`.
- **SKIP:** OBS Browser Source validation — OBS Studio was not found on the
  test machine. No OBS validation was performed or claimed.
- **SKIP:** Visual avatar rendering in OBS — OBS not available on test machine.

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
- OBS Browser Source target URL: `http://127.0.0.1:5173/?source=native`
- OBS-friendly URL (per guide): `http://localhost:5173/?mode=obs&source=native`

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
- OBS checked: not installed — SKIP

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>` and `<unpacked-app>`.

## 4. Preconditions

- `.lvk-native-runtime/bin/` was confirmed populated with 21-DLL set and
  `lvk-tracker-core.exe` via `pnpm prep:native-runtime:verify:local`.
- `pnpm --filter @lvk/desktop build:unpack` was re-run in this validation pass
  and exited 0, confirming `<unpacked-app>/resources/native-runtime/bin/` was
  freshly rebuilt with all 21 manifest DLLs and the executable.
- No rebuilding of `.lvk-native-runtime/` was required — the manifest DLL
  staging directory was already populated from prior passes.

## 5. Packaged resources layout confirmed

`build:unpack` completed with exit 0. The packaged
`<unpacked-app>/resources/native-runtime/bin/` directory contained
`lvk-tracker-core.exe` and all 21 manifest DLLs:

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

| Check                                              | Command                                   | Result                              |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| Formatting                                         | `pnpm format:check`                       | PASS                                |
| Manifest DLL staging verification (21 DLLs)        | `pnpm prep:native-runtime:verify:local`   | PASS — all 21 manifest DLLs present |
| `.lvk-native-runtime/` not committed (git-ignored) | `git status`                              | PASS — not tracked                  |
| Full unpack build                                  | `pnpm --filter @lvk/desktop build:unpack` | PASS — exit 0                       |

`pnpm format:check` output:

```txt
Checking formatting...
All matched files use Prettier code style!
```

`pnpm prep:native-runtime:verify:local` output:

```txt
All 21 required DLL(s) present in destination.
```

`pnpm --filter @lvk/desktop build:unpack` — final lines observed:

```txt
• packaging       platform=win32 arch=x64 electron=39.8.10 appOutDir=dist\win-unpacked
• updating asar integrity executable resource
• signing with signtool.exe  path=dist\win-unpacked\resources\native-runtime\bin\lvk-tracker-core.exe
• signing with signtool.exe  path=dist\win-unpacked\desktoplvk.exe
```

Exit code: 0

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

| Check                                              | Result                                        |
| -------------------------------------------------- | --------------------------------------------- |
| Web Preview dev server started                     | PASS — Vite v8.0.16, ready in ~378 ms         |
| HTTP server accessible at `http://127.0.0.1:5173/` | PASS — HTTP 200, `<title>web-preview</title>` |
| No external network required                       | PASS — localhost only                         |

### 6.5 Continuous packaged OpenCV pipeline

Process-local `PATH` was restricted to Windows System32 only. The packaged
Native Core executable was run from the packaged resources location and its
stdout was piped to `motion-ws-bridge` stdin:

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
& "<unpacked-app>\resources\native-runtime\bin\lvk-tracker-core.exe" `
    --camera-source opencv --continuous --realtime --log-camera-status `
    | node tools/motion-ws-bridge.mjs
```

Run was bounded to approximately 10–12 seconds, then stopped by process
termination. 20+ MotionFrame JSON lines were emitted during the run.

Camera startup status observed (native exe stderr):

```txt
[camera] startup: sourceName=opencv-camera-source, isRunning=true, width=640,
height=480, nominalFps=30, emittedFrameCount=0, cameraIndex=0, backendName=MSMF,
failedReadCount=0
```

Bridge log observed:

```txt
[motion-ws-bridge] development server listening on ws://127.0.0.1:45731/motion
```

Sample MotionFrame JSON line received (first of 20+ lines, stdout only — no raw
pixel data):

```txt
{"schemaVersion":1,"timestampMs":0,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.000000,"y":0.000000,"z":0.000000},"rotation":{"pitch":0.000000,"yaw":0.000000,"roll":0.000000}},"eyes":{"leftOpen":0.850000,"rightOpen":0.879800,"gaze":{"x":0.000000,"y":0.000000}},"mouth":{"open":0.250000,"smile":0.350000}}
```

| Check                                                                               | Result                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Native Core starts from packaged resources using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — killed after bounded run                              |
| Camera opened                                                                       | **PASS** — MSMF backend, camera index 0, 640×480, 30 fps nominal |
| MotionFrame JSON streamed continuously to stdout                                    | **PASS** — 20+ lines in ~10 s bounded run                        |
| Bridge started and bound to `ws://127.0.0.1:45731/motion`                           | **PASS** — confirmed in bridge stderr                            |
| Bridge received MotionFrame input via stdin                                         | **PASS** — lines forwarded from native exe stdout                |
| Process was stopped cleanly within bounded run                                      | **PASS** — killed after ~10–12 s; no indefinite run              |
| No raw camera frame bytes printed to stdout                                         | **PASS** — only MotionFrame JSON and camera status lines         |
| No camera frames written to disk                                                    | **PASS** — no file output observed                               |
| No camera frames uploaded, persisted, or sent                                       | **PASS** — local-first; no network behavior                      |
| Process-local PATH excluded vcpkg                                                   | **PASS** — System32-only PATH used                               |

### 6.6 OBS availability check

OBS Studio was searched in standard installation locations and the Windows
registry. OBS was not found on the test machine.

| Check                                | Result                                          |
| ------------------------------------ | ----------------------------------------------- |
| OBS Studio installed                 | **SKIP** — OBS Studio not found on test machine |
| OBS launched                         | **SKIP** — OBS not installed                    |
| OBS version                          | **SKIP** — not determined                       |
| Browser Source source type available | **SKIP** — OBS not installed                    |

### 6.7 OBS Browser Source configuration

**SKIP** — OBS Studio was not installed on the test machine. No Browser Source
was added, no local URL was loaded, and no OBS canvas preview was observed.

The following checklist items from `docs/LOCAL_RUNTIME_CHECKLIST.md` section 7
and `docs/OBS_BROWSER_SOURCE_GUIDE.md` remain unvalidated in this pass:

- OBS Browser Source added at `http://localhost:5173/?mode=obs&source=native`
- Local URL loaded in OBS Browser Source
- Preview visible in OBS canvas
- Web Preview connected to `motion-ws-bridge` via OBS Browser Source
- Live avatar/motion updates manually observed in OBS

Reason for SKIP: OBS Studio is not installed on the machine used for this
validation pass. This is an environment-dependent local/manual check that
requires OBS to be installed and running on a local graphical machine.

### 6.8 Visual rendering and avatar observation

**SKIP** — OBS not available. Visual rendering observation in OBS canvas was
not performed.

The Web Preview HTTP server was confirmed accessible at
`http://127.0.0.1:5173/` (HTTP 200). Browser-based rendering (without OBS)
was not independently verified in this pass.

## 7. PASS / FAIL / SKIP / MANUAL roll-up

| Check                                                                  | Result                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm format:check`                                                    | PASS                                            |
| `pnpm prep:native-runtime:verify:local` (21 DLLs)                      | PASS                                            |
| `.lvk-native-runtime/` not committed (git-ignored)                     | PASS                                            |
| `pnpm --filter @lvk/desktop build:unpack`                              | PASS — exit 0                                   |
| Packaged `bin/` file presence (`lvk-tracker-core.exe` + 21 DLLs)       | PASS                                            |
| `pnpm test:motion-ws-bridge`                                           | PASS                                            |
| Capability preflight from packaged resources (no vcpkg PATH)           | PASS                                            |
| `opencvCameraSupport=true` from packaged location                      | PASS                                            |
| `localOnly=true` from packaged location                                | PASS                                            |
| Web Preview HTTP server (`pnpm dev:web`)                               | PASS — HTTP 200                                 |
| Camera opened (MSMF backend, index 0, 640×480) from packaged resources | PASS                                            |
| Continuous MotionFrame JSON streamed from packaged resources           | PASS — 20+ frames in ~10 s bounded run          |
| `motion-ws-bridge` started and bound to `ws://127.0.0.1:45731/motion`  | PASS                                            |
| Bridge received MotionFrame input via stdin                            | PASS — frames forwarded from native exe stdout  |
| No raw camera frames printed / written / uploaded / persisted / sent   | PASS                                            |
| Bounded run (not indefinite)                                           | PASS — ~10–12 s, then stopped                   |
| Process-local PATH excluded vcpkg                                      | PASS                                            |
| `.lvk-native-runtime/` and `win-unpacked/` not committed               | PASS — not tracked                              |
| No local absolute paths committed                                      | PASS                                            |
| OBS installed                                                          | **SKIP** — OBS Studio not found on test machine |
| OBS launched                                                           | **SKIP** — OBS not installed                    |
| OBS Browser Source added                                               | **SKIP** — OBS not installed                    |
| Local Web Preview URL loaded in OBS                                    | **SKIP** — OBS not installed                    |
| OBS canvas preview visible                                             | **SKIP** — OBS not installed                    |
| Live motion updates observed in OBS                                    | **SKIP** — OBS not installed                    |
| `build:win` (installer)                                                | SKIP                                            |

## 8. Limitations / honesty notes

- **OBS Browser Source was not validated in this pass.** OBS Studio was not
  installed on the test machine. OBS validation requires a local graphical
  machine with OBS installed. This check remains an open environment-dependent
  follow-up.
- The continuous pipeline was confirmed to start, open the camera, and emit
  MotionFrame JSON. Bridge startup was confirmed. WebSocket client connection
  to the bridge was not verified in this pass beyond the `pnpm test:motion-ws-bridge`
  smoke (which uses a programmatic client). Browser-connected WebSocket was
  confirmed in PR #376.
- Camera smoke was performed on a development machine that already has the VC++
  Redistributable installed. Clean-machine camera smoke remains a separate check.
- The continuous pipeline throughput was 20+ frames in ~10 s. This reflects
  async pipe buffering; the actual camera runs at 30 fps nominal.
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
  logs, screenshots, raw camera frames, OBS scene files, or local absolute
  paths were committed.
- No Native Core C++, CMake behavior, Electron runtime code, Electron packaging
  config, `MotionFrame` schema, Motion Protocol, or Web Preview code was
  changed.
- No OBS scene files, OBS recordings, or OBS screenshots were committed
  (OBS was not installed).

## 10. Follow-up items

1. **OBS Browser Source validation:** Install OBS Studio on a local graphical
   machine, run `pnpm dev:web` and the packaged continuous pipeline through
   `motion-ws-bridge`, then add a Browser Source pointing to
   `http://localhost:5173/?mode=obs&source=native`. Confirm the OBS canvas loads
   the local Web Preview URL and observe whether live motion updates are visible.
2. **Visual rendering manual check:** Open `http://127.0.0.1:5173/?source=native`
   in a browser while the pipeline is running and confirm the avatar or 3D
   preview updates from live MotionFrame data.
3. **Camera smoke in clean Sandbox:** Confirm finite OpenCV camera smoke in
   Windows Sandbox (VC++ Redistributable only, no development toolchain).
4. **Installer build (`build:win`):** `electron-builder --win` (NSIS installer)
   has not been validated.
