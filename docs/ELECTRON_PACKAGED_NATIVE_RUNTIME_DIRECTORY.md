# Electron Packaged Native Runtime Directory

This document defines the intended app-owned packaged Native Core runtime directory layout before connecting OpenCV runtime DLL copying to Electron packaging. It is documentation-only and does not implement packaging behavior, change Electron runtime code, change Native Core C++, change CMake behavior, change helper behavior, add package scripts, add dependencies, or alter the `MotionFrame` schema or Motion Protocol.

## Purpose

Packaged Electron builds need a deterministic, local-first place for the Native Core executable, required OpenCV runtime DLLs, and runtime manifests. The packaged app must not depend on a developer machine's global vcpkg/OpenCV installation, global `PATH`, runtime downloads, or hidden network behavior.

This design is the bridge between the OpenCV runtime DLL manifest policy and a later packaging integration PR.

## Intended packaged layout

Use an app-owned resources directory chosen by the Electron packaging system. The exact packager-specific root is intentionally represented with a placeholder:

```txt
<app-resources>/native-runtime/
  bin/
    lvk-tracker-core.exe
    <required OpenCV runtime DLLs>
  manifests/
    opencv-runtime-windows-x64-release.json
```

Notes:

- `<app-resources>` is a placeholder for the packaged application's resources location.
- `native-runtime/` is owned by the LVK desktop app package.
- `bin/` contains the packaged Native Core executable and the runtime DLLs required for that packaged build.
- `manifests/` contains platform/configuration-scoped runtime manifests used to define or verify expected DLL contents.
- The manifest filename above is illustrative. Future implementation may choose another scoped filename, but it must remain specific to platform, architecture, and configuration.
- This document does not add authoritative manifest JSON files or actual runtime DLLs.

## Ownership and responsibility boundaries

- Electron owns the desktop shell, settings, calibration UI, local configuration, and Native Core process lifecycle.
- Native Core owns camera access, tracking, native runtime behavior, and performance boundaries.
- The shared protocol owns `MotionFrame` and Motion Protocol contracts.
- Web Preview only consumes `MotionFrame` data and must not own native tracking or runtime packaging behavior.
- Packaging must not change the `MotionFrame` schema or Motion Protocol.

## Runtime path resolution expectations

In packaged app mode, Electron should launch Native Core from the app-owned native runtime directory:

```txt
<app-resources>/native-runtime/bin/lvk-tracker-core.exe
```

Packaged runtime resolution must follow these expectations:

- Packaged Native Core must not require a global vcpkg/OpenCV directory on `PATH`.
- Required OpenCV runtime DLLs should live adjacent to the Native Core executable or otherwise within the app-owned native runtime directory.
- If Electron needs a scoped child-process environment `PATH`, it must be local to the spawned Native Core process only.
- A scoped child-process `PATH`, if used, must point only at app-owned packaged runtime directories.
- Packaging must not mutate the user's global `PATH`.
- Packaged app users must not be required to install vcpkg or OpenCV globally.
- The app must not download OpenCV DLLs or native runtime dependencies at runtime.

## Manifest expectations

The packaged native runtime directory should have a platform/configuration-scoped manifest, such as a Windows x64 release manifest for a Windows x64 release package.

Manifest expectations:

- Manifest-listed DLLs must be copied and verified before packaging integration depends on them.
- The manifest is a native runtime packaging artifact, not a `MotionFrame` or Motion Protocol contract.
- Manifest verification should happen before packaging or as part of packaging checks in a future PR.
- Release and debug manifests must remain separate.
- Architecture and platform scopes must remain explicit.
- Future implementation may use the manifest-aware helper or an equivalent packaging step.
- This PR must not add real authoritative manifest JSON files.

## Failure handling expectations

Packaged runtime failures should be actionable without leaking local machine details or compromising privacy:

- A missing Native Core executable should produce a sanitized error.
- Missing manifest-listed DLLs should produce sanitized output listing missing filenames, not local absolute paths.
- Failure messages, docs, committed reports, and PR text must not expose local absolute paths.
- Runtime errors must not cause raw camera frames to be written, uploaded, persisted, or logged.
- Errors should preserve the separation between packaging/runtime dependency failures and MotionFrame/protocol compatibility.

## Local-first and privacy constraints

The packaged native runtime layout must preserve LVK's local-first posture:

- Camera frames must stay local.
- No telemetry.
- No analytics.
- No cloud upload.
- No external frame processing.
- No hidden network calls.
- No new network behavior.
- No runtime DLL download.
- No raw camera frames may be written, uploaded, persisted, or logged as part of packaged runtime startup, validation, or failure handling.

## Future PR D packaging integration scope

A later packaging integration PR should keep the change small and reviewable. It should:

- Wire Electron packaging configuration to include the app-owned native runtime directory.
- Use the manifest-aware helper or an equivalent packaging step.
- Include required DLLs without committing DLLs to source control.
- Verify packaged Native Core can start from the packaged location.
- Keep Electron packaging changes separate from Native Core tracking algorithm changes.
- Preserve local-first behavior and avoid new network behavior.

## Acceptance criteria for future implementation PRs

Future implementation PRs that connect this design to packaging should satisfy these criteria:

- Packaged Native Core starts without global vcpkg `PATH`.
- `--print-runtime-capabilities` works from the packaged runtime location.
- Required manifest-listed DLLs are present in the app-owned runtime directory.
- No actual DLLs are committed to the repository.
- No global `PATH` mutation is introduced.
- No runtime network download is introduced.
- No `MotionFrame` schema changes are introduced.
- No Motion Protocol changes are introduced.
- No raw frames are written, uploaded, persisted, or logged.
- Failure output is sanitized.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior is introduced.
