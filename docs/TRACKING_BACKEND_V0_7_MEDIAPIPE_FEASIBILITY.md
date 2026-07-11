# v0.7.0 MediaPipe Local Feasibility Route Decision

## Status

- Docs-only decision for #480.
- No dependency, model/task asset, runtime package, runtime download, or production backend is approved.
- No `MotionFrame` or Motion Protocol change is approved.
- No source or runtime behavior change is made or approved.
- The current `mediapipe-face-landmarker` scaffold remains unsupported and fail-closed unless a later scoped PR changes it.

## Context

v0.6.0 selected MediaPipe Face Landmarker as the first local candidate feasibility route after OpenCV Haar was recorded as a smoke/baseline path rather than a product-quality tracking backend.

#471 added a no-dependency, fail-closed MediaPipe Face Landmarker candidate scaffold behind the Native Core `TrackingBackend` boundary. The default remains `face-pipeline`; `LVK_HAS_MEDIAPIPE_FACE_LANDMARKER` defaults to `0`; runtime capabilities report `mediapipeFaceLandmarkerSupport=false`; and unsupported `mediapipe-face-landmarker` selection fails before camera open and before `MotionFrame` stdout emission.

#472 added MotionFrame compatibility evidence for the default path and explicit `face-pipeline` behavior, and it confirmed the unsupported MediaPipe scaffold emits no MotionFrame stdout.

v0.7.0 must decide whether #481 can safely perform a build feasibility probe before any MediaPipe dependency, model, task asset, runtime package, or runtime download is added.

## Official source findings

| Area                           | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Decision impact                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Face Landmarker capabilities   | The official Face Landmarker overview says the task targets images and videos and can output 3D face landmarks, blendshape scores, and facial transformation matrices. It also documents still image, decoded video frame, and live video feed inputs. Source: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker                                                                                                                                                                                | The task remains relevant to LVK's future local avatar tracking goals, but this does not approve inference or a production backend.                                                                 |
| Platform guide status          | The overview links official Face Landmarker implementation guides for Android, Python, and Web, and the navigation also exposes an iOS Face Landmarker guide. Sources: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/android, https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/python, https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js, https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/ios | No current official desktop/C++ Face Landmarker Tasks guide was found during this review. #481 must not assume a supported C++/CMake Tasks integration route exists.                                |
| MediaPipe Framework C++ status | Official framework C++ docs exist, including a desktop Hello World path that uses Bazel and framework graph concepts, plus C++ graph-building docs. Sources: https://developers.google.com/edge/mediapipe/framework/getting_started/hello_world_cpp, https://developers.google.com/edge/mediapipe/framework/framework_concepts/graphs_cpp                                                                                                                                                                                   | Framework C++ examples do not automatically prove a small LVK CMake integration path for the Face Landmarker Tasks API. Treat this as build feasibility risk, not as dependency approval.           |
| Model/task asset status        | The Face Landmarker overview documents a downloadable model bundle and model cards for face detection, face mesh, and blendshape prediction models. Source: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker                                                                                                                                                                                                                                                                                   | LVK must not commit, download, bundle, stage, or package task/model assets without separate explicit approval and redistribution review.                                                            |
| License status                 | The MediaPipe repository is Apache-2.0 licensed. The Face Landmarker docs page states page content is CC BY 4.0 and code samples are Apache 2.0. Sources: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE, https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker                                                                                                                                                                                                                    | Repository and docs/code sample licenses do not by themselves settle task/model bundle license, notice, or redistribution approval for LVK. Model/task assets need specific review before bundling. |
| Repository/build status        | The MediaPipe repository points developers to the Google developer documentation as the primary docs and includes Bazel-related repository files. Source: https://github.com/google-ai-edge/mediapipe                                                                                                                                                                                                                                                                                                                       | Packaging and dependency impact for LVK's C++/CMake Native Core is not yet proven. Any future probe must stay isolated and must not leak runtime dependencies into Electron or Web Preview.         |

## Route decision

Decision: do not add MediaPipe runtime or task/model assets in #481.

#481 may proceed only as a no-asset, no-runtime-download Native Core feasibility probe if it can be implemented as one of:

- docs-only implementation deferral with evidence;
- an isolated local build probe that does not add a required dependency to normal builds;
- an explicit unsupported/fail-closed capability check that leaves default builds unchanged.

If a safe isolated probe cannot be implemented without dependency churn, #481 should close as docs-only deferral and v0.7.0 should move to #482/#483 with honest evidence.

This decision does not approve a production backend, MediaPipe dependency for normal builds, model/task asset bundling, runtime downloads, inference, MotionFrame schema changes, Motion Protocol changes, or Electron/Web Preview runtime dependencies.

## Requirements for #481

#481 must:

- start by reading this decision note;
- remain behind Native Core boundaries;
- avoid required dependency changes to normal builds unless explicitly approved by this note;
- avoid model/task asset bundling;
- avoid runtime downloads;
- preserve existing dummy/noop, OpenCV baseline, and `face-pipeline` behavior;
- preserve `mediapipe-face-landmarker` fail-closed behavior unless the probe explicitly changes capability reporting;
- keep stdout clean for MotionFrame JSON paths;
- keep diagnostics on stderr;
- avoid MotionFrame and Motion Protocol changes;
- report unsupported and skipped paths honestly.

## Non-goals

v0.7.0 MediaPipe feasibility work does not include:

- production backend selection;
- MediaPipe dependency approval beyond the exact feasibility route above;
- model/task asset approval;
- runtime download approval;
- inference;
- MotionFrame or Motion Protocol changes;
- Electron or Web Preview backend runtime dependency;
- local/manual validation claims.

Do not claim MediaPipe inference, landmark output, blendshape output, face transformation output, webcam validation, OBS validation, Electron GUI validation, packaged Electron validation, hardware validation, or local/manual validation unless a future source-grounded evidence note records the exact validation that was performed.

## Follow-up

- #481 should use this route decision as input.
- #482 should add evidence for whatever #481 actually implements or defers.
- #483 should close v0.7.0 with release-readiness notes.

## Build feasibility probe entry (#481)

#481 records the current v0.7.0 build feasibility boundary:

- normal Native Core builds still do not add MediaPipe runtime, task/model assets, runtime packages, runtime downloads, or inference;
- the optional CMake probe option, `LVK_ENABLE_MEDIAPIPE_FACE_LANDMARKER_PROBE`, is disabled by default and fails fast at CMake configure time when enabled because #480 does not approve dependency or asset integration;
- the probe option does not call `find_package(MediaPipe)`, add MediaPipe includes/libraries/sources, or set `LVK_HAS_MEDIAPIPE_FACE_LANDMARKER=1`;
- `mediapipe-face-landmarker` remains unsupported/fail-closed at runtime; capability reporting and CLI behavior are unchanged;
- default `face-pipeline`, dummy/noop, and OpenCV baseline behavior remain unchanged.

## Feasibility boundary checker evidence (#482)

#482 adds automated evidence for the v0.7.0 MediaPipe build feasibility boundary:

- the CMake probe option remains disabled by default;
- enabling the probe is expected to fail at configure time with the explicit #480 non-approval message;
- the checker confirms no MediaPipe `find_package`, include, library, source, task/model asset, runtime download, inference, or production backend enablement is introduced by this boundary;
- existing runtime candidate and MotionFrame boundary checkers remain unchanged and compatible;
- environments without CMake may report an honest runtime-check skip only after static boundary checks pass.
