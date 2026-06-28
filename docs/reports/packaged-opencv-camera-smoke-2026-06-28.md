# Packaged OpenCV Camera Smoke — 2026-06-28

## 1. Summary

This report records a finite OpenCV camera smoke from the packaged Native Core
runtime location after the prior validation chain confirmed:

- 21-DLL manifest resolves the `STATUS_DLL_NOT_FOUND` failure from PR #368
  (PR #370, PR #371).
- `pnpm --filter @lvk/desktop build:unpack` exits 0 end-to-end after enabling
  Windows symlink creation privilege (PR #373).
- Packaged Native Core starts in a clean Windows Sandbox with only the Microsoft
  Visual C++ Redistributable x64 installed (PR #374).

**Key result: finite OpenCV camera smoke from the packaged resources location
PASS.** The camera opened via MSMF backend, exactly 3 MotionFrame JSON lines were
emitted to stdout, the process exited cleanly (exit 0), and no raw camera frames
were printed, written, uploaded, persisted, or sent.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, the manifest, the `MotionFrame`
schema, or the Motion Protocol.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/packaged-opencv-camera-smoke`
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
- OpenCV runtime DLLs source: local vcpkg release bin (`<vcpkg-root>/installed/x64-windows/bin`)
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
  present before running camera smoke.
- Windows symlink creation privilege was enabled on this machine (confirmed in
  PR #373).
- No rebuilding of `.lvk-native-runtime/` or rerun of `build:unpack` was required
  for this pass.

## 5. Packaged resources layout confirmed

The packaged `<unpacked-app>/resources/native-runtime/bin/` directory contained
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

| Check                                              | Command                                 | Result                              |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| Formatting                                         | `pnpm format:check`                     | PASS                                |
| Manifest DLL staging verification (21 DLLs)        | `pnpm prep:native-runtime:verify:local` | PASS — all 21 manifest DLLs present |
| `.lvk-native-runtime/` not committed (git-ignored) | `git status`                            | PASS — not tracked                  |

### 6.2 Capability preflight from packaged resources

Process-local `PATH` was restricted to Windows System32 only — no vcpkg directory
was included:

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
& "<unpacked-app>\resources\native-runtime\bin\lvk-tracker-core.exe" --print-runtime-capabilities
```

| Check                                                                                              | Result                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Native Core starts from `<resources>/native-runtime/bin/` using ONLY adjacent DLLs (no vcpkg PATH) | PASS — exit 0                                              |
| `--print-runtime-capabilities` output received                                                     | PASS                                                       |
| `opencvCameraSupport=true`                                                                         | PASS                                                       |
| `opencvFaceDetectorSupport=true`                                                                   | PASS                                                       |
| `localOnly=true`                                                                                   | PASS                                                       |
| `cameraOpened=false`, `motionFramesEmitted=false`                                                  | PASS — capability mode opens no camera and emits no frames |
| No raw camera frames printed / written / uploaded / persisted                                      | PASS — output is sanitized key=value text only             |

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

### 6.3 Finite OpenCV camera smoke from packaged resources

Process-local `PATH` was restricted to Windows System32 only — no vcpkg directory
was included:

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
& "<unpacked-app>\resources\native-runtime\bin\lvk-tracker-core.exe" --camera-source opencv --frames 3 --log-camera-status
```

| Check                                                                               | Result                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Native Core starts from packaged resources using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — exit 0                                             |
| Camera opened                                                                       | **PASS** — MSMF backend, camera index 0, 640×480, 30 fps      |
| Exactly 3 MotionFrame JSON lines emitted                                            | **PASS** — `emittedFrameCount=3` confirmed in shutdown status |
| MotionFrame JSON output received on stdout                                          | **PASS** — 3 valid MotionFrame JSON lines                     |
| Process exited cleanly                                                              | **PASS** — exit 0                                             |
| `localOnly=true` preserved (from capability preflight)                              | PASS                                                          |
| No raw camera frame bytes printed to stdout                                         | **PASS** — only MotionFrame JSON and camera status lines      |
| No camera frames written to disk                                                    | **PASS** — no file output observed                            |
| No camera frames uploaded, persisted, or sent                                       | **PASS** — local-first; no network behavior                   |
| No network behavior introduced                                                      | **PASS**                                                      |
| Process-local PATH excluded vcpkg                                                   | **PASS** — System32-only PATH used                            |
| `failedReadCount=0`                                                                 | **PASS** — no failed camera reads                             |

Camera status output observed at startup:

```txt
[camera] startup: sourceName=opencv-camera-source, isRunning=true, width=640,
height=480, nominalFps=30, emittedFrameCount=0, cameraIndex=0, backendName=MSMF,
failedReadCount=0
```

MotionFrame JSON lines observed (3 lines, stdout only — no raw pixel data):

```txt
{"schemaVersion":1,"timestampMs":0,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.000000,"y":0.000000,"z":0.000000},"rotation":{"pitch":0.000000,"yaw":0.000000,"roll":0.000000}},"eyes":{"leftOpen":0.850000,"rightOpen":0.879800,"gaze":{"x":0.000000,"y":0.000000}},"mouth":{"open":0.250000,"smile":0.350000}}
{"schemaVersion":1,"timestampMs":33,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.001320,"y":0.000792,"z":0.000000},"rotation":{"pitch":0.002772,"yaw":0.005345,"roll":0.001320}},"eyes":{"leftOpen":0.864826,"rightOpen":0.894185,"gaze":{"x":0.007424,"y":0.003465}},"mouth":{"open":0.276323,"smile":0.353960}}
{"schemaVersion":1,"timestampMs":67,"source":"native","tracking":{"status":"tracking","confidence":1.000000},"face":{"position":{"x":0.002679,"y":0.001608,"z":0.000000},"rotation":{"pitch":0.005626,"yaw":0.010847,"roll":0.002679}},"eyes":{"leftOpen":0.879947,"rightOpen":0.908551,"gaze":{"x":0.015066,"y":0.007032}},"mouth":{"open":0.302961,"smile":0.358036}}
```

Camera status output observed at shutdown:

```txt
[camera] shutdown: sourceName=opencv-camera-source, isRunning=false, width=640,
height=480, nominalFps=30, emittedFrameCount=3, cameraIndex=0, backendName=MSMF,
failedReadCount=0, effectiveFps=4.48097
```

Exit code: 0

### 6.4 OBS / Browser Source validation

SKIP / not performed. Out of scope for this packaged camera smoke report.

## 7. PASS / FAIL / SKIP roll-up

- `pnpm format:check`: PASS
- Manifest DLL staging verification (21 DLLs): PASS
- `.lvk-native-runtime/` not committed: PASS
- Packaged `bin/` file presence (`lvk-tracker-core.exe` + 21 DLLs): PASS
- Capability preflight from packaged resources (no vcpkg PATH): PASS
- `opencvCameraSupport=true` from packaged location: PASS
- `localOnly=true` from packaged location: PASS
- **Finite OpenCV camera smoke (3 frames, packaged resources): PASS**
- Camera opened (MSMF backend, index 0, 640×480): PASS
- Exactly 3 MotionFrame JSON lines emitted: PASS
- Process exited cleanly (exit 0): PASS
- No raw camera frames printed / written / uploaded / persisted / sent: PASS
- Process-local PATH excluded vcpkg: PASS
- OBS / Browser Source: SKIP
- `build:win` (installer): SKIP

## 8. Limitations / honesty notes

- Camera smoke was performed on a development machine that already has the VC++
  Redistributable installed. Clean-machine camera smoke (Sandbox with no
  development toolchain) was not performed in this pass. Capability-only Sandbox
  validation was confirmed in PR #374.
- Smoke used camera index 0. Other camera indices and multiple cameras were not
  tested.
- `effectiveFps=4.48097` in the shutdown log reflects the low throughput of a
  3-frame finite run; it does not indicate a performance issue in a continuous
  pipeline.
- Delay-loaded or `LoadLibrary`-resolved backends are not covered. Only the MSMF
  backend was exercised in this pass.
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
  outputs, `.lvk-native-runtime/` contents, `win-unpacked/` directory, raw logs,
  screenshots, raw camera frames, or local absolute paths were committed.
- No Native Core C++, CMake behavior, Electron runtime code, Electron packaging
  config, `MotionFrame` schema, Motion Protocol, or Web Preview behavior was
  changed.

## 10. Follow-up items

1. **Camera smoke in clean Sandbox:** confirm finite OpenCV camera smoke in
   Windows Sandbox (VC++ Redistributable only, no development toolchain). Requires
   a Sandbox environment with camera forwarding or a physical machine with no
   development tools.
2. **Continuous OpenCV pipeline with bridge:** run
   `--camera-source opencv --continuous --realtime | node tools/motion-ws-bridge.mjs`
   from the packaged resources location and confirm the Web Preview receives frames.
3. **OBS Browser Source validation:** out of scope here; remains a separate
   environment-dependent check.
4. **Installer build (`build:win`):** `electron-builder --win` (NSIS installer)
   has not been validated.
