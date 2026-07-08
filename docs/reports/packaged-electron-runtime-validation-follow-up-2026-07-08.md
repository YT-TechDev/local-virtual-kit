# Packaged Electron Runtime Validation Follow-up — 2026-07-08

Follow-up for #401 (parent roadmap #397). Scope: identify and, where possible,
execute the smallest safe packaged Electron runtime validation path for the
post-v0.2.0 / v0.3.0 path, without changing default runtime behavior.

## Environment

- OS: Windows 11 Pro x64 (10.0.26200)
- Node.js: v24.16.0 / pnpm 11.5.0
- CMake: 4.3.3
- Repository HEAD: `e7308fe` ("test: add helper runtime bounded oversized stdout line guard (#424)")
- Electron: 39.8.10 / electron-builder 26.8.1
- Webcam available: not checked (this pass used dummy-mode/process smoke only)
- OBS checked: no

## Finding: staged native runtime binary was stale

`.lvk-native-runtime/bin/lvk-tracker-core.exe` (the local, git-ignored staging
directory used by `extraResources` in `apps/desktop/electron-builder.yml`) was
built 2026-06-27, before the H2 helper-runtime guard work merged into `main`
through 2026-07-08 (e.g. malformed/unknown/oversized stdout line guards,
`helper_runtime_smoke.cpp`). Packaging with the stale binary would validate an
outdated Native Core, not the current `main`.

This is a local staging/prep gap, not a source bug. No source files were
changed. Fix applied locally only (git-ignored, nothing committed):

```bash
cmake --build native/tracker-core/build --config Release
cp native/tracker-core/build/Release/lvk-tracker-core.exe .lvk-native-runtime/bin/lvk-tracker-core.exe
pnpm prep:native-runtime:verify:local
```

## Automated checks performed

| Check                                       | Command                                                                                                                       | Result                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting                                  | `pnpm format:check`                                                                                                           | Pass                                                                                                                                          |
| MotionFrame validator import smoke          | `pnpm test:motion-validator-import`                                                                                           | Pass                                                                                                                                          |
| Native configure/build (Release, refreshed) | `cmake --build native/tracker-core/build --config Release`                                                                    | Pass                                                                                                                                          |
| Native dummy output smoke (fresh build)     | `node tools/check-native-tracker-output.mjs native/tracker-core/build/Release/lvk-tracker-core.exe`                           | Pass — 3 valid MotionFrame JSON lines                                                                                                         |
| Native runtime staging verify               | `pnpm prep:native-runtime:verify:local`                                                                                       | Pass — all 21 required DLLs present                                                                                                           |
| Packaged build (unpacked)                   | `cd apps/desktop && npm run build:unpack` (typecheck + `electron-vite build` + `electron-builder --dir`)                      | Pass — produced `apps/desktop/dist/win-unpacked/`                                                                                             |
| Packaged tracker binary dummy smoke         | `node tools/check-native-tracker-output.mjs apps/desktop/dist/win-unpacked/resources/native-runtime/bin/lvk-tracker-core.exe` | Pass — 3 valid MotionFrame JSON lines, confirms the packaged exe resolves its co-located DLLs outside the dev tree                            |
| Packaged app process launch smoke           | Launched `apps/desktop/dist/win-unpacked/desktoplvk.exe` directly, observed process list, then terminated via `taskkill`      | Pass — 4 `desktoplvk.exe` processes (main + Electron helper processes) stayed alive for several seconds with no crash; all terminated cleanly |

`dist/` and `.lvk-native-runtime/` remain git-ignored; no build artifacts, binaries, or DLLs are committed by this change.

## Not validated in this session (explicitly not claimed)

- No GUI window was visually observed. This session has no screen/visual observation capability, so the packaged app's rendered UI was not confirmed.
- Native pipeline start/stop through the Electron UI was not exercised in this pass.
- MotionFrame delivery through the in-process WebSocket bridge while packaged was not exercised in this pass.
- Web Preview / OBS Browser Source visual rendering against the packaged app was not exercised in this pass.
- OpenCV camera capture (real webcam) was not exercised in this pass.
- Clean-machine / VC++ redistributable independence remains unvalidated (see `docs/WINDOWS_VC_REDIST_STRATEGY.md`).

The most recent full owner-performed packaged GUI native-pipeline validation is
`docs/reports/packaged-electron-gui-native-pipeline-validation-2026-06-30.md`
(native pipeline start/stop, MotionFrame receipt, clean stop) and
`docs/reports/packaged-electron-native-visual-output-validation-2026-06-30.md`
(browser/OBS visual observation). Both predate the H2 helper-runtime guard
commits merged through 2026-07-08. Because Native Core's helper-process
behavior changed since that pass, the owner should re-run the in-app
native-pipeline start/stop and visual observation steps against the current
`main` before treating packaged Electron validation as current.

## Smallest next local validation command sequence (for the project owner)

```bash
# 1. Rebuild native tracker-core with the current source
cmake --build native/tracker-core/build --config Release

# 2. Refresh the local (git-ignored) staged runtime binary
cp native/tracker-core/build/Release/lvk-tracker-core.exe .lvk-native-runtime/bin/lvk-tracker-core.exe
pnpm prep:native-runtime:verify:local

# 3. Package the desktop app (unpacked, no installer)
cd apps/desktop
npm run build:unpack

# 4. Launch the packaged app and observe manually
./dist/win-unpacked/desktoplvk.exe
# In another terminal, start the Web Preview dev server for visual confirmation:
pnpm dev:web
# Then, in the packaged app UI: start the native pipeline (camera-source=dummy or opencv),
# confirm http://localhost:5173/?source=native receives frames, and stop the pipeline cleanly.
```

## Summary

- No production/runtime behavior changed. No dependency, schema, or Motion Protocol change.
- Local native runtime staging was refreshed to match current `main` (git-ignored, not committed).
- Packaging itself, the packaged tracker binary in isolation, and packaged-app process launch/exit are confirmed working on this machine.
- Full in-app native-pipeline GUI validation and browser/OBS visual observation against the _current_ `main` remain owner-performed manual follow-ups; the last such report predates the H2 helper-runtime guard work.
- #400 (next local tracking backend prototype) remains open and out of scope for this validation-only follow-up.
