# v0.6.0 Local Backend Candidate Route Decision

## Status

- Docs-only decision for the first v0.6.0 local backend candidate spike route.
- No backend is selected, approved, or shipped for production by this note.
- No dependency, model, task asset, cascade asset, runtime package, runtime download, generated artifact, or binary is added or approved by this note.
- No `MotionFrame` schema, Motion Protocol, Native Core runtime behavior, Electron behavior, or Web Preview behavior changes are made or approved by this note.

## Context

- v0.5.0 added the Native Core `TrackingBackend` / `FaceTrackingPipelineBackend` seam so future local candidates can be evaluated behind the Native Core boundary without changing CLI behavior or `MotionFrame` stdout JSON.
- #469 collected OpenCV cascade-backed baseline evidence in `docs/TRACKING_BACKEND_EVALUATION.md`: an OpenCV-enabled Native Core build was confirmed locally, a trusted local Haar cascade path was used, and cascade-backed smoke plus backend parity checkers passed against `--camera-source dummy` synthetic frames.
- OpenCV Haar remains a smoke/baseline path only. It is useful for dependency-aware detector wiring, diagnostics, fail-closed behavior, and boundary checks, but it is not product-quality VTuber tracking.
- The next step is to choose one narrow first candidate spike route for #471 without approving a production backend or adding runtime dependencies prematurely.

## Candidate comparison

| Candidate                    | Product-quality potential                                                                                                                                                                                                      | Local-first fit                                                                                                                                         | Dependency/build risk                                                                                                                                           | Model/task/asset handling                                                                                                                    | License/redistribution risk                                                                                                                                 | MotionFrame compatibility risk                                                                                                                                                   | Electron/Web Preview boundary risk                                                                      | Readiness for a small spike                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCV Haar continuation     | Low. Current evidence is rectangle-detection smoke/baseline only, with no landmarks, blink, mouth, expression, blendshape, or face-transform output.                                                                           | High for local smoke use when OpenCV and a trusted local cascade path are available.                                                                    | Already optional and dependency-aware, but local OpenCV setup varies by machine.                                                                                | Cascade XML must remain local and uncommitted unless separately reviewed and approved.                                                       | Existing docs require cascade source/license review before committing anything.                                                                             | Low for the existing smoke path because current checkers already protect MotionFrame stdout JSON shape, but low tracking richness limits future mapping value.                   | Low if it stays optional behind Native Core; not a reason to expand Electron/Web Preview.               | Ready only as a continued baseline, not as the first product-quality candidate spike.                                                                                                           |
| MediaPipe Face Landmarker    | High candidate potential for the next feasibility spike because official docs describe face landmarks, facial expression/blendshape scores, and facial transformation matrices for images, video frames, and live video feeds. | Plausible local-first fit if evaluated as an offline/local Native Core path with no upload, telemetry, runtime downloads, or external frame processing. | Medium/high. Native integration, task/runtime setup, binary size, platform support, and packaging need review before any dependency approval.                   | Requires identifying task/model bundle handling. No model/task file should be committed or downloaded at runtime unless separately approved. | MediaPipe repository license is Apache-2.0, but the exact task/model bundle license, notices, and redistribution plan still require review before bundling. | Medium. Outputs are richer than the current schema, so the spike must either map only to existing `MotionFrame` fields or stay diagnostic/no-output without changing the schema. | Medium if kept behind Native Core; unacceptable if runtime dependencies leak into Electron/Web Preview. | Best first candidate spike route because it directly targets landmarks, blendshapes, and transformation outputs relevant to VTuber tracking while matching the repo's existing candidate order. |
| ONNX Runtime + local model   | Potentially high, but entirely model-dependent; ONNX Runtime is a runtime, not a selected tracker by itself.                                                                                                                   | Plausible local-first fit once a specific local model and provider setup are chosen.                                                                    | Medium/high. Official C++ docs list CPU/GPU/package variants and the C++ API wrapper path, so provider/runtime setup and packaging must be chosen deliberately. | Cannot proceed safely without a concrete model, weights source, output tensors, preprocessing, postprocessing, and packaging plan.           | ONNX Runtime repository license is MIT, but model license, weights redistribution, notices, and provider/runtime redistribution still need separate review. | High until a model's outputs are mapped to current `MotionFrame` fields without schema changes or raw tensor IPC.                                                                | Medium if only Native Core owns the runtime; high if provider/runtime setup leaks into UI packages.     | Defer until a specific model candidate, license, redistribution plan, output mapping, and runtime/provider setup are identified.                                                                |
| Other local-only model route | Unknown until a concrete runtime/model is named.                                                                                                                                                                               | Must prove local-only operation and no runtime network behavior.                                                                                        | Unknown/high because toolchain, platform support, build size, and maintenance burden are not identified.                                                        | Unknown until the model/data assets and source are known.                                                                                    | Unknown until runtime and asset licenses are reviewed.                                                                                                      | Unknown/high until outputs are mapped to current `MotionFrame` fields.                                                                                                           | Unknown/high unless explicitly kept behind Native Core.                                                 | Not ready because it is less concrete than MediaPipe and lacks a reviewed first model/runtime candidate.                                                                                        |

## Decision

Recommend exactly one first candidate spike route for #471: **MediaPipe Face Landmarker local candidate feasibility spike behind the Native Core `TrackingBackend` boundary**.

This recommendation is only a first candidate spike route. It is **not** production backend selection, **not** dependency approval, **not** model/task asset approval, and **not** runtime download approval.

The source-grounded reason is narrow: existing LVK docs already list MediaPipe Face Landmarker as the first product-quality candidate to research and evaluate after OpenCV Haar baseline evidence, and the current official Face Landmarker documentation describes outputs that line up with future VTuber tracking needs: 3D face landmarks, blendshape/expression scores, and facial transformation matrices. That makes it the most practical next feasibility route to test behind the already-established Native Core boundary.

## Why not OpenCV Haar as the candidate

The OpenCV cascade-backed baseline evidence is useful, especially for optional detector wiring, local diagnostics, fail-closed behavior, and MotionFrame stdout parity checks. However, Haar rectangle detection is not product-quality VTuber tracking.

OpenCV Haar lacks the landmark, blink, mouth, expression, blendshape, and face transformation coverage needed for the intended tracking path. Continuing Haar as the main candidate would mostly extend smoke coverage rather than answer whether LVK can produce higher-quality face tracking signals for avatar motion.

## Why defer ONNX Runtime

ONNX Runtime remains a plausible local runtime path. The official C++ documentation confirms C++ usage paths and multiple package/provider choices, and the ONNX Runtime repository license is MIT.

However, ONNX Runtime alone does not choose a tracker. A safe implementation requires a specific local model candidate, model license, weights redistribution plan, preprocessing/postprocessing plan, output-to-`MotionFrame` mapping, package/provider choice, native build setup, and packaging strategy. Until those are identified, ONNX Runtime has too many unresolved model and redistribution variables for the first small spike.

Therefore ONNX Runtime should be deferred until a concrete model candidate is identified and reviewed.

## Spike guardrails for #471

The recommended #471 implementation issue should:

- stay behind the Native Core `TrackingBackend` boundary;
- keep the dummy/noop and OpenCV baseline paths intact;
- avoid `MotionFrame` schema changes and Motion Protocol changes;
- avoid Electron and Web Preview runtime dependencies;
- avoid committing model files, task files, cascade files, raw frames, generated artifacts, binaries, or build outputs unless separately approved;
- avoid runtime downloads;
- avoid telemetry, analytics, cloud upload, remote inference, external frame processing, hidden network behavior, raw frame IPC, pixel IPC, or tensor IPC;
- emit `MotionFrame`-compatible stdout JSON, or explicitly stay in a no-output/diagnostic feasibility mode if mapping is not yet safe;
- keep diagnostics on stderr and stdout reserved for `MotionFrame` JSON when stdout is used;
- report unsupported, unavailable, skipped, or not-validated paths honestly;
- avoid claiming webcam, OBS, Electron GUI, packaged Electron, hardware, or local/manual validation unless actually performed and recorded.

## Evidence and sources

- LVK #469 evidence and current candidate order: `docs/TRACKING_BACKEND_EVALUATION.md`.
- Native Core boundary evidence: `docs/releases/v0.5.0.md` and the current `TrackingBackend` source seam in `native/tracker-core/src/tracking_backend.h`.
- MotionFrame compatibility boundary: `docs/MOTION_PROTOCOL.md` and `tools/check-native-backend-parity-motionframe.mjs`.
- Official MediaPipe Face Landmarker documentation: <https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker>.
- MediaPipe repository license: <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>.
- ONNX Runtime C++ documentation: <https://onnxruntime.ai/docs/get-started/with-cpp.html>.
- ONNX Runtime repository license: <https://github.com/microsoft/onnxruntime/blob/main/LICENSE>.

## Follow-up

- #471 should use this route decision as input for the first MediaPipe Face Landmarker local candidate feasibility spike.
- #472 should add or adjust MotionFrame compatibility evidence after the spike, based on what the spike actually implements or intentionally skips.

## Implementation entry (#471)

#471 implemented a no-dependency, fail-closed MediaPipe Face Landmarker candidate scaffold behind the Native Core `TrackingBackend` boundary:

- Added `--tracking-backend face-pipeline|mediapipe-face-landmarker` (default `face-pipeline`, preserving current behavior).
- Added compile-time `LVK_HAS_MEDIAPIPE_FACE_LANDMARKER` (default `0`) and runtime capability fields `mediapipeFaceLandmarkerSupport=false` / `supportedTrackingBackends=face-pipeline`.
- Selecting `mediapipe-face-landmarker` in this build fails closed with a clear stderr message before any camera source is opened or `MotionFrame` JSON is emitted.
- No MediaPipe dependency, task/model file, runtime package, or runtime download was added. No production backend was selected.
- Added `tools/check-native-mediapipe-candidate-boundary.mjs` (`pnpm test:native-mediapipe-candidate-boundary`) for focused checker coverage of the unsupported/fail-closed path.

#472 should build MotionFrame compatibility evidence on top of this scaffold.
