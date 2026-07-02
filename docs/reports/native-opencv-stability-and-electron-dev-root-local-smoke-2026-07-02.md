# Native OpenCV Stability and Electron Dev Root Local Smoke - 2026-07-02

## Summary

This report records owner-performed local smoke validation covering PR #391, PR #392, and PR #393.

- Native Core OpenCV diagnostics showed `resultSource=fresh`, `resultSource=held`, and `resultSource=none`.
- The mouth-open position jump in Web Preview behavior was improved/fixed during the owner local smoke.
- Electron dev native runtime root resolution no longer requires copying the native tracker into `apps/desktop/native/...`.
- This was local-only validation.

## Scope

In scope:

- Native Core OpenCV face detection stabilization validation.
- Native Core face detection diagnostics validation.
- Electron dev native runtime root-resolution validation.
- Web Preview native MotionFrame behavior observation.

Out of scope:

- Packaged Electron validation.
- Real eye tracking.
- Real mouth tracking.
- Expression tracking.
- Landmark tracking.
- MotionFrame schema changes.
- Motion Protocol changes.
- Cloud, network, or telemetry behavior.

## Environment

- Windows local development environment.
- Native Core OpenCV-enabled build.
- Local Haar cascade XML via `LVK_FACE_CASCADE_PATH=<local-haar-cascade-xml>`.
- Local OpenCV/vcpkg runtime DLLs made available to the Native Core executable.
- Web Preview native source URL: `http://127.0.0.1:5173/?source=native&debug=motion`.
- Motion endpoint: `ws://127.0.0.1:45731/motion`.

Local absolute paths, user-specific folder paths, screenshots, local cascade paths, and local DLL paths are intentionally omitted.

## Commands / Checks

Representative owner-performed commands and checks, with local paths replaced by placeholders:

- `git checkout main`
- `git pull --ff-only origin main`
- `cmake -S native/tracker-core -B native/tracker-core/build`
- `cmake --build native/tracker-core/build --target lvk-tracker-core`
- `lvk-tracker-core --print-runtime-capabilities`
- `lvk-tracker-core --frames 3 --camera-source dummy --face-detector noop --log-face-status --face-status-interval 1`
- `lvk-tracker-core --frames 600 --realtime --camera-source opencv --face-detector opencv --face-cascade <local-haar-cascade-xml> --log-camera-status --log-face-status --face-status-interval 1`
- `pnpm dev:web`
- `pnpm dev:desktop`

## Observed Results

- Native runtime capabilities exited with code `0`.
- OpenCV camera support and face detector support were available:
  - `opencvCameraSupport=true`
  - `opencvFaceDetectorSupport=true`
  - `supportedCameraSources=dummy,opencv`
  - `supportedFaceDetectors=noop,opencv`
  - `localOnly=true`
- The initial `STATUS_DLL_NOT_FOUND` / exit code `-1073741515` failure was resolved by making local OpenCV/vcpkg runtime DLLs available to the Native Core executable. This was a local runtime setup issue, not an application privacy or network issue.
- Dummy/noop diagnostics exited with code `0`, produced `resultSource=none`, and wrote non-empty MotionFrame and diagnostics output files.
- OpenCV camera diagnostics exited with code `0`, wrote non-empty MotionFrame and diagnostics output files, and produced:
  - `resultSource=fresh`
  - `resultSource=held`
  - `resultSource=none`
- Web Preview received native MotionFrames during the local test.
- Before PR #391 and PR #392, opening the mouth widely could cause the avatar position to jump sharply. After the Native Core OpenCV stabilization, the owner observed that the mouth-open position jump was improved/fixed in Web Preview behavior.
- Remaining limitation: motion still appears angular/blocky.
- Electron dev root resolution was validated after PR #393 by removing the manual `apps/desktop/native/...` workaround and confirming the dev launch path no longer required that copy.

## Privacy / Local-first Notes

- Camera frames stayed local.
- MotionFrame data stayed local over localhost.
- No cloud upload.
- No telemetry.
- No analytics.
- No external frame processing.
- No new network behavior.
- No local absolute paths or screenshots are included in this report.

## Known Limitations

- This is still OpenCV Haar-style face detection, not real landmark tracking.
- Eye, mouth, and expression channels are still not real tracked expression channels.
- Movement can still appear angular/blocky.
- Packaged Electron was not validated in this report.
- Local runtime DLL availability is still a local setup concern for manual native runtime testing.

## Follow-ups

- Add Web Preview / avatar smoothing or interpolation to reduce angular movement.
- Keep future tracking improvements local-first.
- Consider a future separate task to improve dev runtime setup ergonomics if needed.
