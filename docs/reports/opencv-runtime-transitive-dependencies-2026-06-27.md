# OpenCV Runtime Transitive Dependency Report — 2026-06-27

## 1. Summary

This report records a local dependency inspection of the Windows x64 **Release**
OpenCV-enabled Native Core runtime. It follows the 2026-06-27 packaged/staged
native runtime smoke
([`packaged-native-runtime-smoke-2026-06-27.md`](./packaged-native-runtime-smoke-2026-06-27.md)),
which found that the staged/packaged Native Core executable does **not** start
independently from the app-owned runtime directory using only the four direct
OpenCV manifest DLLs and fails with `STATUS_DLL_NOT_FOUND` / `0xC0000135`.

The goal here is to enumerate and **verify** the full transitive runtime
dependency set the app-owned runtime directory needs for the OpenCV-enabled
Native Core Release build to start without a global/process-local vcpkg `PATH`,
and to classify those dependencies for a future manifest/helper/policy PR.

Key results:

- The four manifest DLLs pull in **5 additional OpenCV modules** and **12
  non-OpenCV vcpkg runtime DLLs** through their static import tables.
- A local experiment confirmed that copying those **17** transitive DLLs next to
  the executable (in addition to the 4 manifest DLLs) lets Native Core start and
  print runtime capabilities with **no vcpkg directory on `PATH`** on this
  development machine.
- Remaining concern: the Visual C++ runtime redistributable DLLs
  (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `CONCRT140.dll`)
  and Windows platform DLLs were satisfied by the OS / installed redistributable
  on this machine. Clean-machine independence (a machine without the VC++
  redistributable) was **not** proven here and remains a separate packaging
  decision.

This report is documentation-only. It does **not** broaden the authoritative
manifest, commit any DLLs/binaries, change Native Core C++, CMake behavior,
Electron runtime code, Electron packaging config, the `MotionFrame` schema, or
the Motion Protocol.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `test/opencv-runtime-transitive-dependency-report`
- Native Core build configuration inspected: Windows x64 **Release**
- OpenCV distribution observed: modular vcpkg OpenCV 4
- Current manifest path: `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`
- Staged runtime directory (git-ignored): `.lvk-native-runtime/`

## 3. Environment

- OS: Windows 11 Pro (x64)
- Node / pnpm: Node v24.16.0 / pnpm 11.5.0
- Native Core configuration inspected: Release (x64)
- OpenCV runtime DLL source: local vcpkg release bin (placeholder
  `<vcpkg-root>/installed/x64-windows/bin`)
- Dependency inspection tool: MSVC `dumpbin /dependents` (Visual Studio 2022
  Build Tools, Hostx64/x64)
- vcpkg release bin on global `PATH` during inspection/experiment: **no**

Local absolute paths are intentionally represented with placeholders such as
`<vcpkg-root>`. Only sanitized DLL filenames are recorded below.

## 4. Current direct manifest DLLs

The `windows-x64-release` manifest currently lists four direct OpenCV release
modules:

- `opencv_core4.dll`
- `opencv_imgproc4.dll`
- `opencv_videoio4.dll`
- `opencv_objdetect4.dll`

These match the CMake-declared OpenCV usage in
`native/tracker-core/CMakeLists.txt` (camera: `core` + `videoio`; face detector:
`core` + `imgproc` + `objdetect`).

## 5. Inspection method

- Ran `dumpbin /dependents` on the staged executable and each staged manifest
  DLL in `.lvk-native-runtime/bin/`.
- Recursively ran `dumpbin /dependents` on every additional OpenCV module and
  non-OpenCV runtime DLL discovered, sourcing the not-yet-staged DLLs from the
  local vcpkg release bin, until the non-system dependency graph closed.
- `dumpbin /dependents` lists the static (load-time) import table. DLLs in the
  static import closure of an eagerly loaded module are required for the process
  to start. Delay-loaded or `LoadLibrary`-resolved backends are not listed by
  this method and are noted as a limitation in section 10.
- Classified each name as: additional OpenCV module, non-OpenCV vcpkg runtime
  DLL, Windows platform DLL, or Visual C++ runtime redistributable DLL.

## 6. Dependency graph summary

Direct import edges observed (OpenCV and non-OpenCV runtime DLLs only; Windows
platform and VC++ runtime DLLs are summarized separately in sections 8–9):

- `lvk-tracker-core.exe` → `opencv_core4`, `opencv_imgproc4`, `opencv_videoio4`,
  `opencv_objdetect4`
- `opencv_core4` → `z`
- `opencv_imgproc4` → `opencv_core4`
- `opencv_videoio4` → `opencv_imgcodecs4`, `opencv_imgproc4`, `opencv_core4`
  (plus Windows Media Foundation / DXGI / D3D11 platform DLLs — see section 8)
- `opencv_objdetect4` → `opencv_dnn4`, `opencv_calib3d4`, `opencv_features2d4`,
  `opencv_flann4`, `opencv_imgproc4`, `opencv_core4`
- `opencv_imgcodecs4` → `opencv_imgproc4`, `opencv_core4`, `jpeg62`,
  `libwebpdecoder`, `libwebp`, `libwebpdemux`, `libwebpmux`, `libpng16`, `z`,
  `tiff`
- `opencv_dnn4` → `opencv_imgproc4`, `opencv_core4`, `libprotobuf`, `abseil_dll`
- `opencv_calib3d4` → `opencv_features2d4`, `opencv_flann4`, `opencv_imgproc4`,
  `opencv_core4`
- `opencv_features2d4` → `opencv_flann4`, `opencv_imgproc4`, `opencv_core4`
- `opencv_flann4` → `opencv_core4`
- `libwebp` → `libsharpyuv`
- `libwebpdemux` → `libwebp`
- `libwebpmux` → `libwebp`
- `libpng16` → `z`
- `tiff` → `z`, `jpeg62`, `liblzma`
- `libprotobuf` → `abseil_dll`
- `z`, `jpeg62`, `libwebpdecoder`, `libsharpyuv`, `liblzma`, `abseil_dll` →
  Windows platform / VC++ runtime DLLs only (no further OpenCV or vcpkg
  third-party edges)

## 7. Missing from `.lvk-native-runtime/bin` (transitive, app-owned candidates)

These DLLs are in the static import closure but are **not** present in the staged
`bin/` directory (which holds only the 4 manifest DLLs plus the executable).

### A. Additional OpenCV modules (5)

| filename                 | pulled in by        |
| ------------------------ | ------------------- |
| `opencv_imgcodecs4.dll`  | `opencv_videoio4`   |
| `opencv_dnn4.dll`        | `opencv_objdetect4` |
| `opencv_calib3d4.dll`    | `opencv_objdetect4` |
| `opencv_features2d4.dll` | `opencv_objdetect4` |
| `opencv_flann4.dll`      | `opencv_objdetect4` |

### B. Non-OpenCV vcpkg runtime DLLs (12)

| filename             | role / pulled in by                                           |
| -------------------- | ------------------------------------------------------------- |
| `z.dll`              | zlib; `opencv_core4`, `opencv_imgcodecs4`, `libpng16`, `tiff` |
| `jpeg62.dll`         | libjpeg-turbo; `opencv_imgcodecs4`, `tiff`                    |
| `libpng16.dll`       | PNG codec; `opencv_imgcodecs4`                                |
| `tiff.dll`           | TIFF codec; `opencv_imgcodecs4`                               |
| `liblzma.dll`        | LZMA; `tiff`                                                  |
| `libwebp.dll`        | WebP; `opencv_imgcodecs4`                                     |
| `libwebpdecoder.dll` | WebP; `opencv_imgcodecs4`                                     |
| `libwebpdemux.dll`   | WebP; `opencv_imgcodecs4`                                     |
| `libwebpmux.dll`     | WebP; `opencv_imgcodecs4`                                     |
| `libsharpyuv.dll`    | WebP color; `libwebp`                                         |
| `libprotobuf.dll`    | DNN model parsing; `opencv_dnn4`                              |
| `abseil_dll.dll`     | Abseil; `opencv_dnn4`, `libprotobuf`                          |

## 8. Windows platform DLLs (must NOT be bundled)

These resolve from the OS and are platform-provided. They must **not** be staged
or bundled:

- `KERNEL32.dll`, `ole32.dll`, `OLEAUT32.dll`, `SHLWAPI.dll`
- `dxgi.dll`, `d3d11.dll`
- Media Foundation (the `videoio` backend used by this vcpkg build):
  `MFPlat.DLL`, `MF.dll`, `MFReadWrite.dll`
- Universal CRT forwarders: `api-ms-win-crt-*.dll` (platform-provided on
  Windows 10/11)

Note: this vcpkg `videoio` build statically imports the **Windows Media
Foundation** stack, not an ffmpeg backend. No `opencv_videoio_ffmpeg*.dll` or
ffmpeg runtime DLL appeared in the static import tables inspected. An ffmpeg
backend, if present in another build, would typically be loaded dynamically at
runtime and would not appear in `dumpbin /dependents` output — see section 10.

## 9. Visual C++ runtime redistributable DLLs (separate decision)

These are Visual C++ runtime redistributable components, distinct from the OpenCV
runtime manifest:

- `MSVCP140.dll`
- `VCRUNTIME140.dll`
- `VCRUNTIME140_1.dll`
- `CONCRT140.dll`

On this development machine they resolved from the OS / installed VC++
redistributable, so the independence experiment did not need to stage them. On a
clean end-user machine without the redistributable, these would be missing. The
options — depend on the Microsoft Visual C++ Redistributable installer vs.
app-local placement of the VS redistributable DLLs — are a separate redistribution
and packaging decision and are intentionally **not** resolved in this report.

## 10. Independence experiment

- Created an isolated local test directory (outside the repository, not
  committed) containing the Release executable and the four manifest DLLs.
- **Baseline** (4 manifest DLLs only, process-local `PATH` = System32 only, no
  vcpkg): Native Core exits `0xC0000135` / `STATUS_DLL_NOT_FOUND`. This
  reproduces the PR #368 packaged/staged smoke failure with vcpkg off `PATH`.
- **With candidates** (4 manifest DLLs + the 17 transitive DLLs from section 7,
  same System32-only process-local `PATH`, no vcpkg): Native Core starts and
  prints runtime capabilities, exit `0`:

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

- The capability mode opened no camera and emitted no frames (`cameraOpened=false`,
  `motionFramesEmitted=false`, `localOnly=true`). No raw camera frames were
  printed, written, uploaded, persisted, or logged.
- The experiment used a process-local `PATH` only. No global `PATH` was mutated.
  The candidate DLLs were copied into a local scratch directory and were **not**
  committed. The staged `.lvk-native-runtime/bin/` was left unchanged (still the
  4 manifest DLLs plus the executable).

Limitations / honesty notes:

- This proves vcpkg-`PATH` independence on a machine that already provides the
  Windows platform DLLs and the VC++ runtime. It does **not** prove clean-machine
  independence (see section 9).
- `dumpbin /dependents` shows static imports only. Any delay-loaded or
  `LoadLibrary`-resolved backend (for example an optional ffmpeg `videoio`
  backend, or codec plugins loaded on demand) would not appear and is not
  covered by this static inspection. The capability run exercises startup only,
  not a live camera/codec path.

## 11. Constraint discovered for the next PR

The 12 non-OpenCV vcpkg runtime DLLs in section 7B do **not** match the OpenCV
filename patterns allowed by `tools/copy-opencv-runtime-dlls.mjs`
(`ALLOWED_DLL_PATTERNS`). The current manifest schema/helper validation rejects
any non-`opencv_*` entry (covered by the helper self-test, "manifest rejects
non-allowed DLL names"). Therefore:

- The 5 additional OpenCV modules (section 7A) **could** be added to the existing
  manifest today, because they match the allowed patterns.
- The 12 non-OpenCV runtime DLLs (section 7B) **cannot** be expressed in the
  current manifest/helper without a helper/policy change (a broadened allow-list,
  a separate non-OpenCV runtime manifest, or an equivalent app-owned copy
  mechanism).

This is the main design decision the follow-up PR must make.

## 12. Recommended dependency set (non-authoritative)

| filename                                                                                                      | category                    | reason                                    | source evidence       | recommended handling                      | confidence |
| ------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------- | --------------------- | ----------------------------------------- | ---------- |
| `opencv_imgcodecs4.dll`                                                                                       | B. additional OpenCV module | static import of `videoio`                | `dumpbin /dependents` | bundle in app-owned runtime dir           | high       |
| `opencv_dnn4.dll`                                                                                             | B. additional OpenCV module | static import of `objdetect`              | `dumpbin /dependents` | bundle in app-owned runtime dir           | high       |
| `opencv_calib3d4.dll`                                                                                         | B. additional OpenCV module | static import of `objdetect`              | `dumpbin /dependents` | bundle in app-owned runtime dir           | high       |
| `opencv_features2d4.dll`                                                                                      | B. additional OpenCV module | static import of `objdetect`/`calib3d`    | `dumpbin /dependents` | bundle in app-owned runtime dir           | high       |
| `opencv_flann4.dll`                                                                                           | B. additional OpenCV module | static import of `objdetect`/`features2d` | `dumpbin /dependents` | bundle in app-owned runtime dir           | high       |
| `z.dll`                                                                                                       | C. non-OpenCV vcpkg runtime | zlib used by core/imgcodecs/png/tiff      | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `jpeg62.dll`                                                                                                  | C. non-OpenCV vcpkg runtime | JPEG codec for imgcodecs/tiff             | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libpng16.dll`                                                                                                | C. non-OpenCV vcpkg runtime | PNG codec for imgcodecs                   | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `tiff.dll`                                                                                                    | C. non-OpenCV vcpkg runtime | TIFF codec for imgcodecs                  | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `liblzma.dll`                                                                                                 | C. non-OpenCV vcpkg runtime | LZMA used by tiff                         | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libwebp.dll`                                                                                                 | C. non-OpenCV vcpkg runtime | WebP codec for imgcodecs                  | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libwebpdecoder.dll`                                                                                          | C. non-OpenCV vcpkg runtime | WebP codec for imgcodecs                  | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libwebpdemux.dll`                                                                                            | C. non-OpenCV vcpkg runtime | WebP codec for imgcodecs                  | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libwebpmux.dll`                                                                                              | C. non-OpenCV vcpkg runtime | WebP codec for imgcodecs                  | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libsharpyuv.dll`                                                                                             | C. non-OpenCV vcpkg runtime | WebP color used by libwebp                | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `libprotobuf.dll`                                                                                             | C. non-OpenCV vcpkg runtime | protobuf used by dnn                      | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `abseil_dll.dll`                                                                                              | C. non-OpenCV vcpkg runtime | Abseil used by dnn/protobuf               | `dumpbin /dependents` | bundle; needs helper/policy change        | high       |
| `MSVCP140.dll`                                                                                                | E. VC++ redistributable     | C++ standard library runtime              | `dumpbin /dependents` | VC++ redistributable decision (section 9) | medium     |
| `VCRUNTIME140.dll`                                                                                            | E. VC++ redistributable     | C runtime                                 | `dumpbin /dependents` | VC++ redistributable decision (section 9) | medium     |
| `VCRUNTIME140_1.dll`                                                                                          | E. VC++ redistributable     | C runtime                                 | `dumpbin /dependents` | VC++ redistributable decision (section 9) | medium     |
| `CONCRT140.dll`                                                                                               | E. VC++ redistributable     | Concurrency runtime used by core          | `dumpbin /dependents` | VC++ redistributable decision (section 9) | medium     |
| `MFPlat.DLL` / `MF.dll` / `MFReadWrite.dll`                                                                   | D. Windows platform         | Media Foundation videoio backend          | `dumpbin /dependents` | platform-provided; do NOT bundle          | high       |
| `dxgi.dll` / `d3d11.dll` / `ole32.dll` / `OLEAUT32.dll` / `SHLWAPI.dll` / `KERNEL32.dll` / `api-ms-win-crt-*` | D. Windows platform         | OS components                             | `dumpbin /dependents` | platform-provided; do NOT bundle          | high       |

## 13. Validation commands and results

| Check                                    | Command                                 | Result                                           |
| ---------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| Formatting                               | `pnpm format:check`                     | PASS — all files use Prettier code style         |
| Manifest-aware helper self-test          | `pnpm test:copy-opencv-runtime-dlls`    | PASS — 41 passed, 0 failed                       |
| Manifest DLL staging verification        | `pnpm prep:native-runtime:verify:local` | PASS — all 4 manifest DLLs present in staged bin |
| Baseline independence (4 DLLs, no vcpkg) | native `--print-runtime-capabilities`   | FAIL — `0xC0000135` / `STATUS_DLL_NOT_FOUND`     |
| With 17 candidates (no vcpkg)            | native `--print-runtime-capabilities`   | PASS — capabilities printed, exit 0, no frames   |

## 14. Recommended next PR scope

1. Decide how to express non-OpenCV runtime DLLs (section 11): broaden the helper
   allow-list, add a separate non-OpenCV runtime manifest, or add an equivalent
   app-owned copy step. Keep release/debug and architecture scopes separate.
2. Add the verified transitive set (sections 7A + 7B) to the chosen
   manifest/mechanism, within redistribution policy and with license review for
   the bundled third-party codec/runtime libraries.
3. Decide the VC++ runtime redistributable strategy (section 9), then validate on
   a clean machine without vcpkg, without the VC++ redistributable preinstalled,
   and without a global `PATH` requirement.
4. Re-run the packaged/staged runtime smoke and confirm adjacent-DLL independence
   from `<resources>/native-runtime/`.

Do not broaden the authoritative manifest until that follow-up PR is explicitly
approved.

## 15. Local-first / privacy confirmation

- No raw camera frames were printed, written, uploaded, persisted, or logged. The
  capability mode opens no camera.
- No global `PATH` was mutated. Only a process-local `PATH` was used for the runs.
- No runtime download of OpenCV or native dependencies was introduced.
- No telemetry, analytics, cloud upload, external frame processing, hidden network
  calls, or new network behavior was introduced.
- No actual DLLs, binaries, build artifacts, generated package outputs,
  `.lvk-native-runtime/` contents, raw logs, screenshots, or local absolute paths
  were committed.
