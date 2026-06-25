# Local Runtime Verification Report — 2026-06-26

## 1. Summary

This report records the completed local runtime verification pass for the LVK local-first dummy and native-dummy runtime flow on 2026-06-26.

The verified automated checks and local visual checks passed for the current dummy/native-dummy paths. OBS Browser Source and OpenCV camera validation were explicitly skipped because the local environment did not provide OBS validation, OpenCV camera support, webcam availability confirmation, or OS camera permission confirmation.

This report is documentation-only and does not change runtime behavior.

## 2. Environment

- OS: Windows 11 Pro 10.0.26200
- Node/pnpm: Node v24.16.0 / pnpm 11.5.0
- CMake: 4.3.3
- OpenCV found by CMake: no
- LVK OpenCV camera support: OFF
- LVK OpenCV face detector support: OFF
- Webcam available: not checked
- OS camera permission granted: not checked
- OBS checked: not checked

## 3. Automated Checks

- `pnpm install`: PASS, no lockfile changes
- `pnpm format:check`: PASS
- `pnpm build`: PASS
- `pnpm typecheck`: PASS
- `pnpm test`: PASS
- `pnpm lint`: PASS
- `cmake -S native/tracker-core -B native/tracker-core/build`: PASS, OpenCV OFF
- `cmake --build native/tracker-core/build`: PASS
- `node tools/check-native-tracker-output.mjs native/tracker-core/build/Debug/lvk-tracker-core.exe`: PASS, native tracker emitted 3 valid MotionFrame JSON lines
- `pnpm test:motion-ws-bridge`: PASS

## 4. Manual / Visual Checks

- Web Preview dummy mode: PASS
  - Confirmed `http://localhost:5173/?source=dummy`.
  - Confirmed local demo MotionFrame preview renders.
  - Confirmed the page states local preview only and no camera frames leave the device.
  - Confirmed no native tracker or camera permission is required for dummy mode.
- Electron desktop startup: PASS
  - Electron window opened.
  - Runtime panel rendered.
  - Runtime panel listed local preview URLs for dummy, native, and OBS-native paths.
- Electron native pipeline start: PASS
  - Start native pipeline moved Native tracker and Motion bridge to Running.
- Web Preview native mode: PASS
  - Native preview reported receiving native frames.
  - `emittedFrameCount=16200` was observed.
- Electron native pipeline stop: PASS
  - Stop native pipeline moved Native tracker and Motion bridge to Exited.
  - Port 45731 was confirmed closed.
  - Tracker PID was confirmed gone.
  - Chrome Web Preview detected bridge disconnect.
- Native dummy pipeline E2E: PASS through Electron-managed native pipeline and Web Preview native mode.
- MotionFrame bridge smoke path: PASS through automated bridge smoke and native preview confirmation.

## 5. Skipped Checks

- OBS Browser Source preview URL: SKIPPED, OBS not installed.
- OpenCV camera pipeline: SKIPPED, CMake reported OpenCV OFF and webcam availability was not checked.
- Webcam availability: not checked.
- OS camera permission: not checked.

## 6. Privacy / Local-First Confirmation

- Camera pipeline was not run.
- Dummy mode used local demo MotionFrame data.
- Native dummy output emitted MotionFrame JSON only.
- No raw camera frames were observed, printed, uploaded, or sent to external services in the verified dummy/native-dummy paths.
- No telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network behavior was added by this verification pass.

## 7. Non-blocking Warnings

- Web Preview build reported a pre-existing chunk size warning over 500 kB.
- Native build reported a pre-existing C4819 Unicode warning in `helper_process_supervisor.h`.
- Electron binary unpacking occurred under dependencies during local setup, but repository files were not changed.

## 8. Unresolved Items

- OBS Browser Source validation remains environment-dependent.
- OpenCV camera validation remains environment-dependent and requires local OpenCV support, a webcam, and OS camera permission.

## 9. Conclusion

The automated and local visual runtime paths required for the current local-first dummy/native-dummy runtime flow passed. OBS and OpenCV camera paths are not blockers for this pass because they were explicitly skipped due to local environment availability.
