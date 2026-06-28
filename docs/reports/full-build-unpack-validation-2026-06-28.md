# Full Electron Unpack Build Validation — 2026-06-28

## 1. Summary

This report records the full `pnpm --filter @lvk/desktop build:unpack` validation
pass after the Windows symlink creation privilege was enabled on the local machine,
addressing the `winCodeSign` extraction failure documented in PR #368 and PR #371.

**Key result: `pnpm --filter @lvk/desktop build:unpack` now exits 0 end-to-end.**
The previous `winCodeSign` symlink privilege failure is resolved. The packaged
`win-unpacked/` directory is produced with all 21 manifest DLLs present under
`<resources>/native-runtime/bin/`, and the packaged Native Core starts from that
location without any vcpkg directory on `PATH`.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, Electron packaging configuration,
the manifest, the `MotionFrame` schema, or the Motion Protocol.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/full-build-unpack-after-wincodesign-privilege`
- OpenCV runtime manifest: `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`
- Staged runtime directory (git-ignored): `.lvk-native-runtime/`
- Packaged resources layout: `<resources>/native-runtime/`

## 3. Environment

- OS: Windows 11 Pro (x64)
- Node / pnpm: Node v24.16.0 / pnpm 11.5.0
- electron-builder: 26.8.1
- Electron: 39.8.10
- Native Core configuration tested: Release (x64)
- OpenCV found by CMake: yes (modular vcpkg OpenCV 4)
- LVK OpenCV camera support: ON
- LVK OpenCV face detector support: ON
- OpenCV runtime DLLs source: local vcpkg release bin (`<vcpkg-root>/installed/x64-windows/bin`)
- Windows symlink creation privilege: enabled before this validation pass
- Webcam available: not checked
- OS camera permission granted: not checked
- OBS checked: not checked

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>` and `<resources>`.

## 4. Preconditions

- PR #370 expanded the Windows x64 Release manifest to the verified 21-DLL set.
- PR #371 confirmed staged and packaged Native Core start with no vcpkg `PATH`;
  `build:unpack` remained PARTIAL/BLOCKED due to the `winCodeSign` symlink
  privilege issue.
- PR #372 documented the Windows VC++ Redistributable strategy.
- Windows symlink creation privilege was enabled on this machine before starting
  this validation pass (via Developer Mode or group policy).
- `.lvk-native-runtime/` was already populated with the 21-DLL set and the
  Native Core executable from the prior PR #371 staging pass.

## 5. winCodeSign symlink privilege — resolution

In PR #368 and PR #371, `electron-builder` failed to extract the
`winCodeSign-2.6.0.7z` cache archive because the local process lacked the
Windows "Create Symbolic Links" privilege. The archive includes macOS
cross-signing `.dylib` symlinks which require that privilege to extract on
Windows.

With the Windows symlink creation privilege enabled before this pass:

- `electron-builder` downloaded `winCodeSign-2.6.0.7z` (5.6 MB).
- The archive extracted without a symlink privilege error.
- `electron-builder` proceeded to sign packaged resources using `signtool.exe`.
- `pnpm --filter @lvk/desktop build:unpack` exited **0**.

This is the same environment-level fix identified in the follow-up items of
PR #371. No Electron Builder configuration was changed.

## 6. Staging verification

The `.lvk-native-runtime/` directory was already populated from the PR #371
staging pass. Staging was verified before packaging:

```bash
pnpm prep:native-runtime:verify:local
```

Result: `All 21 required DLL(s) present in destination.`

The staged directory contents (not committed):

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

### 7.2 Full Electron unpack build

```bash
pnpm --filter @lvk/desktop build:unpack
```

| Check                                                                      | Result                       |
| -------------------------------------------------------------------------- | ---------------------------- |
| `pnpm --filter @lvk/desktop build:unpack` exits 0                          | **PASS** — exit 0            |
| Previous `winCodeSign` symlink privilege error resolved                    | **PASS — resolved**          |
| `electron-vite` build produced (`out/main`, `out/preload`, `out/renderer`) | PASS                         |
| `win-unpacked/` produced                                                   | PASS                         |
| `<resources>/native-runtime/` present in unpacked app                      | PASS                         |
| `<resources>/native-runtime/bin/lvk-tracker-core.exe` present              | PASS                         |
| All 21 manifest DLLs present in `<resources>/native-runtime/bin/`          | PASS — all 21 present        |
| `<resources>/native-runtime/manifests/...release.json` present             | PASS                         |
| `winCodeSign-2.6.0.7z` downloaded and extracted without error              | PASS (privilege was enabled) |
| `signtool.exe` signing completed for packaged resources                    | PASS                         |

Unpacked resources `bin/` contents confirmed (21 DLLs + executable):

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

### 7.3 Native Core capability smoke from packaged resources

The run used a process-local `PATH` restricted to Windows System32 only — no
vcpkg directory was included.

```bash
<unpacked-app>/resources/native-runtime/bin/lvk-tracker-core.exe --print-runtime-capabilities
```

| Check                                                                                              | Result                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Native Core starts from `<resources>/native-runtime/bin/` using ONLY adjacent DLLs (no vcpkg PATH) | **PASS** — exit 0                                          |
| `STATUS_DLL_NOT_FOUND` / `0xC0000135` absent                                                       | PASS — no DLL error                                        |
| `--print-runtime-capabilities` output received                                                     | PASS                                                       |
| `opencvCameraSupport=true`                                                                         | PASS                                                       |
| `opencvFaceDetectorSupport=true`                                                                   | PASS                                                       |
| `localOnly=true`                                                                                   | PASS                                                       |
| `cameraOpened=false`, `motionFramesEmitted=false`                                                  | PASS — capability mode opens no camera and emits no frames |
| No raw camera frames printed / written / uploaded / persisted                                      | PASS — output is sanitized key=value text only             |
| vcpkg PATH excluded from process-local environment                                                 | PASS — System32-only PATH used                             |

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

### 7.4 Optional camera smoke

SKIP. The packaged runtime starts independently, but webcam availability and OS
camera permission were not confirmed in this pass. A finite OpenCV camera smoke
remains a separate local/manual check.

### 7.5 OBS / Browser Source validation

SKIP / not performed. Out of scope for this packaged-runtime validation report.

## 8. Comparison with previous passes

| Aspect                                               | PR #368 / #371                        | This pass           |
| ---------------------------------------------------- | ------------------------------------- | ------------------- |
| `build:unpack` exit code                             | non-zero                              | **0 — resolved**    |
| `winCodeSign` symlink privilege error                | **BLOCKED** — privilege missing       | **PASS — resolved** |
| `win-unpacked/` produced                             | PASS (partial)                        | PASS                |
| All 21 manifest DLLs in `<resources>/native-runtime` | PASS (PR #371 with expanded manifest) | PASS                |
| Native Core from packaged resources (no vcpkg PATH)  | PASS (PR #371)                        | PASS                |
| `build:unpack` end-to-end                            | PARTIAL/BLOCKED                       | **PASS**            |

## 9. PASS / FAIL / SKIP roll-up

- `pnpm format:check`: PASS
- `pnpm test:copy-opencv-runtime-dlls` (68 cases): PASS
- Manifest DLL staging verification (21 DLLs): PASS
- `.lvk-native-runtime/` not committed: PASS
- `pnpm --filter @lvk/desktop build:unpack` exit 0: **PASS**
- `winCodeSign` symlink privilege issue resolved: **PASS — resolved**
- `win-unpacked/` produced: PASS
- `<resources>/native-runtime/bin/` with all 21 DLLs: PASS
- `<resources>/native-runtime/manifests/` with release manifest: PASS
- Packaged resources Native Core launch (adjacent-DLL independence, no vcpkg PATH): PASS
- `opencvCameraSupport=true` from packaged location: PASS
- `localOnly=true` from packaged location: PASS
- Global vcpkg `PATH` independence on this development machine: PASS
- Clean-machine VC++ redistributable independence: **not proven** — see section 10
- Camera smoke: SKIP
- OBS / Browser Source: SKIP

## 10. Limitations / honesty notes

- This proves vcpkg-`PATH` independence on a development machine that already
  provides the Windows platform DLLs and the VC++ runtime redistributable
  (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `CONCRT140.dll`).
  It does **not** prove clean-machine independence. A machine without the VC++
  redistributable preinstalled may still fail to start the packaged Native Core.
  That remains a separate packaging decision. See
  [`docs/WINDOWS_VC_REDIST_STRATEGY.md`](../WINDOWS_VC_REDIST_STRATEGY.md).
- The Windows symlink creation privilege was enabled at the OS level before this
  pass. This is an environment-level precondition, not a code change. Production
  packaging (installer builds, CI) will need this privilege or an equivalent
  approach confirmed for those environments.
- The static import closure was verified via `dumpbin /dependents` (PR #369) and
  the capability run exercises startup only, not a live camera or codec path.
  Delay-loaded or `LoadLibrary`-resolved backends are not covered.
- `build:win` (NSIS installer) was not run. This validation covers `--dir`
  (unpacked) only.
- Camera smoke and OBS Browser Source validation remain separate
  environment-dependent local/manual checks.

## 11. Local-first / privacy confirmation

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
- No Native Core C++, CMake behavior, Electron runtime code, Electron packaging
  config, `MotionFrame` schema, Motion Protocol, or Web Preview behavior was
  changed.

## 12. Follow-up items

1. **Clean-machine VC++ redistributable validation:** validate on a clean machine
   without the VC++ redistributable preinstalled once the installer strategy is
   decided. See [`docs/WINDOWS_VC_REDIST_STRATEGY.md`](../WINDOWS_VC_REDIST_STRATEGY.md)
   for the checklist.
2. **Installer build (`build:win`):** `electron-builder --win` (NSIS installer)
   has not been validated. Run in an environment with appropriate code-signing
   configuration when ready.
3. **Finite OpenCV camera smoke:** run
   `--camera-source opencv --frames 3 --log-camera-status` from the packaged
   resources location once a webcam and OS camera permission are available.
4. **OBS Browser Source validation:** out of scope here; remains a separate
   environment-dependent check.
5. **CI packaging environment:** confirm whether the CI runner has the Windows
   symlink creation privilege or Developer Mode enabled if `build:unpack` is
   added to CI in the future.
