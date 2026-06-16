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

## Local Feasibility Spike Results (2026-06-16)

The narrowly scoped feasibility spike was completed on the Windows DevPC (PR chore/mediapipe-face-landmarker-local-feasibility). Findings below; full evidence in `docs/TRACKING_BACKEND_EVALUATION.md` Pass 4.

### Route confirmed

Python Tasks (`mediapipe==0.10.35` pip package) works on Windows 11 / Python 3.11. This is a reference/feasibility route only, not a Native Core production path.

**No official C++ Tasks route exists** for Face Landmarker. C++ integration requires MediaPipe Framework + Bazel, which is unvalidated on Windows and carries high build risk.

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
