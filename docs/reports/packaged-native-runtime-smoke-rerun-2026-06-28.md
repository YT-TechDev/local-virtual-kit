# Packaged Native Runtime Smoke Rerun Report — 2026-06-28

## 1. Summary

This report records a rerun of the local packaged/staged Native Core runtime smoke
after the Windows x64 Release OpenCV runtime manifest was expanded to the full
verified transitive DLL set in PR #370.

**Key result: the previous `STATUS_DLL_NOT_FOUND` / `0xC0000135` failure from
PR #368 is resolved.** With the expanded 21-DLL manifest, both the staged
(`.lvk-native-runtime/bin/`) and the unpacked packaged
(`<resources>/native-runtime/bin/`) Native Core executables start independently
from the app-owned runtime directory without any vcpkg directory on `PATH`,
printing correct runtime capabilities and exiting cleanly.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, the manifest, the `MotionFrame`
schema, or the Motion Protocol.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/packaged-native-runtime-smoke-rerun-expanded-manifest`
- OpenCV runtime manifest: `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`
- Staged runtime directory (git-ignored): `.lvk-native-runtime/`
- Packaged resources expected layout: `<resources>/native-runtime/`

## 3. Environment

- OS: Windows 11 Pro (x64)
- Node / pnpm: Node v24.16.0 / pnpm 11.5.0
- Native Core configuration tested: Release (x64)
- OpenCV found by CMake: yes (modular vcpkg OpenCV 4)
- LVK OpenCV camera support: ON
- LVK OpenCV face detector support: ON
- OpenCV runtime DLLs source: local vcpkg release bin (`<vcpkg-root>/installed/x64-windows/bin`)
- Webcam available: not checked
- OS camera permission granted: not checked
- OBS checked: not checked

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>` and `<resources>`.

## 4. Manifest contents under test

The expanded `windows-x64-release` manifest (`opencv-runtime-windows-x64-release.json`)
now lists 21 DLLs — the full verified static transitive runtime set from the
2026-06-27 dependency inspection report (PR #369):

**4 direct OpenCV modules:**

- `opencv_core4.dll`
- `opencv_imgproc4.dll`
- `opencv_videoio4.dll`
- `opencv_objdetect4.dll`

**5 additional OpenCV transitive modules:**

- `opencv_imgcodecs4.dll`
- `opencv_dnn4.dll`
- `opencv_calib3d4.dll`
- `opencv_features2d4.dll`
- `opencv_flann4.dll`

**12 non-OpenCV vcpkg runtime DLLs:**

- `z.dll`, `jpeg62.dll`, `libpng16.dll`, `tiff.dll`, `liblzma.dll`
- `libwebp.dll`, `libwebpdecoder.dll`, `libwebpdemux.dll`, `libwebpmux.dll`, `libsharpyuv.dll`
- `libprotobuf.dll`, `abseil_dll.dll`

## 5. Comparison with PR #368

| Aspect                              | PR #368 (4-DLL manifest)                         | This rerun (21-DLL manifest)            |
| ----------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Manifest DLL count                  | 4                                                | 21                                      |
| Staged startup without vcpkg PATH   | **FAIL** — `STATUS_DLL_NOT_FOUND` / `0xC0000135` | **PASS** — exit 0, capabilities printed |
| Packaged startup without vcpkg PATH | **FAIL** — `STATUS_DLL_NOT_FOUND` / `0xC0000135` | **PASS** — exit 0, capabilities printed |
| `opencvCameraSupport=true`          | PASS (only with vcpkg PATH)                      | PASS (no vcpkg PATH required)           |
| `opencvFaceDetectorSupport=true`    | PASS (only with vcpkg PATH)                      | PASS (no vcpkg PATH required)           |
| `localOnly=true`                    | PASS (only with vcpkg PATH)                      | PASS (no vcpkg PATH required)           |
| `cameraOpened=false`                | PASS                                             | PASS                                    |
| `motionFramesEmitted=false`         | PASS                                             | PASS                                    |

## 6. Staging preparation

The git-ignored `.lvk-native-runtime/` directory was populated locally with the
expanded manifest DLL set:

```bash
pnpm copy:opencv-runtime-dlls:local -- \
  --manifest native/tracker-core/manifests/opencv-runtime-windows-x64-release.json \
  --source-dir <vcpkg-root>/installed/x64-windows/bin \
  --dest-dir .lvk-native-runtime/bin

pnpm prep:native-runtime:verify:local
```

The `copy:opencv-runtime-dlls:local` run reported: `Done. 21 DLL(s) copied.`

The `prep:native-runtime:verify:local` verification reported:
`All 21 required DLL(s) present in destination.`

Resulting staged layout (contents are local-only and were NOT committed):

```txt
.lvk-native-runtime/
  bin/
    lvk-tracker-core.exe
    opencv_core4.dll
    opencv_imgproc4.dll
    opencv_videoio4.dll
    opencv_objdetect4.dll
    opencv_imgcodecs4.dll
    opencv_dnn4.dll
    opencv_calib3d4.dll
    opencv_features2d4.dll
    opencv_flann4.dll
    z.dll
    jpeg62.dll
    libpng16.dll
    tiff.dll
    liblzma.dll
    libwebp.dll
    libwebpdecoder.dll
    libwebpdemux.dll
    libwebpmux.dll
    libsharpyuv.dll
    libprotobuf.dll
    abseil_dll.dll
  manifests/
    opencv-runtime-windows-x64-release.json
```

## 7. Checks and results

### 7.1 Repository / staging checks

| Check                                                 | Command                                 | Result                              |
| ----------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| Formatting                                            | `pnpm format:check`                     | PASS                                |
| Manifest-aware helper self-test (68 cases)            | `pnpm test:copy-opencv-runtime-dlls`    | PASS — 68 passed, 0 failed          |
| Manifest DLL staging verification (dest = staged bin) | `pnpm prep:native-runtime:verify:local` | PASS — all 21 manifest DLLs present |
| `.lvk-native-runtime/` not committed (git-ignored)    | `git status`                            | PASS — not tracked                  |

### 7.2 Staged native runtime smoke

The staged `bin/` contains the exe and all 21 manifest DLLs. The run used a
process-local `PATH` restricted to Windows System32 only — no vcpkg directory
was included.

| Check                                                                       | Result                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| All 21 manifest DLLs present adjacent to executable                         | PASS                                                       |
| Native Core starts from staged dir using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — exit 0                                          |
| `STATUS_DLL_NOT_FOUND` / `0xC0000135` from PR #368 resolved                 | **PASS — resolved**                                        |
| `--print-runtime-capabilities` output received                              | PASS                                                       |
| `opencvCameraSupport=true`                                                  | PASS                                                       |
| `opencvFaceDetectorSupport=true`                                            | PASS                                                       |
| `localOnly=true`                                                            | PASS                                                       |
| `cameraOpened=false`, `motionFramesEmitted=false`                           | PASS — capability mode opens no camera and emits no frames |
| No raw camera frames printed / written / uploaded / persisted               | PASS — capability output is sanitized key=value text only  |

Capability output observed (no vcpkg PATH, staged runtime location):

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

### 7.3 Unpacked Electron resources verification

`pnpm --filter @lvk/desktop build:unpack` was run. The overall command exited
non-zero for the same reason as in PR #368: `electron-builder` failed while
extracting the `winCodeSign` cache because the local process lacked the Windows
"create symbolic link" privilege (cannot create macOS cross-signing `.dylib`
symlinks). This is the same `winCodeSign` symlink privilege issue documented in
PR #368 and is unrelated to LVK packaging configuration.

Despite that failure, `electron-builder` again produced the `win-unpacked/`
directory and the `extraResources` wiring correctly copied the expanded
`.lvk-native-runtime/` into `<resources>/native-runtime/` with the expected
layout.

| Check                                                                      | Result                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @lvk/desktop build:unpack` completed end to end             | **PARTIAL/BLOCKED** — winCodeSign symlink privilege (same as PR #368) |
| `electron-vite` build (`out/main`, `out/preload`, `out/renderer`) produced | PASS                                                                  |
| Unpacked app directory produced (`win-unpacked/`)                          | PASS                                                                  |
| `<resources>/native-runtime/` present in unpacked app                      | PASS                                                                  |
| `<resources>/native-runtime/bin/lvk-tracker-core.exe` present              | PASS                                                                  |
| All 21 manifest DLLs present in `<resources>/native-runtime/bin/`          | PASS — all 21 present                                                 |
| `<resources>/native-runtime/manifests/...release.json` present             | PASS                                                                  |

### 7.4 Packaged resources Native Core launch

The run used a process-local `PATH` restricted to Windows System32 only — no
vcpkg directory was included.

| Check                                                                                              | Result                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Native Core starts from `<resources>/native-runtime/bin/` using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — exit 0                                          |
| `STATUS_DLL_NOT_FOUND` / `0xC0000135` from PR #368 resolved in packaged location                   | **PASS — resolved**                                        |
| `--print-runtime-capabilities` from packaged location                                              | PASS                                                       |
| `opencvCameraSupport=true`                                                                         | PASS                                                       |
| `opencvFaceDetectorSupport=true`                                                                   | PASS                                                       |
| `localOnly=true`                                                                                   | PASS                                                       |
| `cameraOpened=false`, `motionFramesEmitted=false`                                                  | PASS — capability mode opens no camera and emits no frames |
| Packaged-runtime DLL independence from global vcpkg `PATH`                                         | PASS on this development machine                           |

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

### 7.5 Optional camera smoke

SKIP. The staged/packaged runtime starts independently, but webcam availability
and OS camera permission were not confirmed in this pass. A finite OpenCV camera
smoke remains a separate local/manual check.

### 7.6 OBS / Browser Source validation

SKIP / not performed. Out of scope for this packaged-runtime smoke report.

## 8. PASS / FAIL / SKIP roll-up

- `pnpm format:check`: PASS
- `pnpm test:copy-opencv-runtime-dlls` (68 cases): PASS
- Manifest DLL staging verification (21 DLLs): PASS
- `.lvk-native-runtime/` not committed: PASS
- Staged native runtime smoke (adjacent-DLL independence, no vcpkg PATH): **PASS**
- `STATUS_DLL_NOT_FOUND` / `0xC0000135` from PR #368 resolved (staged): **PASS**
- Staged native runtime capability output (`localOnly=true`, no frames): PASS
- Unpacked Electron `resources/native-runtime/` placement (all 21 DLLs): PASS
- Full `build:unpack` (installer/signing): PARTIAL/BLOCKED (winCodeSign symlink privilege — same as PR #368)
- Packaged resources Native Core launch (adjacent-DLL independence, no vcpkg PATH): **PASS**
- `STATUS_DLL_NOT_FOUND` / `0xC0000135` from PR #368 resolved (packaged): **PASS**
- Global vcpkg `PATH` independence on this development machine: **PASS**
- Clean-machine VC++ redistributable independence: **not proven** — see section 9
- Camera smoke: SKIP
- OBS / Browser Source: SKIP

## 9. Limitations / honesty notes

- This proves vcpkg-`PATH` independence on a development machine that already
  provides the Windows platform DLLs and the VC++ runtime redistributable
  (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `CONCRT140.dll`).
  It does **not** prove clean-machine independence. A machine without the
  VC++ redistributable preinstalled may still fail to start the packaged Native
  Core. That remains a separate packaging decision.
- The static import closure was verified via `dumpbin /dependents` (PR #369) and
  the capability run exercises startup only, not a live camera or codec path.
  Delay-loaded or `LoadLibrary`-resolved backends are not covered.
- The `winCodeSign` symlink privilege issue prevents end-to-end installer
  packaging in this environment. Resource placement and runtime startup are
  confirmed via the `win-unpacked/` output.

## 10. Local-first / privacy confirmation

- No raw camera frames were printed, written, uploaded, persisted, or logged by
  any check in this pass. The capability mode opens no camera.
- No global `PATH` was mutated. The only `PATH` used for runtime checks was
  process-local to each command invocation and excluded the vcpkg directory.
- No runtime download of OpenCV or native dependencies was introduced.
- No telemetry, analytics, cloud upload, external frame processing, hidden
  network calls, or new network behavior was introduced.
- No actual DLLs, Native Core binaries, build artifacts, generated package
  outputs, `.lvk-native-runtime/` contents, raw logs, screenshots, raw camera
  frames, or local absolute paths were committed.
- No global PATH was mutated. No Native Core C++, CMake behavior, Electron
  runtime code, Electron packaging config, `MotionFrame` schema, Motion
  Protocol, or Web Preview behavior was changed.

## 11. Follow-up items

1. **VC++ redistributable strategy:** decide whether to depend on the Microsoft
   Visual C++ Redistributable installer or place the VC++ runtime DLLs
   app-locally. Validate on a clean machine without the redistributable
   preinstalled once that decision is made.
2. **Resolve `winCodeSign` symlink privilege:** run `build:unpack` in an
   environment with the "create symbolic link" privilege enabled, or investigate
   whether a Developer Mode or group policy change resolves it. Full
   installer/signing packaging cannot be validated without this.
3. **Finite OpenCV camera smoke:** run
   `--camera-source opencv --frames 3 --log-camera-status` from the packaged
   resources location once a webcam and OS camera permission are available.
4. **OBS Browser Source validation:** out of scope here; remains a separate
   environment-dependent check.
