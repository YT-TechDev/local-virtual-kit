# Packaged Native Runtime Smoke Report — 2026-06-27

## 1. Summary

This report records a local packaged/staged Native Core runtime smoke verification run after
the OpenCV runtime manifest (`opencv-runtime-windows-x64-release.json`) and the
Electron packaging resource wiring (`extraResources` → `native-runtime/`) were
added in the staged packaging plan (PRs #363–#367).

Key result: the **Electron packaging wiring works** — the unpacked app placed the
staged native runtime into `<resources>/native-runtime/` with the expected
`bin/` and `manifests/` layout. However, the **packaged/staged Native Core
executable does NOT start independently** from the app-owned runtime directory.
It fails with `STATUS_DLL_NOT_FOUND` / `0xC0000135` unless the developer's vcpkg
OpenCV release `bin` directory is reachable via a process-local `PATH`.

Root cause: the current `windows-x64-release` manifest lists only the four direct
OpenCV modules. Those modules have **uncovered transitive dependencies** (further
OpenCV modules plus non-OpenCV runtime libraries) that are not yet staged. The
packaged-runtime DLL-independence acceptance criterion is therefore **not met**
and packaged runtime smoke is **not** claimed as passing.

This report is documentation-only. It does not change runtime behavior, Native
Core C++, CMake behavior, Electron runtime code, the manifest, the `MotionFrame`
schema, or the Motion Protocol.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/packaged-native-runtime-smoke-report`
- OpenCV runtime manifest: `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`
- Staged runtime directory (git-ignored): `.lvk-native-runtime/`
- Packaged resources expected layout: `<resources>/native-runtime/`

## 3. Environment

- OS: Windows 11 Pro (x64)
- Node / pnpm: Node v24.16.0 / pnpm 11.5.0
- CMake: 4.3.3
- Native Core configuration tested: Release (x64)
- OpenCV found by CMake: yes (modular vcpkg OpenCV 4 build)
- LVK OpenCV camera support: ON (`core` + `videoio`)
- LVK OpenCV face detector support: ON (`core` + `imgproc` + `objdetect`)
- OpenCV runtime DLLs source: local vcpkg release bin (`<vcpkg-root>/installed/x64-windows/bin`)
- Webcam available: not checked
- OS camera permission granted: not checked
- OBS checked: not checked

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>` and `<resources>`.

## 4. Manifest contents under test

The `windows-x64-release` manifest lists four direct OpenCV release modules:

- `opencv_core4.dll`
- `opencv_imgproc4.dll`
- `opencv_videoio4.dll`
- `opencv_objdetect4.dll`

## 5. Staging preparation

The git-ignored `.lvk-native-runtime/` directory was populated locally:

- `bin/` was populated with the four manifest-listed OpenCV release DLLs using
  the manifest-aware helper, copied from the local vcpkg release bin.
- The OpenCV-enabled Native Core Release executable was rebuilt and copied into
  `bin/` (the previously built binary predated `--print-runtime-capabilities`
  and had to be rebuilt to expose the capability flag).
- `manifests/` was populated locally with a copy of the release manifest so the
  packaged layout could be exercised end to end.

Staging commands (placeholders for local absolute paths):

```bash
pnpm copy:opencv-runtime-dlls:local -- \
  --manifest native/tracker-core/manifests/opencv-runtime-windows-x64-release.json \
  --source-dir <vcpkg-root>/installed/x64-windows/bin \
  --dest-dir .lvk-native-runtime/bin

pnpm prep:native-runtime:verify:local
```

Resulting staged layout (contents are local-only and were NOT committed):

```txt
.lvk-native-runtime/
  bin/
    lvk-tracker-core.exe
    opencv_core4.dll
    opencv_imgproc4.dll
    opencv_videoio4.dll
    opencv_objdetect4.dll
  manifests/
    opencv-runtime-windows-x64-release.json
```

## 6. Checks and results

### 6.1 Repository / staging checks

| Check                                                 | Command                                 | Result                             |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| Formatting                                            | `pnpm format:check`                     | PASS                               |
| Manifest-aware helper self-test (41 cases)            | `pnpm test:copy-opencv-runtime-dlls`    | PASS                               |
| Manifest DLL staging verification (dest = staged bin) | `pnpm prep:native-runtime:verify:local` | PASS — all 4 manifest DLLs present |

### 6.2 Staged native runtime smoke

| Check                                                                             | Result                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Manifest-listed OpenCV DLLs present adjacent to executable                        | PASS                                                       |
| Native Core starts from staged dir using ONLY adjacent DLLs (no vcpkg PATH)       | **FAIL** — exits `0xC0000135` / `STATUS_DLL_NOT_FOUND`     |
| Native Core starts from staged dir WITH vcpkg release bin on a process-local PATH | PASS                                                       |
| `--print-runtime-capabilities` output when it runs                                | PASS                                                       |
| `opencvCameraSupport=true`                                                        | PASS (only when it runs)                                   |
| `opencvFaceDetectorSupport=true`                                                  | PASS (only when it runs)                                   |
| `localOnly=true`                                                                  | PASS (only when it runs)                                   |
| `cameraOpened=false`, `motionFramesEmitted=false`                                 | PASS — capability mode opens no camera and emits no frames |
| No raw camera frames printed / written / uploaded / persisted                     | PASS — capability output is sanitized key=value text only  |

Sanitized capability output observed (when run with the vcpkg release bin
reachable via a process-local `PATH`):

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

### 6.3 Unpacked Electron resources verification

| Check                                                                      | Result                         |
| -------------------------------------------------------------------------- | ------------------------------ |
| `pnpm --filter @lvk/desktop build:unpack` completed end to end             | **PARTIAL/BLOCKED** — see note |
| `electron-vite` build (`out/main`, `out/preload`, `out/renderer`) produced | PASS                           |
| Unpacked app directory produced (`win-unpacked/`)                          | PASS                           |
| `<resources>/native-runtime/` present in unpacked app                      | PASS                           |
| `<resources>/native-runtime/bin/lvk-tracker-core.exe` present              | PASS                           |
| `<resources>/native-runtime/bin/<manifest OpenCV DLLs>` present            | PASS — all 4 present           |
| `<resources>/native-runtime/manifests/...release.json` present             | PASS                           |

Note on PARTIAL/BLOCKED: the overall `build:unpack` command exited non-zero, but
**not** because of LVK packaging configuration. `electron-builder` failed while
extracting its `winCodeSign` cache: the bundled 7-Zip step could not create the
macOS cross-signing `.dylib` symbolic links because the local process lacked the
Windows "create symbolic link" privilege. Despite that signing-tool failure,
`electron-builder` still produced the `win-unpacked/` directory, and the
`extraResources` wiring correctly copied the staged `.lvk-native-runtime/` into
`<resources>/native-runtime/` with the expected `bin/` and `manifests/` layout.
The resource-placement wiring is therefore confirmed working; full installer/
signing packaging could not be completed in this environment.

### 6.4 Packaged resources Native Core launch

| Check                                                                                              | Result                                                          |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Native Core starts from `<resources>/native-runtime/bin/` using ONLY adjacent DLLs (no vcpkg PATH) | **FAIL** — exits `0xC0000135` / `STATUS_DLL_NOT_FOUND`          |
| Native Core starts from packaged resources WITH vcpkg release bin on a process-local PATH          | PASS                                                            |
| Packaged-runtime DLL independence from global vcpkg `PATH`                                         | **FAIL** — only works when vcpkg release bin is reachable       |
| `--print-runtime-capabilities` from packaged location                                              | PASS only when vcpkg bin reachable; `localOnly=true`, no frames |

The packaged binary behaves identically to the staged binary: it cannot resolve
its DLL dependencies from the four adjacent OpenCV modules alone.

### 6.5 Optional camera smoke

SKIP. The packaged/staged binary cannot start independently from the app-owned
runtime directory, webcam availability and OS camera permission were not
confirmed, and a finite OpenCV camera smoke is intentionally not claimed here.
Camera smoke remains a separate local/manual check.

### 6.6 OBS / Browser Source validation

SKIP / not performed. Out of scope for this packaged-runtime smoke report.

## 7. Transitive dependency findings

A local dependency inspection of the staged OpenCV DLLs and the Native Core
executable showed that the four manifest modules pull in dependencies that are
**not** present in the staged/packaged `bin/` directory. Only sanitized DLL
filenames are recorded below (no local absolute paths):

- `opencv_core4.dll` → `z.dll` (zlib runtime; not staged)
- `opencv_videoio4.dll` → `opencv_imgcodecs4.dll` (OpenCV module not in the manifest;
  `imgcodecs` additionally pulls image codec backend libraries)
- `opencv_objdetect4.dll` → `opencv_dnn4.dll`, `opencv_calib3d4.dll`,
  `opencv_features2d4.dll`, `opencv_flann4.dll` (OpenCV modules not in the manifest)

Separately, the executable and OpenCV DLLs reference standard Windows/MSVC
runtime components (for example `KERNEL32.dll`, `MSVCP140.dll`,
`VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `CONCRT140.dll`, Media Foundation
`MFPlat.DLL` / `MF.dll` / `MFReadWrite.dll`, and `api-ms-win-crt-*`). These are
Windows platform / Visual C++ redistributable concerns and are handled
separately from the OpenCV runtime manifest.

Per the staged packaging policy, this report does **not**:

- commit any DLLs,
- broaden the manifest, or
- claim packaged runtime smoke passed.

These transitive dependencies must be verified by a dedicated follow-up
dependency-inspection step before packaged runtime startup independence can be
claimed.

## 8. PASS / FAIL / SKIP roll-up

- Manifest staging verification: PASS
- Staged native runtime smoke (adjacent-DLL independence): **FAIL** (transitive deps)
- Staged native runtime capability output (with vcpkg bin reachable): PASS, `localOnly=true`, no frames
- Unpacked Electron `resources/native-runtime/` placement: PASS
- Full `build:unpack` (installer/signing): PARTIAL/BLOCKED (winCodeSign symlink privilege)
- Packaged resources Native Core launch (adjacent-DLL independence): **FAIL** (transitive deps)
- Global vcpkg `PATH` independence: **FAIL / not achieved**
- Camera smoke: SKIP
- OBS / Browser Source: SKIP

## 9. Local-first / privacy confirmation

- No raw camera frames were printed, written, uploaded, persisted, or logged by
  any check in this pass. The capability mode opens no camera.
- No global `PATH` was mutated. The only `PATH` change used for the
  with-dependencies run was process-local to a single command invocation.
- No runtime download of OpenCV or native dependencies was introduced.
- No telemetry, analytics, cloud upload, external frame processing, hidden
  network calls, or new network behavior was introduced.

## 10. Follow-up items

1. **Dependency-inspection PR (highest priority):** enumerate and verify the full
   transitive runtime dependency set for the OpenCV-enabled Native Core release
   build (the additional OpenCV modules and the non-OpenCV runtime libraries
   noted in section 7), then decide — within redistribution policy — which files
   the packaged runtime must include so the binary starts from the app-owned
   directory without a global vcpkg `PATH`. Only after that should the manifest
   be expanded.
2. Re-run this packaged runtime smoke after the dependency set is resolved and
   confirm adjacent-DLL independence from the packaged `resources/native-runtime/`
   location.
3. Investigate the `electron-builder` `winCodeSign` symbolic-link privilege issue
   (or run packaging in an environment with the required privilege) so full
   installer packaging can be validated.
4. Run the optional finite OpenCV camera smoke once the packaged runtime starts
   independently and a webcam plus OS camera permission are available.
