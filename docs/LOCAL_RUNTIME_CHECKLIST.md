# Local Runtime Verification Checklist

This checklist verifies the LVK v0.1 local runtime paths without changing runtime behavior, dependencies, or the `MotionFrame` schema. Use it for local release smoke testing and PR validation when runtime paths are affected.

## Scope and privacy rule

- Verify only local runtime behavior: Web Preview, Electron startup, Native Core startup/build, localhost MotionFrame transport, OBS Browser Source preview, and optional local camera access.
- Preserve LVK's local-first rule: raw camera frames must stay on the local machine and must not be sent to external servers in v0.1.
- Do not claim real webcam/OpenCV validation unless it was performed on a local machine with a camera, OS camera permission, and an OpenCV-enabled native build.
- Electron, webcam, OBS, and OS camera permission checks are local/manual checks. They are not expected to pass in headless CI, Codex, cloud runners, or machines without camera forwarding.

## Current v0.1 verification status

The completed 2026-06-26 local verification pass is recorded in [`docs/reports/local-runtime-verification-2026-06-26.md`](./reports/local-runtime-verification-2026-06-26.md). That pass confirmed automated checks, native dummy output, MotionFrame bridge smoke, Web Preview dummy/native modes, and Electron native pipeline start/stop for the current local-first dummy/native-dummy runtime paths.

OBS Browser Source validation and OpenCV camera validation remain environment-dependent follow-up checks. Do not claim OBS, webcam/OpenCV, or OS camera permission validation unless those checks are performed in an environment that provides the required local tools, hardware, and permissions.

The 2026-06-29 OBS Browser Source validation pass is recorded in [`docs/reports/obs-browser-source-validation-2026-06-29.md`](./reports/obs-browser-source-validation-2026-06-29.md). That pass confirmed packaged resources, capability preflight, Web Preview HTTP (including `?mode=obs&source=native`), and continuous pipeline through `motion-ws-bridge`. OBS Studio 32.1.2 was confirmed installed and running with the browser plugin present. OBS Browser Source scene configuration and visual rendering in OBS canvas remain MANUAL — direct GUI interaction is required to add the Browser Source to an OBS scene and observe the canvas.

The 2026-06-30 packaged Electron GUI native pipeline validation pass is recorded in [`docs/reports/packaged-electron-gui-native-pipeline-validation-2026-06-30.md`](./reports/packaged-electron-gui-native-pipeline-validation-2026-06-30.md). That pass validated the full packaged Electron GUI path: packaged app launch → Electron UI pipeline start (camera-source=opencv) → packaged `lvk-tracker-core.exe` spawn → in-process MotionFrame bridge at `ws://127.0.0.1:45731/motion` (loopback-only confirmed) → 3 MotionFrame frames received (source=native, tracking=tracking) → Electron UI pipeline stop (clean: nativeTrackerStatus=Exited, motionBridgeStatus=Exited). A bug was found and fixed: `NativePipelineManager.start()` used `cwd: repoRoot` which is a non-existent fallback path in packaged mode, causing ENOENT. Fixed to use `dirname(packagedTrackerPath)` as cwd when the packaged path is used.

The 2026-06-30 packaged Electron native visual output validation pass is recorded in [`docs/reports/packaged-electron-native-visual-output-validation-2026-06-30.md`](./reports/packaged-electron-native-visual-output-validation-2026-06-30.md). That pass confirmed browser-visible avatar animation at `http://localhost:5173/?source=native` (MANUAL — human observation) and OBS Browser Source visual output at `http://localhost:5173/?mode=obs&source=native` (MANUAL — human observation) while the packaged Electron-owned native pipeline was running. Programmatic checks: 3 MotionFrame frames received from the in-process bridge (source=native, tracking=tracking, ~30 fps), loopback-only binding confirmed, tracker process and bridge confirmed stopped cleanly.

The 2026-07-01 Web Preview face tracking sensitivity local smoke is recorded in [`docs/reports/web-preview-face-tracking-sensitivity-local-smoke-2026-07-01.md`](./reports/web-preview-face-tracking-sensitivity-local-smoke-2026-07-01.md). That owner-performed local manual validation confirmed that Web Preview received native frames from the packaged Electron / OpenCV path and that avatar movement followed face/person position after PR #385; Codex did not perform this local GUI/webcam validation. The follow-up analysis of why eye/mouth/expression movement remains weak, and the local-only options for improving it, is recorded in [`docs/reports/local-only-landmark-expression-tracking-investigation-2026-07-01.md`](./reports/local-only-landmark-expression-tracking-investigation-2026-07-01.md).

The 2026-07-01 Web Preview renderer approximation local smoke after PR #388 is recorded in [`docs/reports/web-preview-renderer-approximation-local-smoke-2026-07-01.md`](./reports/web-preview-renderer-approximation-local-smoke-2026-07-01.md). It records owner-performed local manual validation of the packaged Electron / OpenCV / Web Preview native-frame path and the expected limitation that the renderer-side idle approximation is not real eye, mouth, expression, or landmark tracking.

The 2026-07-02 Native OpenCV stability and Electron dev root local smoke is recorded in [`docs/reports/native-opencv-stability-and-electron-dev-root-local-smoke-2026-07-02.md`](./reports/native-opencv-stability-and-electron-dev-root-local-smoke-2026-07-02.md). That owner-performed local validation recorded Native Core OpenCV stabilization and `resultSource=fresh|held|none` diagnostics after PR #391 and PR #392, plus Electron dev native runtime root-resolution validation after PR #393. It also records that the mouth-open position jump was improved/fixed in Web Preview behavior while movement remains angular/blocky.

For future packaged Electron builds, see [`docs/NATIVE_OPENCV_RUNTIME_PACKAGING_STRATEGY.md`](./NATIVE_OPENCV_RUNTIME_PACKAGING_STRATEGY.md) for the Windows/vcpkg OpenCV runtime DLL handling strategy. Local/dev validation keeps the explicit `PATH` guidance below; packaged app behavior should be addressed in a separate implementation PR.

## Automated checks

Run these checks from the repository root when preparing a full local runtime verification pass. For a documentation-only change, `pnpm format:check` is the minimum required check; other runtime checks may be documented as not run when they are outside the change scope.

| Check                          | Command                                                                                 | Expected result                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Install workspace dependencies | `pnpm install`                                                                          | Dependencies install without lockfile or package changes unless intentionally updated.                                            |
| Formatting                     | `pnpm format:check`                                                                     | Prettier reports all checked files as formatted.                                                                                  |
| Workspace build                | `pnpm build`                                                                            | Package build scripts complete successfully.                                                                                      |
| Type checks                    | `pnpm typecheck`                                                                        | TypeScript checks complete successfully.                                                                                          |
| Tests                          | `pnpm test`                                                                             | Workspace and tool tests complete successfully.                                                                                   |
| Lint                           | `pnpm lint`                                                                             | Lint scripts complete successfully where present.                                                                                 |
| Native configure               | `cmake -S native/tracker-core -B native/tracker-core/build`                             | CMake configures the native tracker build. OpenCV may be reported unavailable on machines without local OpenCV development files. |
| Native build                   | `cmake --build native/tracker-core/build`                                               | The `lvk-tracker-core` executable builds.                                                                                         |
| Native dummy output smoke      | `node tools/check-native-tracker-output.mjs native/tracker-core/build/lvk-tracker-core` | The native executable emits MotionFrame-shaped dummy output accepted by the checker.                                              |
| Motion WebSocket bridge smoke  | `pnpm test:motion-ws-bridge`                                                            | The development bridge accepts valid MotionFrame JSON over localhost-only transport.                                              |

### Development server smoke checks

These commands start long-running local development processes. They are automated commands, but their visual/runtime confirmation is manual.

| Runtime path             | Command            | Confirm locally                                                                                                                                 |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Preview dummy mode   | `pnpm dev:web`     | Open `http://localhost:5173/?source=dummy` and confirm the preview animates from frontend dummy MotionFrame data.                               |
| Web Preview native mode  | `pnpm dev:web`     | With the native bridge running, open `http://localhost:5173/?source=native` and confirm frames are consumed from `ws://127.0.0.1:45731/motion`. |
| Electron desktop startup | `pnpm dev:desktop` | Confirm the Electron window opens, shows preview URLs/status, and does not require external network or camera upload.                           |

## Local/manual checks

Use this section for machine-local smoke testing. Mark each item with the OS, hardware, and whether the check was actually performed.

### 1. Web Preview dummy mode

- [ ] Run `pnpm dev:web`.
- [ ] Open `http://localhost:5173/?source=dummy`.
- [ ] Confirm the avatar preview animates using dummy MotionFrame data.
- [ ] Confirm no native tracker, webcam, or OS camera permission is required for dummy mode.

### 2. Native tracker build

- [ ] Run `cmake -S native/tracker-core -B native/tracker-core/build`.
- [ ] Run `cmake --build native/tracker-core/build`.
- [ ] Record whether CMake found OpenCV. If OpenCV is unavailable, continue with dummy pipeline checks and mark OpenCV camera checks as not run.

### 3. Native dummy pipeline

- [ ] Run `node tools/check-native-tracker-output.mjs native/tracker-core/build/lvk-tracker-core`.
- [ ] For an end-to-end local bridge smoke, run the native dummy tracker through the development bridge:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source dummy --continuous --realtime --log-pipeline-status --pipeline-status-interval 60 | node tools/motion-ws-bridge.mjs
```

- [ ] Open `http://localhost:5173/?source=native` while `pnpm dev:web` is running.
- [ ] Confirm the Web Preview receives MotionFrame data through `ws://127.0.0.1:45731/motion`.
- [ ] Confirm only MotionFrame JSON is piped to the bridge; raw camera frames are not piped, printed, uploaded, or written by this path.

### 4. MotionFrame bridge smoke path

- [ ] Run `pnpm test:motion-ws-bridge`.
- [ ] Confirm the bridge binds to localhost for development (`127.0.0.1:45731`) and broadcasts validated MotionFrame JSON to native-source previews.
- [ ] Confirm this smoke path does not add or require new MotionFrame fields.

### 5. Electron desktop startup

This is a local/manual check because Electron requires a graphical desktop session.

- [ ] Build the native tracker first if testing Electron-started native pipeline controls.
- [ ] Run `pnpm dev:web` in one terminal.
- [ ] Run `pnpm dev:desktop` in another terminal.
- [ ] Confirm the Electron window opens.
- [ ] Confirm native pipeline controls can start/stop the current development native pipeline or report a clear local error.
- [ ] Confirm the preview URLs shown by Electron remain local, including `http://localhost:5173/?source=native` and `http://localhost:5173/?mode=obs&source=native`.

### 6. OpenCV camera pipeline when available

This is a local/manual check because it requires local OpenCV support, a webcam, and OS camera permission.

Use [`docs/reports/opencv-camera-smoke-template.md`](./reports/opencv-camera-smoke-template.md) when recording future OpenCV camera smoke results.

- [ ] Confirm CMake found OpenCV during native configure.
- [ ] On Windows OpenCV-enabled builds that dynamically link against vcpkg OpenCV, confirm the relevant vcpkg OpenCV DLL directory is available on `PATH` before running native runtime commands. Placeholder examples: `<vcpkg-root>/installed/x64-windows/bin` for release builds or `<vcpkg-root>/installed/x64-windows/debug/bin` for debug builds. If this runtime DLL path is missing, the native binary can fail to start with `STATUS_DLL_NOT_FOUND` / `0xC0000135`. This can affect `--print-runtime-capabilities`, `pnpm smoke:native-opencv-camera:local`, and `pnpm test` when the tested native binary is OpenCV-enabled and dynamically linked.
- [ ] Do not commit local absolute vcpkg paths to docs, PR bodies, reports, logs, or source comments; use placeholders such as `<vcpkg-root>/installed/x64-windows/bin` instead.
- [ ] Confirm the OS grants camera permission to the terminal or Electron host process being tested.
- [ ] Run a finite local camera smoke only when a webcam is available. Use the helper script (which first checks `--print-runtime-capabilities` and skips honestly when OpenCV is unavailable):

```bash
node tools/check-native-opencv-camera-smoke.mjs
# or with an explicit binary path:
node tools/check-native-opencv-camera-smoke.mjs native/tracker-core/build/lvk-tracker-core
# or via the package script:
pnpm smoke:native-opencv-camera:local
```

Alternatively, run the raw smoke command directly:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --frames 3 --log-camera-status
```

- [ ] If validating browser preview with OpenCV-backed frames, run:

```bash
./native/tracker-core/build/lvk-tracker-core --camera-source opencv --camera-index 0 --continuous --realtime --log-pipeline-status --pipeline-status-interval 60 --log-camera-status --camera-status-interval 60 | node tools/motion-ws-bridge.mjs
```

- [ ] Open `http://localhost:5173/?source=native` while `pnpm dev:web` is running.
- [ ] Confirm MotionFrame output reaches the preview.
- [ ] Confirm raw image data remains inside Native Core memory and is not printed to stdout/stderr, written to disk, uploaded, or sent to external servers.

### Native runtime staging for packaged builds (local prep)

This stages the required Windows x64 **release** OpenCV runtime DLLs into the git-ignored `.lvk-native-runtime/bin/` directory so that Electron packaging (`extraResources`) and the later packaged runtime smoke PR have a verified set of DLLs to copy and check. It is local prep only and does not perform packaged runtime smoke.

The authoritative release manifest lives at `native/tracker-core/manifests/opencv-runtime-windows-x64-release.json` and lists the verified static transitive runtime DLL set for the current Windows x64 Release OpenCV-enabled Native Core build: the 4 direct OpenCV modules (`core`, `imgproc`, `videoio`, `objdetect`), 5 additional OpenCV transitive modules (`imgcodecs`, `dnn`, `calib3d`, `features2d`, `flann`), and 12 non-OpenCV vcpkg runtime DLLs (`z`, `jpeg62`, `libpng16`, `tiff`, `liblzma`, `libwebp`, `libwebpdecoder`, `libwebpdemux`, `libwebpmux`, `libsharpyuv`, `libprotobuf`, `abseil_dll`). Windows platform DLLs are not included. VC++ redistributable DLLs remain a separate packaging decision.

- [ ] Copy the manifest-listed release DLLs from the local vcpkg OpenCV bin into the staging directory. Use the `<vcpkg-root>` placeholder; do not commit a local absolute path.

```bash
pnpm copy:opencv-runtime-dlls:local -- \
  --manifest native/tracker-core/manifests/opencv-runtime-windows-x64-release.json \
  --source-dir <vcpkg-root>/installed/x64-windows/bin \
  --dest-dir .lvk-native-runtime/bin
```

- [ ] Verify the staged DLLs satisfy the manifest. This script already targets the manifest path and `--dest-dir .lvk-native-runtime/bin`:

```bash
pnpm prep:native-runtime:verify:local
```

- [ ] Confirm `.lvk-native-runtime/` is **not** committed (it is git-ignored). Do not commit actual DLLs, native binaries, build artifacts, or local absolute paths.
- [ ] The manifest now covers the full verified static transitive runtime DLL set from the 2026-06-27 dependency inspection report. Re-run packaged runtime smoke after staging to confirm the expanded manifest resolves the `STATUS_DLL_NOT_FOUND` failure recorded in [`docs/reports/packaged-native-runtime-smoke-2026-06-27.md`](./reports/packaged-native-runtime-smoke-2026-06-27.md). Clean-machine VC++ redistributable independence is not yet proven. Do not claim packaged runtime smoke or clean-machine independence until those are explicitly validated. See [`docs/WINDOWS_VC_REDIST_STRATEGY.md`](./WINDOWS_VC_REDIST_STRATEGY.md) for the VC++ redistributable handling strategy and follow-up clean-machine validation checklist.

### 7. OBS Browser Source preview URL

This is a local/manual check because it requires OBS or equivalent browser-source validation.

- [ ] Run `pnpm dev:web`.
- [ ] Start the native dummy or OpenCV-backed bridge path.
- [ ] Add an OBS Browser Source that points to `http://localhost:5173/?mode=obs&source=native`.
- [ ] Confirm the OBS-friendly layout renders and updates from local MotionFrame transport.
- [ ] Confirm OBS is pointed at a local URL and does not require raw camera frame upload.

### 8. Local-first privacy confirmation

- [ ] Confirm Web Preview dummy mode uses generated MotionFrame values only.
- [ ] Confirm native dummy mode emits MotionFrame JSON only.
- [ ] Confirm the MotionFrame bridge receives newline-delimited MotionFrame JSON on stdin and serves previews over localhost.
- [ ] Confirm OpenCV camera checks, when run, keep raw camera frames local to Native Core memory.
- [ ] Confirm no check requires telemetry, analytics, cloud upload, remote camera processing, or new external network behavior.

## Reporting template

Use this template when recording a verification pass:

```txt
Environment:
- OS:
- Node/pnpm:
- CMake:
- OpenCV found by CMake: yes/no/not checked
- Webcam available: yes/no/not checked
- OS camera permission granted: yes/no/not checked
- OBS checked: yes/no/not checked

Automated checks:
- pnpm install:
- pnpm format:check:
- pnpm build:
- pnpm typecheck:
- pnpm test:
- pnpm lint:
- cmake -S native/tracker-core -B native/tracker-core/build:
- cmake --build native/tracker-core/build:
- node tools/check-native-tracker-output.mjs native/tracker-core/build/lvk-tracker-core:
- pnpm test:motion-ws-bridge:

Local/manual checks:
- Web Preview dummy mode:
- Web Preview native mode:
- Electron desktop startup:
- Native dummy pipeline:
- OpenCV camera pipeline:
- MotionFrame bridge smoke path:
- OBS Browser Source preview URL:
- Raw camera frames stayed local:

Notes / unresolved items:
-
```
