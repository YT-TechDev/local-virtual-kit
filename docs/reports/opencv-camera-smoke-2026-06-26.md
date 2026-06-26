# OpenCV Camera Smoke Report

## 1. Report metadata

- Date: 2026-06-26
- Environment: Windows 11 Pro (local machine)
- OS: Windows 11 Pro 10.0.26200
- Node/pnpm: Node v24.16.0 / pnpm 11.5.0
- CMake: 4.3.3

## 2. Local prerequisites

- OpenCV found by CMake: no
- LVK `opencvCameraSupport`: false
- Webcam available: not checked
- OS camera permission granted: not checked

## 3. Command execution

- Command run: `pnpm smoke:native-opencv-camera:local`
- Was `pnpm smoke:native-opencv-camera:local` actually run: yes
- Result: SKIP
- Helper skipped honestly: yes
- MotionFrame JSON observed on stdout: not applicable
- `[camera]` diagnostics observed on stderr: not applicable

Helper output (sanitized):

```
OpenCV camera smoke skipped: opencvCameraSupport=false reported by --print-runtime-capabilities. Rebuild the native tracker with OpenCV available to enable the camera smoke.
```

## 4. Result classification

**SKIP**

The OpenCV camera smoke was skipped because `opencvCameraSupport=false` was reported by `--print-runtime-capabilities`. The native binary at `native/tracker-core/build/Debug/lvk-tracker-core.exe` was built without OpenCV support. The smoke helper detected this condition and exited without attempting camera access, which is the correct and honest behavior.

Supporting evidence from `node tools/check-native-runtime-capabilities.mjs`:

```
LVK native runtime capabilities
opencvCameraSupport=false
opencvFaceDetectorSupport=false
supportedCameraSources=dummy
supportedFaceDetectors=noop
cameraOpened=false
motionFramesEmitted=false
localOnly=true
```

## 5. Additional checks run

| Command | Result |
| --- | --- |
| `pnpm format:check` | PASS — all files formatted |
| `node tools/check-native-runtime-capabilities.mjs` (Debug binary) | PASS — capabilities check passed |
| `pnpm test` | PASS — all workspace and tool tests passed |

## 6. Privacy and artifact guardrails

- [x] No raw camera frames were printed, written, uploaded, or committed.
- [x] Raw camera frames remained local to Native Core memory (camera was not opened).
- [x] No screenshots were committed.
- [x] No logs containing sensitive local paths were committed.
- [x] No binaries, build artifacts, model files, or cascade XML files were committed.
- [x] No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior was introduced.
- [x] This report does not claim OBS, Electron GUI, webcam/OpenCV, OS camera permission, or real hardware validation beyond what was actually performed.

## 7. Unresolved items

- OpenCV camera validation cannot be performed until the native tracker is rebuilt with OpenCV development libraries available. Webcam availability and OS camera permission were not checked because the smoke prerequisite (`opencvCameraSupport=true`) was not met.
