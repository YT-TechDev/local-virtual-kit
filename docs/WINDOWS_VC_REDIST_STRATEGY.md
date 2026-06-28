# Windows VC++ Redistributable Strategy

This document records the initial LVK v0.x strategy for handling Visual C++
runtime redistributable requirements for the packaged Windows Native Core
runtime. It is documentation-only and does not implement packaging behavior,
modify helper scripts, modify manifests, change Electron packaging configuration,
change Native Core C++, or add runtime downloads.

## Background

PR #371 confirmed that the packaged Native Core runtime starts without requiring a
global vcpkg directory on `PATH` when the 21 app-owned OpenCV/vcpkg DLLs from the
expanded Windows x64 Release manifest are placed adjacent to the executable. That
verification was performed on a development machine that had the Microsoft Visual
C++ Redistributable preinstalled. Clean-machine independence — a machine without
the VC++ redistributable — was not proven.

See the full smoke report:
[`docs/reports/packaged-native-runtime-smoke-rerun-2026-06-28.md`](./reports/packaged-native-runtime-smoke-rerun-2026-06-28.md)

## DLL classification

The Windows runtime dependencies of the packaged Native Core fall into three
distinct categories that must be handled differently.

### 1. App-owned OpenCV/vcpkg runtime DLLs

These are DLLs provided by the vcpkg-built OpenCV and its transitive dependencies.
They are verified, app-owned, and bundled in the packaged native runtime directory.

The authoritative list is the Windows x64 Release manifest:
`native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`

The manifest currently covers:

- 4 direct OpenCV modules: `opencv_core4.dll`, `opencv_imgproc4.dll`,
  `opencv_videoio4.dll`, `opencv_objdetect4.dll`
- 5 transitive OpenCV modules: `opencv_imgcodecs4.dll`, `opencv_dnn4.dll`,
  `opencv_calib3d4.dll`, `opencv_features2d4.dll`, `opencv_flann4.dll`
- 12 non-OpenCV vcpkg runtime DLLs: `z.dll`, `jpeg62.dll`, `libpng16.dll`,
  `tiff.dll`, `liblzma.dll`, `libwebp.dll`, `libwebpdecoder.dll`,
  `libwebpdemux.dll`, `libwebpmux.dll`, `libsharpyuv.dll`, `libprotobuf.dll`,
  `abseil_dll.dll`

These DLLs are handled by the existing manifest and staging helper flow. They are
not VC++ redistributable DLLs.

### 2. Windows platform DLLs

System DLLs provided by Windows itself (e.g. `kernel32.dll`, `user32.dll`,
`ntdll.dll`). These are present on every supported Windows version and must not
be bundled with the app.

### 3. Visual C++ runtime redistributable DLLs

DLLs provided by the Microsoft Visual C++ Redistributable package. The current
Release build requires:

- `MSVCP140.dll`
- `VCRUNTIME140.dll`
- `VCRUNTIME140_1.dll`
- `CONCRT140.dll`

These DLLs are **not** part of the OpenCV/vcpkg runtime set and are **not** in
scope for the app-owned manifest or staging helper. They are satisfied by the
Microsoft Visual C++ Redistributable installer, not by vcpkg.

## LVK v0.x strategy

### Decision

For LVK v0.x, depend on the **Microsoft Visual C++ Redistributable being
installed** on the user's machine rather than copying VC++ runtime DLLs
app-locally.

This means:

- VC++ runtime DLLs (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`,
  `CONCRT140.dll`) are **not** added to the OpenCV runtime manifest
  (`opencv-runtime-windows-x64-release.json`).
- VC++ runtime DLL filenames are **not** added to the helper allow-list
  (`ALLOWED_VCPKG_RUNTIME_DLLS`).
- VC++ runtime DLLs are **not** copied by the OpenCV runtime staging helper.
- The VC++ Redistributable is treated as an **installer prerequisite**, not an
  ad hoc app-local DLL copy.

### Rationale

- The Microsoft Visual C++ Redistributable is a standard Windows prerequisite
  distributed by Microsoft. Most Windows machines with Visual Studio or any
  software built with MSVC already have it installed.
- Bundling VC++ runtime DLLs app-locally requires careful redistribution review
  of the Microsoft Software License Terms and is a separate packaging decision
  that should not be made ad hoc.
- Silently copying VC++ runtime DLLs without explicit packaging intent adds
  opaque DLL provenance and can interfere with Windows DLL versioning behavior.
- An installer prerequisite or installer-bundled VC++ redist merge module is the
  standard Windows distribution path for this dependency.

### Prerequisite documentation

The LVK packaged app for Windows currently requires:

- Windows 10/11 x64 (supported Windows version)
- Microsoft Visual C++ Redistributable for Visual Studio 2015–2022 (x64)

This prerequisite should be documented in installation and packaging materials
when the LVK installer is prepared. It must not be silently assumed without
user-visible acknowledgement.

### Revisit criteria

Revisit app-local VC++ runtime DLL placement as a separate owner-approved
packaging decision if:

- Clean-machine validation shows that the VC++ redistributable assumption is too
  fragile for the target user population.
- The installer strategy requires self-contained app-local runtime DLLs.
- Redistribution review of the Microsoft Software License Terms permits and
  recommends app-local bundling for the chosen distribution method.

## What is not changed by this strategy

- The OpenCV runtime manifest (`opencv-runtime-windows-x64-release.json`) is not
  modified.
- The helper allow-list (`ALLOWED_VCPKG_RUNTIME_DLLS`) is not modified.
- The OpenCV runtime staging helper is not modified.
- Electron packaging configuration is not modified.
- Native Core C++ or CMake behavior is not modified.
- No DLLs are added to or removed from the app-owned bundled set.
- No VC++ runtime download is introduced.
- No PATH mutation is introduced.

## Clean-machine validation (follow-up)

The following validation pass is required before claiming clean-machine VC++
redistributable independence. It has not been performed yet and must not be
claimed until completed.

### Environment requirements

- A clean Windows machine or VM
- VC++ Redistributable installed (by the Microsoft installer or an equivalent
  installer prerequisite step)
- No vcpkg installation or vcpkg directory on `PATH`
- No local OpenCV development installation

### Validation checklist

- [ ] Confirm the packaged Native Core starts from `<resources>/native-runtime/bin/`
      without any vcpkg directory on `PATH`.
- [ ] Confirm `--print-runtime-capabilities` reports `opencvCameraSupport=true`
      and `localOnly=true` from the packaged location.
- [ ] Confirm no `STATUS_DLL_NOT_FOUND` / `0xC0000135` error occurs.
- [ ] Confirm no vcpkg `PATH` requirement exists.
- [ ] Confirm no local OpenCV install dependency exists.
- [ ] Confirm no raw camera frames were printed, written, uploaded, persisted, or
      sent during the capability check.
- [ ] Record the VC++ Redistributable version installed and confirm it satisfies
      the runtime requirements.

Camera smoke remains a separate check and must not be claimed as part of this
validation pass unless explicitly performed with a webcam and OS camera permission.

### If validation fails

If the clean-machine run shows that the VC++ redistributable is not present or
its version is insufficient:

1. Document the exact failure and missing DLL names.
2. Open a separate owner-approved PR to decide between:
   - Requiring the VC++ Redistributable as an installer-bundled prerequisite
     (merge module or bundled installer).
   - Placing VC++ runtime DLLs app-locally with explicit redistribution review.
3. Do not add VC++ runtime DLLs to the manifest or allow-list without an
   explicit owner decision.

## Related documents

- [`docs/NATIVE_OPENCV_RUNTIME_PACKAGING_STRATEGY.md`](./NATIVE_OPENCV_RUNTIME_PACKAGING_STRATEGY.md) — overall OpenCV runtime packaging strategy
- [`docs/OPENCV_RUNTIME_DLL_MANIFEST_POLICY.md`](./OPENCV_RUNTIME_DLL_MANIFEST_POLICY.md) — manifest and allow-list policy
- [`docs/ELECTRON_PACKAGED_NATIVE_RUNTIME_DIRECTORY.md`](./ELECTRON_PACKAGED_NATIVE_RUNTIME_DIRECTORY.md) — packaged native runtime directory layout
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](./LOCAL_RUNTIME_CHECKLIST.md) — local validation checklist
- [`docs/reports/packaged-native-runtime-smoke-rerun-2026-06-28.md`](./reports/packaged-native-runtime-smoke-rerun-2026-06-28.md) — PR #371 smoke report confirming vcpkg PATH independence and noting unproven clean-machine VC++ independence

## Out of scope for this strategy document

- Implementing installer behavior.
- Adding a VC++ redistributable installer download.
- Adding app-local VC++ runtime DLL copying.
- Modifying the helper allow-list.
- Modifying the runtime manifest.
- Modifying Electron packaging configuration.
- Modifying Native Core C++ or CMake.
- Running or claiming clean-machine validation.
- Running or claiming camera smoke or OBS validation.
- Running or claiming full signed installer packaging.
