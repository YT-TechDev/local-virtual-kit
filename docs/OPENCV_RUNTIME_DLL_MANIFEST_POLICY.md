# OpenCV Runtime DLL Manifest Policy

This document defines the policy for OpenCV runtime DLL manifests before the dev/local copy helper is connected to Electron packaging. It is documentation-only and does not change helper behavior, package scripts, Electron packaging configuration, Electron runtime code, Native Core C++, CMake behavior, Web Preview behavior, dependencies, the `MotionFrame` schema, or the Motion Protocol.

## Purpose

Windows OpenCV builds can require runtime DLLs that are not available on a clean packaged-app machine. LVK needs a reproducible, app-owned runtime DLL policy before packaging integration so that packaged builds do not depend on broad filename guesses, global vcpkg installs, or global `PATH` setup.

This policy separates three concepts that must stay distinct:

1. **Allowed DLL patterns** used by the current dev/local copy helper.
2. **Required DLL manifests** for specific build targets and configurations.
3. **Transitive runtime dependencies** required by the Native Core executable or by OpenCV runtime DLLs.

## Definitions

### Allowed DLL patterns

Allowed DLL patterns are broad filename patterns accepted by the current dev/local copy helper. They define candidate OpenCV DLL filenames that the helper may copy from a local source directory into a local destination directory.

Allowed patterns are not equivalent to required package contents. A DLL matching an allowed pattern is only a copy candidate; it is not automatically required by a packaged build. Conversely, required transitive runtime DLLs might not match OpenCV filename patterns and must not be ignored only because they are not named like OpenCV modules.

The current helper remains a candidate copier. It is useful for local development experiments, but packaging integration must not rely only on its broad allowed filename patterns.

### Required DLL manifest

A required DLL manifest is an explicit list of runtime DLL files required for one specific build target and configuration. A manifest should be scoped by platform, architecture, linkage style, and build configuration rather than shared across incompatible package types.

Example manifest scopes include:

- `windows-x64-release`
- `windows-x64-debug`

Future platforms or configurations should use separate manifests. Do not mix release, debug, architecture, or platform requirements into one catch-all manifest.

A manifest can be authored or generated in a later implementation PR, but before Electron packaging integration it must define the exact files that packaging is expected to copy and verify for the target build.

### Transitive runtime dependencies

Transitive runtime dependencies are DLLs required by OpenCV runtime DLLs or by the Native Core executable. They can include non-OpenCV DLLs provided by the compiler runtime, vcpkg triplet, codec/media stack, or other native dependencies used by the selected OpenCV build.

Transitive dependencies must not be guessed by hand from file names alone. Future implementation should use dependency inspection or equivalent local verification for the built Native Core executable and selected OpenCV DLL set.

## Staged policy

LVK is intentionally taking a staged, safe packaging path:

1. Define this manifest and required-DLL policy before packaging integration.
2. Add helper support for manifest mode and verification mode in a later PR.
3. Define the Electron packaged native runtime directory layout in a later PR. The intended app-owned packaged layout is documented in [`docs/ELECTRON_PACKAGED_NATIVE_RUNTIME_DIRECTORY.md`](./ELECTRON_PACKAGED_NATIVE_RUNTIME_DIRECTORY.md).
4. Connect Electron packaging configuration only after the manifest and verification behavior exist.
5. Record packaged runtime smoke or verification results in a later PR.

Until the later helper PR exists:

- The current copy helper remains a dev/local candidate copier.
- Packaging integration must not use broad allowed filename patterns as the only source of truth.
- A required manifest for the target build must be defined or generated before packaging integration.
- Future helper work should add manifest mode, for example `--manifest <json>`, and verification mode, for example `--verify`, before Electron packaging integration.

## Release/debug separation

Release and debug OpenCV runtime files must remain separate:

- Release packages must not include debug DLLs.
- Debug DLLs are local/dev only unless explicitly scoped to a debug package.
- Do not mix release and debug OpenCV DLLs in one packaged native runtime directory.
- A `windows-x64-release` manifest and a `windows-x64-debug` manifest should be treated as different artifacts with different validation expectations.

## OpenCV module policy

OpenCV aggregate and modular builds must be handled as distinct cases:

- `opencv_world<version>.dll` style aggregate builds should be represented as an aggregate-build manifest case.
- Modular OpenCV builds should be represented as modular manifest cases.
- Modular manifests should include only modules actually required by the Native Core build.

The Windows x64 Release manifest (`native/tracker-core/manifests/opencv-runtime-windows-x64-release.json`) now includes the full verified static transitive OpenCV module set from the 2026-06-27 dependency inspection report:

- `opencv_core4.dll` — direct dependency
- `opencv_imgproc4.dll` — direct dependency
- `opencv_videoio4.dll` — direct dependency
- `opencv_objdetect4.dll` — direct dependency
- `opencv_imgcodecs4.dll` — transitive via `videoio`
- `opencv_dnn4.dll` — transitive via `objdetect`
- `opencv_calib3d4.dll` — transitive via `objdetect`
- `opencv_features2d4.dll` — transitive via `objdetect`/`calib3d`
- `opencv_flann4.dll` — transitive via `objdetect`/`features2d`

## Non-OpenCV vcpkg runtime DLL policy

The Windows x64 Release manifest also includes non-OpenCV vcpkg runtime DLLs required by the OpenCV modules. These are allowed only by a narrow exact filename allow-list verified via `dumpbin /dependents` static import inspection (2026-06-27 report). Arbitrary non-OpenCV DLL names are rejected by the helper validation.

The verified set for the current Windows x64 Release OpenCV-enabled Native Core build:

- `z.dll` — zlib; required by `core`, `imgcodecs`, `libpng16`, `tiff`
- `jpeg62.dll` — libjpeg-turbo; required by `imgcodecs`, `tiff`
- `libpng16.dll` — PNG codec; required by `imgcodecs`
- `tiff.dll` — TIFF codec; required by `imgcodecs`
- `liblzma.dll` — LZMA; required by `tiff`
- `libwebp.dll` — WebP; required by `imgcodecs`
- `libwebpdecoder.dll` — WebP; required by `imgcodecs`
- `libwebpdemux.dll` — WebP; required by `imgcodecs`
- `libwebpmux.dll` — WebP; required by `imgcodecs`
- `libsharpyuv.dll` — WebP color; required by `libwebp`
- `libprotobuf.dll` — protobuf; required by `dnn`
- `abseil_dll.dll` — Abseil; required by `dnn`, `libprotobuf`

These DLLs are app-owned vcpkg runtime dependencies and must not be confused with Windows platform DLLs or VC++ runtime redistributable DLLs. Windows platform DLLs must not be bundled. VC++ redistributable handling (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `CONCRT140.dll`) remains a separate packaging decision.

Clean-machine independence (a machine without the VC++ redistributable preinstalled) is not yet proven. Do not claim it until explicitly validated.

## Transitive dependency policy

Future implementation must verify transitive runtime dependencies rather than infer them from names alone:

- Inspect the built Native Core executable and selected OpenCV DLLs with a local dependency-inspection method or equivalent verification.
- Include required transitive DLLs in the target manifest when redistribution and packaging policy allow them.
- For non-OpenCV DLLs, add them only to the exact verified allow-list in the helper (`ALLOWED_VCPKG_RUNTIME_DLLS`); do not use broad patterns.
- Report missing files with sanitized messages that do not expose local absolute paths.
- Do not require packaged app users to install vcpkg, OpenCV, or other native dependencies globally.
- Do not introduce a global installer or global `PATH` requirement for packaged app users.
- Do not modify global `PATH`.
- Do not perform runtime network downloads for OpenCV DLLs or native runtime dependencies.

## Acceptance criteria for the manifest-mode helper PR

The later helper PR that adds manifest support should satisfy these criteria before packaging integration depends on it:

- The helper can read a manifest file.
- The helper can copy only manifest-listed files.
- The helper can verify required files exist in the source directory.
- The helper can verify required files exist in the destination directory.
- The helper reports missing files with sanitized messages.
- The helper does not modify `PATH`.
- The helper does not download anything.
- The helper does not commit DLLs or generated artifacts.

## Acceptance criteria for later packaging PRs

Later packaging PRs should satisfy these criteria:

- The packaged app uses an app-owned native runtime directory.
- Packaged Native Core starts without a global vcpkg `PATH` requirement.
- Required DLLs are present next to or within the app-owned native runtime directory.
- `--print-runtime-capabilities` works from the packaged location.
- No `MotionFrame` schema changes are introduced.
- No Motion Protocol changes are introduced.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior is introduced.
- Camera frames remain local.

## Out of scope for this policy PR

This policy PR must not:

- Modify the copy helper.
- Add required manifest JSON files.
- Implement `--manifest`.
- Implement `--verify`.
- Modify package scripts.
- Modify Electron packaging configuration.
- Modify Electron runtime code.
- Modify Native Core C++.
- Modify CMake behavior.
- Modify Web Preview behavior.
- Change the `MotionFrame` schema.
- Change the Motion Protocol.
- Add dependencies.
- Add telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior.
- Add local absolute paths, actual DLLs, binaries, build artifacts, screenshots, raw logs, raw frames, model files, cascade XML files, private/internal links, or AI task URLs.
