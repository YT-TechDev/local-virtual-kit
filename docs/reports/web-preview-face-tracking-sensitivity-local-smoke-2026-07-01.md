# Web Preview Face Tracking Sensitivity Local Smoke - 2026-07-01

## Summary

This report records owner-performed local manual validation after PR #385, `feat: tune Web Preview face tracking sensitivity`, was merged.

The owner observed that Web Preview received native MotionFrame data from the packaged Electron / OpenCV path and that avatar movement followed the camera/person face position. The owner noted that face position tracking looked good for the current OpenCV phase.

This confirms the current face-position tracking path, not full facial expression tracking.

## Scope

- Web Preview mapping sensitivity after PR #385.
- Packaged Electron launch through the unpacked desktop executable.
- OpenCV-backed native tracker feeding the local MotionFrame bridge.
- Web Preview native-source rendering at `http://localhost:5173/?source=native`.

Out of scope for this report:

- MotionFrame schema changes.
- Motion Protocol changes.
- Native Core changes.
- Electron runtime behavior changes.
- New dependencies or runtime downloads.
- Full facial landmark, eye, mouth, or expression tracking validation.

## Environment

- Validation type: Owner-performed local manual validation.
- Platform: Windows local desktop environment.
- Packaged Electron entrypoint: `<packaged-desktop-exe>`.
- Native camera source: OpenCV camera.
- Face cascade setting: `LVK_FACE_CASCADE_PATH=<local-haar-cascade-xml>`.
- Web Preview URL: `http://localhost:5173/?source=native`.
- MotionFrame endpoint observed by Electron and Web Preview: `ws://127.0.0.1:45731/motion`.

Local absolute paths are intentionally omitted and represented with placeholders.

## Preconditions

- PR #385 was already merged.
- The packaged Electron application was available locally.
- OpenCV camera access was available in the owner's local environment.
- `LVK_FACE_CASCADE_PATH` initially pointed to a placeholder path and failed.
- The owner searched locally for `haarcascade_frontalface_default.xml` and then set `LVK_FACE_CASCADE_PATH` to a real local Haar cascade XML file.

## Steps Performed

1. The owner launched packaged Electron via the unpacked `<packaged-desktop-exe>`.
2. The owner observed the initial `LVK_FACE_CASCADE_PATH` placeholder failure.
3. The owner located a real local `haarcascade_frontalface_default.xml` file.
4. The owner set `LVK_FACE_CASCADE_PATH` to `<local-haar-cascade-xml>`.
5. The owner started the native OpenCV camera path from the packaged Electron UI.
6. The owner opened Web Preview at `http://localhost:5173/?source=native`.
7. The owner observed the avatar while moving the camera/person face position.

## Observed Results

The owner observed the packaged Electron UI reporting:

- Native tracker: `Running`.
- Motion bridge: `Running`.
- Camera source: `OpenCV camera`.
- MotionFrame endpoint: `ws://127.0.0.1:45731/motion`.

The owner observed Web Preview reporting:

- Source: Native localhost.
- Native frames were being received.
- Frames received increased over time.
- Local MotionFrame endpoint: `ws://127.0.0.1:45731/motion`.

The owner observed that avatar movement followed the camera/person face position. The owner noted that face position tracking looked good for the current OpenCV phase.

## Limitations

- Eye, mouth, and expression movement remained weak or limited.
- This limitation is expected because the current OpenCV path mainly uses face detection / bounding box information to drive `face.position.x/y/z`.
- This confirms the current face-position tracking path, not full facial expression tracking.
- This report does not claim that OpenCV expression tracking, eye tracking, mouth tracking, or full facial landmark tracking is complete.
- Codex did not perform this local GUI/webcam validation.

## Privacy / Local-First Confirmation

- No raw camera frame upload or external frame processing was introduced or observed.
- Raw camera frames stay local to the owner's machine and Native Core/OpenCV runtime path.
- Web Preview consumed local MotionFrame data from `ws://127.0.0.1:45731/motion`.
- No telemetry, analytics, cloud upload, hidden network calls, runtime downloads, or new network behavior are recorded by this documentation-only report.
- No screenshots, local logs, cascade XML files, binaries, build artifacts, or local absolute paths are included.

## Validation Ownership

This was owner-performed local manual validation. Codex did not perform this local GUI/webcam validation and did not run packaged Electron, OpenCV camera, webcam, or Windows GUI checks.
