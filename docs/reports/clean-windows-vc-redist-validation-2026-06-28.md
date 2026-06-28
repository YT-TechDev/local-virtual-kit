# Clean Windows Sandbox VC++ Redistributable Validation — 2026-06-28

## 1. Summary

This report records a clean-environment validation of the packaged Native Core
runtime inside Windows Sandbox after installing only Microsoft Visual C++
Redistributable x64. No development tools — Visual Studio, Build Tools, vcpkg,
OpenCV, Node, pnpm, CMake, or Git — were installed in the Sandbox.

**Key result: the packaged Native Core starts in a clean Windows environment with
only VC++ Redistributable x64 installed.** `--print-runtime-capabilities` exited
successfully and reported `opencvCameraSupport=true`, `opencvFaceDetectorSupport=true`,
`cameraOpened=false`, `motionFramesEmitted=false`, and `localOnly=true`. All 21
manifest DLLs and `lvk-tracker-core.exe` were present in the packaged `bin/`
directory. No vcpkg directory on `PATH`, no local OpenCV install, no Node, pnpm,
CMake, Git, Visual Studio, or Build Tools were required.

This validates the LVK v0.x VC++ Redistributable strategy documented in
[`docs/WINDOWS_VC_REDIST_STRATEGY.md`](../WINDOWS_VC_REDIST_STRATEGY.md) for this
clean Sandbox pass.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, the manifest, the `MotionFrame`
schema, or the Motion Protocol.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/clean-windows-vc-redist-validation`
- Packaged resources layout: `<resources>/native-runtime/`
- Build output used: `win-unpacked/` from a prior `build:unpack` pass on the host machine

## 3. Environment

### Host machine (build source)

- OS: Windows 11 Pro (x64)
- `win-unpacked/` was built in an earlier pass and copied into the Sandbox.

### Sandbox environment

- OS: Windows Sandbox (clean Windows 10/11 x64 session)
- Microsoft Visual C++ Redistributable x64: installed
- Visual Studio: **not installed**
- Build Tools: **not installed**
- vcpkg: **not installed**
- OpenCV (development installation): **not installed**
- Node: **not installed**
- pnpm: **not installed**
- CMake: **not installed**
- Git: **not installed**
- `win-unpacked/` was copied from the host build output to the Sandbox desktop.
- Webcam available: not checked
- OS camera permission granted: not checked
- OBS checked: not checked

Local absolute paths are intentionally represented with placeholders such as
`<resources>`.

## 4. Validation procedure

### 4.1 File presence confirmation

Confirmed the packaged runtime executable was present in the copied `win-unpacked/`
directory:

```powershell
Test-Path "$env:USERPROFILE\Desktop\win-unpacked\resources\native-runtime\bin\lvk-tracker-core.exe"
```

Result: `True`

### 4.2 Packaged `bin/` contents

The packaged `native-runtime/bin/` directory contained `lvk-tracker-core.exe` and
all 21 manifest DLLs:

```txt
<resources>/native-runtime/bin/
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

### 4.3 Process-local PATH restriction

The process-local `PATH` was restricted to Windows system locations only before
running the executable:

```powershell
$env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
```

No vcpkg directory, no Node, no local OpenCV path, and no host tool paths were
present in the process-local environment.

### 4.4 Runtime capabilities check

```powershell
$runtime = "$env:USERPROFILE\Desktop\win-unpacked\resources\native-runtime\bin\lvk-tracker-core.exe"
& $runtime --print-runtime-capabilities
```

Output observed:

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

The executable exited successfully (exit 0). No `STATUS_DLL_NOT_FOUND` /
`0xC0000135` error occurred.

## 5. Checks and results

| Check                                                                            | Result                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `lvk-tracker-core.exe` present in packaged `bin/`                                | PASS — `Test-Path` returned `True`                         |
| All 21 manifest DLLs present in packaged `bin/`                                  | PASS — all 21 confirmed present                            |
| Native Core starts in clean Sandbox (only VC++ Redistributable x64 installed)    | **PASS** — exit 0                                          |
| `STATUS_DLL_NOT_FOUND` / `0xC0000135` absent                                     | PASS — no DLL error                                        |
| `--print-runtime-capabilities` output received                                   | PASS                                                       |
| `opencvCameraSupport=true`                                                       | PASS                                                       |
| `opencvFaceDetectorSupport=true`                                                 | PASS                                                       |
| `localOnly=true`                                                                 | PASS                                                       |
| `cameraOpened=false`, `motionFramesEmitted=false`                                | PASS — capability mode opens no camera and emits no frames |
| No raw camera frames printed / written / uploaded / persisted                    | PASS — output is sanitized key=value text only             |
| Process-local PATH restricted to System32/SystemRoot only                        | PASS                                                       |
| No vcpkg PATH required                                                           | PASS                                                       |
| No local OpenCV development installation required                                | PASS                                                       |
| No Node, pnpm, CMake, Git, Visual Studio, or Build Tools required inside Sandbox | PASS                                                       |

### Repository check

| Check      | Command             | Result |
| ---------- | ------------------- | ------ |
| Formatting | `pnpm format:check` | PASS   |

## 6. PASS / FAIL / SKIP roll-up

- `pnpm format:check`: PASS
- Packaged `bin/` file presence (`lvk-tracker-core.exe` + 21 DLLs): PASS
- Clean Sandbox startup (VC++ Redistributable x64 only installed): **PASS**
- `STATUS_DLL_NOT_FOUND` / `0xC0000135` absent: PASS
- `opencvCameraSupport=true` in clean Sandbox: PASS
- `opencvFaceDetectorSupport=true` in clean Sandbox: PASS
- `localOnly=true` in clean Sandbox: PASS
- `cameraOpened=false`, `motionFramesEmitted=false`: PASS
- vcpkg `PATH` not required: PASS
- No development toolchain required inside Sandbox: PASS
- Clean-machine validation without VC++ Redistributable installed: **not performed** — see section 7
- Camera smoke: SKIP
- OBS / Browser Source: SKIP
- `build:win` (installer): SKIP
- Code signing: SKIP

## 7. Limitations / honesty notes

- This validates the packaged Native Core in Windows Sandbox with Microsoft Visual
  C++ Redistributable x64 installed. It does **not** validate a machine where the
  VC++ Redistributable is absent. A machine without the redistributable may still
  fail to start.
- This does not validate installer behavior. `build:win` (NSIS installer) was not
  run. The `win-unpacked/` output was copied manually to the Sandbox desktop.
- This does not validate camera smoke. Webcam availability and OS camera permission
  were not confirmed in Sandbox. Camera smoke remains a separate local/manual check.
- This does not validate OBS Browser Source. Out of scope for this pass.
- This does not validate code signing or `build:win`.
- The capability run exercises startup only, not a live camera or codec path.
  Delay-loaded or `LoadLibrary`-resolved backends are not covered.

## 8. Relationship to LVK v0.x VC++ Redistributable strategy

The LVK v0.x strategy documented in
[`docs/WINDOWS_VC_REDIST_STRATEGY.md`](../WINDOWS_VC_REDIST_STRATEGY.md) depends
on Microsoft Visual C++ Redistributable being installed on the user's machine. The
VC++ runtime DLLs (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`,
`CONCRT140.dll`) are not bundled app-locally and are not part of the OpenCV runtime
manifest.

This Sandbox pass confirms that the strategy holds for a clean Windows environment
with only the VC++ Redistributable x64 installed: the packaged Native Core starts
successfully, `opencvCameraSupport=true`, and no additional development toolchain
is required at runtime.

The clean-machine validation checklist items from
`docs/WINDOWS_VC_REDIST_STRATEGY.md` that this pass addresses:

- [x] Confirmed the packaged Native Core starts from `<resources>/native-runtime/bin/`
      without any vcpkg directory on `PATH`.
- [x] Confirmed `--print-runtime-capabilities` reports `opencvCameraSupport=true`
      and `localOnly=true` from the packaged location.
- [x] Confirmed no `STATUS_DLL_NOT_FOUND` / `0xC0000135` error occurred.
- [x] Confirmed no vcpkg `PATH` requirement exists.
- [x] Confirmed no local OpenCV install dependency exists.
- [x] Confirmed no raw camera frames were printed, written, uploaded, persisted, or
      sent during the capability check.

The VC++ Redistributable version installed in Sandbox was the current Microsoft
Visual C++ Redistributable for Visual Studio 2015–2022 (x64), confirming it
satisfies the runtime requirements for this build.

## 9. Local-first / privacy confirmation

- No raw camera frames were printed, written, uploaded, persisted, or logged by
  any check in this pass. The capability mode opens no camera.
- No global `PATH` was mutated. The process-local environment inside Sandbox was
  restricted to Windows system locations only.
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

1. **Validate without VC++ Redistributable installed:** confirm failure mode and
   error message on a machine where the VC++ Redistributable is absent. This
   informs whether the prerequisite must be bundled in the installer.
2. **Installer build (`build:win`):** `electron-builder --win` (NSIS installer)
   has not been validated. Run in an appropriate environment with code-signing
   configuration when ready.
3. **Finite OpenCV camera smoke from packaged resources:** run
   `--camera-source opencv --frames 3 --log-camera-status` from the packaged
   resources location once a webcam and OS camera permission are available.
4. **OBS Browser Source validation:** out of scope here; remains a separate
   environment-dependent check.
