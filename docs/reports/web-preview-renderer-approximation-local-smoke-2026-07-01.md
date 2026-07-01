# Web Preview Renderer Approximation Local Smoke - 2026-07-01

## Summary

This report records owner-performed local manual validation after PR #388, `feat: add Web Preview renderer idle approximation`, was merged.

PR #388 is a Web Preview renderer-side cosmetic approximation only. It makes neutral eye, gaze, and mouth values feel less static in the renderer, but it does not implement real eye tracking, mouth tracking, expression tracking, facial landmarks, or new Native Core tracking capability.

The owner confirmed that packaged Electron + OpenCV + Web Preview native frames launched successfully, Web Preview received native MotionFrames, and the avatar moved. The owner also observed that wide mouth movement could make OpenCV face tracking flicker to lost, causing visible position jumps between detected pose and neutral center fallback.

## Scope

In scope:

- Owner-performed local manual smoke after PR #388.
- Web Preview renderer-side idle approximation behavior with native MotionFrames.
- Packaged Electron + OpenCV native tracker + local Motion bridge + Web Preview native source.
- Documentation of observed limitations and the recommended next implementation slice.

Out of scope:

- Source code changes.
- Web Preview implementation changes.
- Native Core changes.
- Electron changes.
- `packages/motion-protocol` changes.
- MotionFrame schema changes.
- Dependency, model file, runtime download, telemetry, analytics, cloud upload, or network behavior changes.
- Runtime GUI/webcam/Electron/OpenCV validation by Codex.

## Preconditions

- PR #388 was already merged.
- The owner used a local machine with packaged Electron, OpenCV camera access, and a local Haar cascade XML file.
- `LVK_FACE_CASCADE_PATH` was set to `<local-haar-cascade-xml>`.
- The packaged desktop entrypoint was `<packaged-desktop-exe>`.
- The repository root is represented as `<repo-root>`.
- Local absolute paths are intentionally omitted.

## Commands / Setup

Owner-performed setup and smoke notes:

- `pnpm --filter @lvk/web-preview build` succeeded.
- The build emitted the existing large chunk warning; this was not treated as a blocker for this documentation-only report.
- `pnpm dev:web` initially failed because port `5173` was already in use.
- The owner identified a listening process on `127.0.0.1:5173`, stopped it, and restarted Web Preview successfully.
- Web Preview loaded successfully at `http://127.0.0.1:5173/`.
- Before packaged Electron / native bridge was running, `source=native&debug=motion` showed the expected retry/fallback state:
  - `Source: Native localhost · Bridge disconnected · Retrying`
  - `Frames received: 0`
  - `tracking.status: no_frame`
  - `latest frame age: no frame yet`
- The owner launched packaged Electron with `LVK_FACE_CASCADE_PATH=<local-haar-cascade-xml>`.

Codex did not run local GUI, webcam, packaged Electron, or OpenCV runtime checks for this report.

## Observed Results

The owner observed Electron runtime status:

- Native tracker: `Running`.
- Motion bridge: `Running`.
- Camera source: `OpenCV camera`.
- MotionFrame endpoint: `ws://127.0.0.1:45731/motion`.

The owner observed Web Preview native source status:

- `Source: Native localhost · Receiving native frames`.
- Connection: `connected`.
- Frames received increased over time.
- Latest frame age was around `0 ms`.
- Native MotionFrames were received over `ws://127.0.0.1:45731/motion`.

The owner confirmed the avatar was moving with native frames.

## Confirmed Behavior

- Packaged Electron + OpenCV + Web Preview native path launched successfully in the owner's local environment.
- Native tracker and Motion bridge reached `Running`.
- Web Preview received native MotionFrames over `ws://127.0.0.1:45731/motion`.
- The avatar moved while native frames were being received.
- The PR #388 renderer-side idle approximation made the avatar appear less static when incoming eye, gaze, and mouth values were neutral.
- The approximation remained cosmetic renderer behavior only and was not linked to the user's real facial expression.

## Known Limitations

- PR #388 does not implement real eye, mouth, expression, or landmark tracking.
- Eye, mouth, and expression motion still do not link to the user's real facial expression.
- When the owner opened their mouth widely, the OpenCV detector appeared to flicker between tracking and lost.
- During that tracking/lost flicker, avatar position could jump between the detected pose and the neutral/center fallback.
- This report does not claim full facial expression tracking, eye tracking, mouth tracking, or landmark tracking exists.
- This report does not claim Codex performed local GUI/webcam/Electron/OpenCV validation.

## Recommended Follow-up

The recommended next implementation PR is Web Preview native lost-pose fallback stabilization:

- Keep the last valid tracking pose longer during short `tracking` / `lost` flicker.
- Avoid snapping `rootPosition` back to neutral too quickly.
- Keep the fix Web Preview-only.
- Do not change MotionFrame, Native Core, Electron, dependencies, model files, runtime downloads, or network behavior for this follow-up slice.

## Privacy / Local-First Notes

- Raw camera frames stayed local to the owner's machine and OpenCV/native runtime path.
- Web Preview consumed local MotionFrame JSON from `ws://127.0.0.1:45731/motion`.
- No screenshots are included.
- No local absolute paths are included.
- The local Haar cascade XML path is not included.
- This documentation-only report adds no telemetry, analytics, cloud upload, external frame processing, hidden network calls, runtime downloads, model files, dependencies, or new network behavior.

## Validation Ownership

This was owner-performed local manual validation. Codex recorded the report only.

Codex did not perform this local GUI/webcam/Electron/OpenCV validation and did not run packaged Electron, OpenCV camera, webcam, or Windows GUI checks.
