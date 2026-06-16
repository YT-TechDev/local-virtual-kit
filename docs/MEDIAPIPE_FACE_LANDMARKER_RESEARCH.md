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

## Integration Route Decision Prep (2026-06-16)

This decision-prep memo chooses the safest next evaluation route, not the final tracking backend. It is documentation-only and does not implement MediaPipe, ONNX Runtime, helper processes, IPC, Native Core changes, MotionFrame schema changes, or model packaging.

### Current evidence summary

- PR #114 recorded OpenCV Haar smoke/baseline evidence. Haar remains useful for detector wiring and diagnostics smoke coverage, but it is not product-quality VTuber tracking.
- PR #115 recorded official MediaPipe Face Landmarker research notes. Face Landmarker appears relevant because it can expose face landmarks, blendshape scores, and facial transformation matrices.
- PR #116 recorded local Python Tasks feasibility findings on the Windows DevPC. Python Tasks confirmed useful reference outputs, but that route is feasibility/reference only and is not an approved production runtime boundary.
- PR #117 recorded MediaPipe model/license redistribution review. The component model cards and MediaPipe packages are promising from a licensing standpoint, but the combined `.task` artifact still has unresolved production packaging and notice decisions.
- MediaPipe Face Landmarker remains a candidate only. No tracking backend is selected. No model/task file is committed or approved for bundling.

### Candidate route comparison

| Criterion                        | Native C++ MediaPipe Tasks / MediaPipe Framework + Bazel                                                                                                                                     | Separate local helper process using Python Tasks                                                                                                         | Defer MediaPipe and evaluate ONNX Runtime + local model first                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Core boundary fit         | Best conceptual fit if FaceLandmarker can be built or consumed behind the Native Core tracker seam; C++/Bazel compatibility with the current CMake-oriented Native Core remains unvalidated. | Weaker fit because tracking would cross a process boundary; requires an explicit helper-process architecture and IPC contract before production use.     | Potentially good if ONNX Runtime and a selected local model can live behind Native Core abstractions; depends on the model and provider path chosen later. |
| Local-first/privacy fit          | Strong if all inference remains in Native Core memory and only MotionFrame JSON leaves the tracker process.                                                                                  | Can remain local-only, but IPC must be designed so raw frames are not persisted, uploaded, logged, or exposed beyond the local helper boundary.          | Strong if a local model is selected and no remote provider or external frame processing is introduced.                                                     |
| Windows DevPC feasibility        | Unknown; the official C++/Bazel route is still unvalidated against LVK's Windows DevPC, CMake workflow, and packaging expectations.                                                          | Already feasible as a reference route through Python Tasks, but productionizing Python runtime ownership and packaging is a separate risk.               | Unknown until a specific model, provider, and Windows packaging path are reviewed.                                                                         |
| Build/package complexity         | Likely highest short-term risk because it may introduce Bazel, native build graph complexity, binary size, and toolchain integration questions.                                              | Medium-to-high risk because packaging Python, wheels, virtual environments, helper lifecycle, and crash handling can expand Electron/runtime complexity. | Medium risk; ONNX Runtime packaging may be simpler than MediaPipe/Bazel but model selection, providers, and binary distribution still need review.         |
| Model/task artifact handling     | Requires a later decision on the exact Face Landmarker `.task` artifact, notices, placement, and bundling policy.                                                                            | Same `.task` artifact questions remain, plus Python package/runtime packaging questions.                                                                 | Requires a different model/license/weights review before any local model is committed or bundled.                                                          |
| Runtime dependency risk          | High until official C++ Tasks or Framework consumption on Windows is proven.                                                                                                                 | High if Python becomes part of production distribution without an approved helper-process architecture.                                                  | Medium-to-high until a concrete model and ONNX Runtime provider set are chosen.                                                                            |
| MotionFrame schema impact        | No schema change is required for a narrow reconnaissance PR; richer landmarks/blendshapes must stay out of MotionFrame unless a separate schema PR is approved.                              | Same: helper output should map to current MotionFrame fields unless a separate schema PR is approved.                                                    | Same: model outputs should map to current MotionFrame fields unless a separate schema PR is approved.                                                      |
| Short-term validation value      | Highest, because it answers the main unresolved production-route question left by the Python feasibility spike: whether an official C++ route can fit LVK.                                   | Useful fallback evaluation if the C++ route is blocked or too costly after reconnaissance.                                                               | Useful pivot option, but it does not directly retire the MediaPipe C++ route uncertainty created by the recent feasibility work.                           |
| Long-term maintainability        | Potentially strongest if it keeps tracking in Native Core with minimal runtime boundaries, but only if build and packaging risk are manageable.                                              | Potentially maintainable with a well-designed helper boundary, but it adds lifecycle, IPC, and runtime support burden.                                   | Potentially maintainable if a stable model/runtime is selected, but model quality and license review are still unproven.                                   |
| Reviewability / smallest next PR | Best as a reconnaissance-only PR that documents whether the C++ route can build or be consumed; it must not add production dependencies or artifacts.                                        | Requires a broader architecture discussion before it is reviewable as more than reference work.                                                          | Requires model discovery and license review before evaluation can be source-grounded.                                                                      |

### Recommended next route to evaluate

The next step should be a narrow C++ Tasks / MediaPipe Framework route reconnaissance PR, not production integration. It should answer whether the official C++ Tasks FaceLandmarker API or MediaPipe Framework route can be built or consumed on Windows in a way compatible with LVK's Native Core boundaries.

The reconnaissance PR should stay documentation/architecture focused unless the project owner explicitly approves a small build spike. If the route appears too risky after reconnaissance, then the local helper process route can be considered separately with an explicit helper-process architecture PR. ONNX Runtime remains a later candidate unless the project chooses to pivot away from MediaPipe after the C++ route is assessed.

### Why this is not a final backend selection

- MediaPipe Face Landmarker remains a candidate only.
- No tracking backend is selected.
- Python Tasks remains reference/feasibility only unless a separate architecture PR approves a helper-process boundary.
- The C++/Bazel route remains unvalidated.
- ONNX Runtime remains a later candidate unless the project chooses to pivot.
- No model/task file is committed or approved for bundling.
- Any production use requires a separate implementation and packaging PR.

### Must remain blocked until a later PR

- Adding MediaPipe, ONNX Runtime, Python runtime, or helper-process production dependencies.
- Committing or bundling `face_landmarker.task`, ONNX weights, cascade XML files, raw frames, screenshots, binaries, generated model artifacts, or build artifacts.
- Changing Native Core runtime behavior, Electron process management, Web Preview behavior, MotionFrame schema, or package/lock/build files.
- Adding IPC, telemetry, analytics, cloud upload, external frame processing, or new network behavior.
- Claiming webcam/camera validation unless it is run on an appropriate local machine and recorded as evidence.

### Next PR recommendation

Open a small reconnaissance PR for the C++ Tasks / MediaPipe Framework route. It should identify the official C++ APIs or Framework examples available for Face Landmarker, document Windows DevPC build/toolchain requirements, assess whether Bazel can coexist with LVK's Native Core boundaries, list dependency and model artifact implications, and stop before production integration, dependency addition, model bundling, or MotionFrame schema changes.
