# OpenCV Camera Smoke Report — OpenCV-Enabled Build

## 1. Report metadata

- Date: 2026-06-26
- Environment: Windows 11 Pro (local machine)
- OS: Windows 11 Pro 10.0.26200
- Node/pnpm: Node v24.16.0 / pnpm 11.5.0
- CMake: 4.3.3
- OpenCV: 4.12.0 (via local vcpkg installation)

## 2. Local prerequisites

- OpenCV found by CMake: yes
- LVK `opencvCameraSupport`: true
- LVK `opencvFaceDetectorSupport`: true
- Webcam available: not explicitly verified (camera opened successfully via MSMF backend with width=640, height=480)
- OS camera permission granted: not explicitly verified (camera opened without error)

## 3. CMake configure

OpenCV was not found by the standard configure command (the vcpkg installation was not on the default CMake search path). Configure succeeded with explicit vcpkg flags:

```
cmake -S native/tracker-core -B native/tracker-core/build \
  -DCMAKE_TOOLCHAIN_FILE=<vcpkg-root>/scripts/buildsystems/vcpkg.cmake \
  -DCMAKE_PREFIX_PATH=<vcpkg-root>/installed/x64-windows
```

CMake output (feature summary):

```
-- LVK Native Core OpenCV feature summary:
--   LVK OpenCV camera support: ON (components: core + videoio)
--   LVK OpenCV face detector support: ON (components: core + imgproc + objdetect)
```

## 4. Build

`cmake --build native/tracker-core/build` succeeded. The following targets were built with OpenCV support linked:

- `lvk-tracker-core.exe` (includes `opencv_camera_source.cpp`, `opencv_face_detector.cpp`)

Two C4819 code-page warnings were emitted (pre-existing, unrelated to OpenCV).

## 5. Runtime capabilities

The built binary requires the vcpkg DLL directory on `PATH` at runtime. With that set:

```
node tools/check-native-runtime-capabilities.mjs native/tracker-core/build/Debug/lvk-tracker-core.exe
```

Output:

```
LVK native runtime capabilities
opencvCameraSupport=true
opencvFaceDetectorSupport=true
supportedCameraSources=dummy,opencv
supportedFaceDetectors=noop,opencv
cameraOpened=false
motionFramesEmitted=false
localOnly=true
```

## 6. OpenCV camera smoke

### Check script fix

`tools/check-native-opencv-camera-smoke.mjs` contained an incorrect MotionFrame pattern (`{"type":"motion_frame"`) that did not match the current MotionFrame schema (`{"schemaVersion":1,...}`). The pattern was corrected to `{"schemaVersion":` before running the smoke.

### Command execution

```
pnpm smoke:native-opencv-camera:local
```

- Was `pnpm smoke:native-opencv-camera:local` actually run: yes
- Result: **PASS**
- Helper skipped honestly: not applicable (smoke ran)
- MotionFrame JSON observed on stdout: yes (3 lines, `schemaVersion=1`, `source=native`)
- `[camera]` diagnostics observed on stderr: yes

Sanitized camera diagnostics from stderr:

```
[camera] startup: sourceName=opencv-camera-source, isRunning=true, width=640, height=480, nominalFps=30, emittedFrameCount=0, cameraIndex=0, backendName=MSMF, failedReadCount=0
[camera] shutdown: sourceName=opencv-camera-source, isRunning=false, width=640, height=480, nominalFps=30, emittedFrameCount=3, cameraIndex=0, backendName=MSMF, failedReadCount=0, effectiveFps=~5.4
```

## 7. Result classification

**PASS**

The OpenCV camera smoke ran and passed. The camera pipeline opened via MSMF (Windows Media Foundation), emitted 3 MotionFrame JSON lines on stdout, and closed cleanly. The smoke helper exited zero.

## 8. Additional checks run

| Command                                                                               | Result                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm format:check`                                                                   | PASS — all files formatted                 |
| `pnpm test` (with vcpkg DLL path set)                                                 | PASS — all workspace and tool tests passed |
| `node tools/check-native-runtime-capabilities.mjs` (Debug binary, vcpkg DLL path set) | PASS — `opencvCameraSupport=true`          |
| `pnpm smoke:native-opencv-camera:local` (vcpkg DLL path set)                          | PASS                                       |

## 9. Unresolved items

### U1 — OpenCV INFO logs on stdout contaminate the MotionFrame stream

OpenCV's INFO-level log messages (`[ INFO:0@...]`) are written to stdout by the native binary. This contaminates the MotionFrame JSON stream and would cause JSON parse errors in the MotionFrame bridge during production use. The native source does not currently suppress or redirect OpenCV log output. A fix requires calling `cv::utils::logging::setLogLevel(cv::utils::logging::LOG_LEVEL_WARNING)` (or equivalent) in the camera source initialization. This was not fixed in this pass (scope restriction: no native source changes without reporting first).

### U2 — vcpkg DLLs not bundled; PATH must be set manually

The OpenCV-enabled binary dynamically links against vcpkg Debug DLLs. Without the vcpkg bin directory on `PATH`, the binary exits with `STATUS_DLL_NOT_FOUND` (0xC0000135). The standard `cmake -S ... -B ...` command in `docs/LOCAL_RUNTIME_CHECKLIST.md` will still produce a non-OpenCV build unless the vcpkg flags above are used. A production build would need to either bundle required DLLs or document the PATH requirement.

### U3 — Standard CMake configure does not find vcpkg OpenCV automatically

The vcpkg installation is not on the default CMake package search path. The explicit `-DCMAKE_TOOLCHAIN_FILE` and `-DCMAKE_PREFIX_PATH` flags are required. These flags contain local absolute paths and cannot be committed to the repository.

### U4 — Webcam availability and OS camera permission not explicitly verified

The camera opened successfully (MSMF, index 0, `emittedFrameCount=3`), but webcam availability and OS camera permission were not independently verified. These items remain unchecked per the checklist definition.

### U5 — OBS Browser Source and Electron GUI not validated

OBS Browser Source and Electron GUI validation were not performed in this pass and are not claimed.

## 10. Privacy and artifact guardrails

- [x] No raw camera frames were printed, written, uploaded, or committed.
- [x] Raw camera frames remained local to Native Core memory.
- [x] No screenshots were committed.
- [x] No logs containing sensitive local paths were committed.
- [x] No binaries, build artifacts, model files, or cascade XML files were committed.
- [x] No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior was introduced.
- [x] This report does not claim OBS, Electron GUI, or real hardware validation beyond what was actually performed.
- [x] Source code changes were limited to a check script pattern fix (`tools/check-native-opencv-camera-smoke.mjs`).
- [x] MotionFrame schema, Motion Protocol, Electron, Web Preview, and repo dependencies were not changed.
