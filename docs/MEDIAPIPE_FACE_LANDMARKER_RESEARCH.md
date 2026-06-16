# MediaPipe Face Landmarker Official Research Memo

## Status

MediaPipe Face Landmarker is a promising product-quality tracking candidate for LVK, but it is not selected yet.

This memo is research-only. It does not approve adding MediaPipe dependencies, model files, runtime behavior, or MotionFrame schema changes.

## Official sources reviewed

- Google AI Edge / MediaPipe Face Landmarker overview
- Google AI Edge / MediaPipe Face Landmarker platform guides
- Google AI Edge / MediaPipe Framework in C++ documentation
- google-ai-edge/mediapipe repository license
- Source review date: 2026-06-16

## Product fit

MediaPipe Face Landmarker is relevant to LVK because it is designed for face landmark and expression detection on images, videos, and live video streams. Its outputs are substantially richer than OpenCV Haar:

- 3D face landmarks
- complete face mesh
- facial blendshape scores
- facial transformation matrices

This aligns with LVK's future tracking needs better than Haar rectangle detection.

Potential LVK mapping without immediate MotionFrame schema changes:

- `tracking.status`: can map from face presence / detection result.
- `tracking.confidence`: can map from face detection or presence confidence if exposed by the chosen runtime path.
- `face.position`: can be derived from landmark bounds or facial transform.
- `face.rotation`: may be derived from facial transformation matrices.
- `mouth.open` / `mouth.smile`: may be derived from blendshape scores.
- `eyes.leftOpen` / `eyes.rightOpen`: may be derived from landmarks or blendshape scores, but exact mapping must be validated.

Likely future schema questions:

- Detailed blendshape output cannot fit cleanly into the current minimal MotionFrame schema.
- Full landmark arrays should not be added casually to MotionFrame v0.1.
- Any richer facial expression protocol should be a separate MotionFrame schema proposal.

## Native Core integration fit

The main unresolved issue is integration route.

The official Face Landmarker task documentation emphasizes platform guides such as Android, Python, Web, and iOS. The official C++ documentation exists for MediaPipe Framework, but appears oriented around Bazel-built framework examples rather than a small drop-in C++ Face Landmarker Tasks integration for LVK's current CMake Native Core.

Possible integration routes to evaluate:

1. Native C++ MediaPipe Framework integration
   - Best architectural fit if feasible.
   - Highest build and packaging risk.
   - Needs Bazel/CMake boundary review.
   - Needs Windows build feasibility review.

2. Separate local helper process
   - Could preserve LVK process boundaries.
   - Adds IPC/process complexity.
   - Must keep frames local.
   - Must avoid Python/Web becoming a required production path without explicit decision.

3. Python or Web reference-only spike
   - Useful for understanding outputs and mapping.
   - Not a final Native Core integration route.
   - Should not become a runtime dependency for LVK v0.1 without a separate architecture decision.

## Model and artifact fit

Face Landmarker uses a downloadable model bundle that includes face detection, face mesh, and blendshape prediction components.

Before committing, bundling, or distributing anything, LVK must review:

- exact model/task file used
- model card
- license and notice requirements
- redistribution permissions
- expected binary/model size
- where model files live in local development
- whether model files are optional user-provided assets or bundled artifacts

No model file, task file, generated file, or downloaded artifact should be committed in the feasibility PR.

## Packaging risk

Packaging risk is medium to high until the integration route is proven.

Key risks:

- C++ Native Core currently uses CMake; MediaPipe Framework examples may require Bazel.
- Windows desktop build complexity is unknown.
- Model/task file distribution must be reviewed.
- Binary size and runtime dependency size are unknown.
- GPU acceleration should not be required for the first feasibility pass.
- CPU-only local feasibility should be evaluated first if possible.

## Privacy and local-first fit

MediaPipe Face Landmarker can conceptually fit LVK's local-first direction if it runs fully on-device.

Non-negotiable LVK constraints still apply:

- raw camera frames stay local
- no uploads
- no telemetry
- no analytics
- no external frame processing
- no raw frame persistence
- no committed camera logs or frame dumps
- backend logic remains behind Native Core tracking abstractions

## Expected diagnostics for future local validation

A future local validation PR should collect safe stderr-only metadata, not raw frames:

- effective FPS
- captureDurationMs
- detectionDurationMs or equivalent inference timing
- totalFrameDurationMs
- hasFace / lostOrNoFace rate
- detector/backend name
- startup/shutdown behavior
- runtime/model path category
- setup issues
- frame read failures
- local-only confirmation

## Non-goals

This memo does not:

- select MediaPipe as the backend
- add MediaPipe dependency
- add model/task files
- add cloud inference
- change MotionFrame schema
- change Native Core runtime behavior
- add UI dependency on backend runtime packages
- commit raw frames, logs, screenshots, binaries, models, task files, or generated artifacts

## Recommendation

MediaPipe Face Landmarker should remain the first product-quality candidate to investigate after OpenCV Haar baseline evidence.

This memo records the documentation-only feasibility research. The next local task should be a narrowly scoped feasibility spike that answers:

- Can we build or run an official local Face Landmarker path on Windows DevPC?
- What runtime route is smallest and safest for LVK?
- Can we inspect output fields without committing model files or raw frames?
- Can the output be mapped to current MotionFrame fields without schema changes?

## Model License and Redistribution Review (2026-06-16)

This review is documentation-only and source-grounded in official Google, MediaPipe, model-card, and PyPI sources. It does not approve any runtime dependency, model bundle, task file, or production integration. MediaPipe Face Landmarker remains a candidate only. No tracking backend is selected. No production dependency is added. No model/task file is committed. No model/task file is approved for bundling by this PR. Any production use requires a separate architecture/dependency/model packaging PR.

### Sources reviewed

- Google AI Edge / MediaPipe Face Landmarker overview: <https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker>
- Google AI Edge / MediaPipe Face Landmarker Python guide: <https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/python>
- FaceDetector / BlazeFace short-range model card linked from the overview: <https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf>
- FaceMesh-V2 model card linked from the overview: <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf>
- Blendshape V2 model card linked from the overview: <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf>
- google-ai-edge/mediapipe repository license: <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>
- PyPI `mediapipe` project metadata: <https://pypi.org/project/mediapipe/>
- Google Developers Site Policies: <https://developers.google.com/terms/site-policies>

### Face Landmarker bundle components

The official overview states that Face Landmarker uses a downloadable model bundle composed of three packaged models: a face detection model, a face mesh model, and a blendshape prediction model. The same table identifies the linked bundle as `FaceLandmarker`, with model-card links named `FaceDetector`, `FaceMesh-V2`, and `Blendshape`, and input shapes of `FaceDetector: 192 x 192`, `FaceMesh-V2: 256 x 256`, and `Blendshape: 1 x 146 x 2` with `float 16` data. The overview also states that the face detection model is the BlazeFace short-range model.

The Python guide documents the local model path shape as `face_landmarker.task` and shows `BaseOptions(model_asset_path=model_path)`, which confirms the task expects a local trained model bundle path. The previous local feasibility spike observed the task file name/URL category as the official Face Landmarker `.task` bundle linked from the overview; this PR did not download, commit, or bundle that task file.

### Model card license findings

| Component             | Official model-card name reviewed                               | License finding                                                     | LVK status                                                                      |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Face detection        | `MediaPipe BlazeFace Model Card (Short Range)` / `FaceDetector` | The model card states `LICENSED UNDER Apache License, Version 2.0`. | License stated; redistribution of the combined `.task` bundle still unresolved. |
| Face mesh             | `Model Card MediaPipe Face Mesh V2` / `FaceMesh-V2`             | The model card states `LICENSED UNDER Apache License, Version 2.0`. | License stated; redistribution of the combined `.task` bundle still unresolved. |
| Blendshape prediction | `Model Card Blendshape V2` / `Blendshape`                       | The model card states `LICENSED UNDER Apache License, Version 2.0`. | License stated; redistribution of the combined `.task` bundle still unresolved. |

No reviewed component model card lacked an explicit license statement. However, those component findings alone do not settle LVK's redistribution, packaging, attribution, or notice obligations for the combined downloadable `.task` artifact.

### Repository, package, docs, and sample license findings

- MediaPipe repository code: the `google-ai-edge/mediapipe` repository `LICENSE` file is Apache License, Version 2.0.
- PyPI `mediapipe` package metadata: PyPI lists the package license as `Apache Software License (Apache 2.0)` and classifier `OSI Approved :: Apache Software License`.
- Google Developers documentation text: the Face Landmarker docs footer and Google Developers Site Policies state that documentation content is generally licensed under Creative Commons Attribution 4.0 unless otherwise noted.
- Google Developers code samples: the Face Landmarker docs footer and Site Policies state that code samples are licensed under Apache 2.0 unless otherwise noted.
- Google trademarks, brand features, and separately linked images/audio/video/external content are not automatically covered by the Google Developers documentation license and need separate review if reused.

### Redistribution notes

The reviewed official sources support that the three component model cards state Apache 2.0 and that MediaPipe code/package metadata is Apache 2.0. They do not, by themselves, answer every production redistribution question for LVK. Before production use, LVK must explicitly decide whether it may redistribute the combined `face_landmarker.task` model bundle, what exact notices or attribution are required, and whether downstream Electron/npm packaging can include the artifact.

For now, LVK should treat the model bundle as an external candidate artifact only. Development spikes may reference a local path to a user-provided or locally downloaded model bundle, but this repository should not commit the bundle or make it part of an application package without a later packaging decision.

### LVK policy decision for now

- MediaPipe Face Landmarker remains a candidate only.
- No tracking backend is selected.
- No production dependency is added.
- No model/task file is committed.
- No model/task file is approved for bundling by this PR.
- Any production use requires a separate architecture/dependency/model packaging PR.
- Do not commit `face_landmarker.task` or any other model/task artifact yet.
- Do not bundle model/task files into npm, Electron, Native Core, or release artifacts yet.
- Keep all production planning behind LVK's local-first, Native Core, Electron, Web Preview, and MotionFrame boundaries.

### Unresolved questions

- Is redistribution of the combined `face_landmarker.task` bundle permitted under the same terms as the component model cards, and what exact attribution or notice text is required?
- Must LVK add or update a `NOTICE`, `THIRD_PARTY_NOTICES`, or equivalent file before any dependency or model packaging PR?
- Can the model bundle be committed to the repository, or must it remain a user-provided/local-downloaded asset outside version control?
- Can npm/Electron production packaging include the model bundle, and if so under what file placement, notice, and license-display requirements?
- Does the selected integration route introduce additional binary/runtime licenses beyond the model cards and the PyPI/package metadata reviewed here?

### Next step

Open a separate architecture/dependency/model packaging PR before production use. That PR should select the integration route, identify the exact runtime packages and model artifacts, decide whether the model remains user-provided or becomes a bundled asset, add required notices if needed, and keep MediaPipe behind the Native Core tracking abstraction without MotionFrame schema changes unless a separate schema PR is approved.

## Local Feasibility Spike Results (2026-06-16)

The narrowly scoped feasibility spike was completed on the Windows DevPC (PR chore/mediapipe-face-landmarker-local-feasibility). Findings below; full evidence in `docs/TRACKING_BACKEND_EVALUATION.md` Pass 4.

### Route confirmed

Python Tasks (`mediapipe==0.10.35` pip package) works on Windows 11 / Python 3.11. This is a reference/feasibility route only, not a Native Core production path.

**No official Face Landmarker C++ Tasks guide was identified in the reviewed official sources.** The official C++ path found during this spike is MediaPipe Framework + Bazel example-app documentation, which remains unvalidated for LVK's Windows/CMake Native Core and carries high build risk.

### Output fields confirmed on a live webcam frame

- 478 3D face landmarks per face (`NormalizedLandmark.x/y/z`; `.visibility`/`.presence` are `None` for this task)
- 52 blendshape scores per face (`Category.category_name` / `.score`)
- 4×4 float32 facial transformation matrix per face

### MotionFrame mapping feasibility

A basic MotionFrame mapping is feasible without schema changes using blendshapes and the transformation matrix. Key mappings:

- `tracking.status` ← face detected boolean
- `face.rotation` ← transformation matrix Euler decomposition
- `eyes.leftOpen/rightOpen` ← `1.0 - eyeBlinkLeft/Right`
- `mouth.open` ← `jawOpen`
- `mouth.smile` ← `mouthSmileLeft/Right` average

Gaze (`eyes.gaze.x/y`) requires landmark geometry derivation (not a direct blendshape).

### Unresolved risks before production integration

- C++ / Native Core integration route not validated (Bazel + Windows unknown)
- Model license and redistribution terms require full review
- Tracking quality, jitter, and lost-face rate not evaluated
- GPU path not evaluated
- Production packaging size not measured (pip wheel ~10–18MB; full venv ~200MB+)
- A separate helper process boundary may be needed if C++ route remains infeasible

### Next step

Decide on integration route: C++ MediaPipe Framework (Bazel, higher risk) vs. separate local helper process (IPC complexity) vs. deferred pending ONNX Runtime evaluation. Full license and redistribution review required before any production dependency is added.
