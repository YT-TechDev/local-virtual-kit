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

Likely direct OpenCV modules for the current Native Core use may include:

- `opencv_core`
- `opencv_imgproc`
- `opencv_videoio`
- `opencv_objdetect`

That list is a planning hint, not final runtime dependency evidence. Broader modules such as `opencv_dnn`, `opencv_highgui`, `opencv_features2d`, `opencv_flann`, and `opencv_calib3d` must not be treated as required unless dependency inspection or equivalent local verification proves they are required for the current build.

## Transitive dependency policy

Future implementation must verify transitive runtime dependencies rather than infer them from names alone:

- Inspect the built Native Core executable and selected OpenCV DLLs with a local dependency-inspection method or equivalent verification.
- Include required transitive DLLs in the target manifest when redistribution and packaging policy allow them.
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
