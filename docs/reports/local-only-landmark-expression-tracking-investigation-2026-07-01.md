# Local-Only Landmark / Expression Tracking Investigation - 2026-07-01

## Summary

The current OpenCV native path reliably validates **face-position tracking**, not eye,
mouth, or expression tracking. Source inspection confirms why: the Haar cascade detector
produces only a face bounding box, and Native Core maps that box into `face.position.x/y/z`
while emitting **neutral, static** values for rotation, gaze, eyes, and mouth. This matches
the owner's local smoke observation after PR #385 and #386.

Two facts shape the safe next step:

1. The `MotionFrame` `schemaVersion: 1` contract **already contains** `face.rotation`,
   `eyes.leftOpen/rightOpen`, `eyes.gaze`, `mouth.open`, and `mouth.smile`. Populating those
   fields with real values does **not** require a schema change. Only _richer_ data
   (blendshapes, full landmark arrays, brows, visemes, emotion labels) would need a future
   schema extension.
2. LVK already has an extensive, design-only helper-process architecture line
   (`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md` and the H1/H2 docs) that is the intended
   home for any future local model-based landmark/expression backend. No backend is selected,
   and no dependency, model file, or schema change is approved.

Recommendation: keep the validated face-position path as-is, do not change MotionFrame now,
and treat true eye/mouth/expression tracking as a separately gated future effort. A small,
clearly-labeled renderer-side approximation PR is the lowest-risk near-term visual improvement,
if the owner wants one; it must not be described as real expression tracking.

This note is investigation/design only. It does not implement anything and does not claim that
eye, mouth, landmark, or expression tracking is complete.

## Current State

Source-grounded observations (Windows x64 OpenCV-enabled Native Core build):

- **Detector** — `native/tracker-core/src/opencv_face_detector.cpp` loads a Haar cascade via
  `CascadeClassifier::load(cascadePath)` and runs `detectMultiScale`. It selects the single
  largest face rectangle and returns a `FaceDetectionResult` with a bounding box and a
  **hardcoded `confidence = 1.0`**. No eye, mouth, or landmark detection occurs here.
- **Sample construction** — `native/tracker-core/src/tracking_sample_factory.cpp`
  (`createTrackingSampleFromFaceDetection`) converts the bounding box to face position:
  - `face.position.x` / `y` from the box center normalized to `[-1, 1]`,
  - `face.position.z` from the box width ratio (a coarse distance proxy),
  - and explicitly sets `face.rotation` = neutral, `eyes.leftOpen/rightOpen` = `1.0`,
    `eyes.gaze` = neutral, `mouth.open/smile` = `0.0`.
  - The code carries an explicit comment: _"Temporary metadata-only mapping until local
    landmark extraction exists. Bounds can indicate coarse face position, but rotation, gaze,
    eyes, and expression values remain neutral so they are not mistaken for real tracking."_
- **Protocol** — `packages/motion-protocol/src/motion-frame.ts` (per
  `docs/MOTION_PROTOCOL.md` §3) already defines `face.rotation`, `eyes.leftOpen/rightOpen`,
  `eyes.gaze`, `mouth.open`, and `mouth.smile` in `schemaVersion: 1`.
- **Renderer mapping** — `apps/web-preview/src/motion/mapMotionFrameToAvatar.ts` reads all of
  those fields (with clamping and position sensitivity from PR #385) and would animate eyes,
  gaze, and mouth _if_ the incoming values changed. They currently do not, because Native Core
  sends constants.
- **Build modules** — `native/tracker-core/CMakeLists.txt` links OpenCV `core`, `imgproc`,
  `videoio`, and `objdetect`. It does **not** link the `opencv_contrib` `face`
  (facemark) module or any `dnn`-model landmark path.

## Observed Limitation

Per `docs/reports/web-preview-face-tracking-sensitivity-local-smoke-2026-07-01.md`, the owner
confirmed native frames reaching Web Preview and the avatar following face/person position, but
noted eye, mouth, and expression movement remained weak or limited.

This is expected and correct given the current implementation: only `face.position` varies per
frame; eyes, gaze, mouth, and head rotation are constants. The weakness is not a bug in mapping
or sensitivity — it is the absence of any landmark/expression estimation stage upstream. No
amount of renderer sensitivity tuning can recover eye/mouth motion that Native Core never
measured.

## Architecture Boundary Review

The boundaries in `docs/ARCHITECTURE.md` §3 and `docs/AGENTS.md` §5 constrain where any
improvement may live:

- **Native Core** owns camera access, face detection, landmark/feature extraction, head pose,
  eye/mouth estimation, normalization, smoothing, and MotionFrame output. Any _real_ eye/mouth/
  expression tracking belongs here (or behind its tracker seam via the designed helper process).
- **Motion Protocol** owns the shared `MotionFrame` types and must stay framework-independent.
- **Web Preview** consumes MotionFrame only; it must not gain camera access or a backend
  runtime dependency. It may derive avatar-specific motion and _approximations_ from the values
  it already receives (`docs/MOTION_PROTOCOL.md` §8, `docs/MOTION_MAPPING.md` §4).
- **Electron** owns shell/settings/calibration and the native-process lifecycle only; it must
  not own tracking algorithms or a backend runtime.

Any future model-based backend should follow the already-documented **Native Core-owned local
helper process** boundary (`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md` §3): the helper stays
behind the Native Core tracker seam, Native Core remains the sole MotionFrame producer, camera
capture stays owned by Native Core, and Web Preview/Electron never learn the helper exists.

## MotionFrame Boundary Review

Critical clarification for scoping the next PR:

- **No schema change is needed to add eye/mouth/gaze/head-rotation tracking.** The target
  fields already exist in `schemaVersion: 1`. Options B, C, and E below all fit the current
  contract by populating existing fields with real (or clearly-approximated) values.
- **A schema change would only be needed for richer data** that has no current field: full
  landmark arrays, full blendshape sets, eyebrow channels, per-viseme mouth shapes, or emotion
  labels. `docs/MOTION_PROTOCOL.md` §4 already forbids adding `face.detected`, `head.*`,
  `eyes.blink`, or `emotion` in v0.1 unless the protocol is intentionally changed in the same
  PR.
- Any such future field is a **future protocol option** requiring its own design, docs, tests,
  producer+consumer updates in one PR, and explicit owner approval (`docs/MOTION_PROTOCOL.md`
  §9). This note proposes no such field and invents none.

## Local-Only Tracking Options

### Option A — Stay with current OpenCV face detection only

- **Provides today:** stable face presence, coarse face position (x/y), and a coarse distance
  proxy (z) from the bounding box; a binary-ish confidence (currently hardcoded `1.0`).
- **Does not provide:** reliable eye openness, gaze, mouth open/smile, or head rotation. The box
  has no interior feature geometry, so these cannot be derived from it.
- **Renderer tuning:** can improve _perceived_ liveliness of position-driven motion (already
  done in PR #385) and could add honest idle motion, but must not fake expression tracking.
- **Verdict:** correct, validated v0.1 baseline. Keep it.

### Option B — OpenCV Haar/LBP cascade eye/mouth detection

- **Feasibility:** `objdetect` is already linked, so additional `CascadeClassifier` instances
  for eyes/mouth need **no new dependency or module**. OpenCV ships stock eye cascades
  (e.g. `haarcascade_eye`, `haarcascade_eye_tree_eyeglasses`); mouth/smile cascades are less
  standard and lower quality.
- **What it could yield:** presence of eye regions and a rough smile signal — enough for a
  crude blink/mouth hint, not smooth continuous openness or gaze.
- **Reliability issues:** cascades are brittle to lighting, glasses, occlusion, head roll, and
  profile faces; eye-openness and mouth-openness are not naturally continuous outputs of a
  detector (detection is present/absent, not a `0.0–1.0` aperture). Expect flicker and false
  negatives.
- **Packaging:** requires shipping extra cascade XML files and a robust, non-placeholder path
  resolution story. The existing face cascade already surfaced a path-resolution pain point in
  the 2026-07-01 smoke (`LVK_FACE_CASCADE_PATH` placeholder failure).
- **Verdict:** experimental at best for v0.1. It can technically run locally with current
  modules but is unlikely to produce VTuber-quality eye/mouth motion. Not recommended as the
  primary path; acceptable only as a clearly-labeled experiment if the owner wants to probe it.

### Option C — OpenCV local landmark / facemark approach

- **Feasibility:** OpenCV facemark (LBF/AAM/Kazemi) lives in the `opencv_contrib` `face`
  module, which is **not currently linked**. LBF also requires a trained model file
  (e.g. `lbfmodel.yaml`).
- **Implications:** introduces a new OpenCV module dependency **and** a model file
  (packaging + licensing + path-resolution work), and would enable real continuous eye/mouth
  values that map onto existing MotionFrame fields (so still no schema change for basic
  channels).
- **Quality:** classic facemark landmark quality is moderate — better than cascades, well below
  modern DNN landmarkers — and adds CPU cost.
- **Verdict:** not appropriate for v0.1 without an explicit dependency + model-file approval and
  packaging/licensing review. It is a reasonable _candidate_ to compare against Option D later,
  but should not be adopted casually.

### Option D — MediaPipe / ONNX / other local model backend (future phase)

- **Feasibility:** can be local-only, but introduces a substantial runtime and/or model file.
  Prior evaluation (`docs/TRACKING_BACKEND_EVALUATION.md`,
  `docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`) found MediaPipe C++/Bazel high-cost and
  unproven on Windows; the MediaPipe Python Tasks route produced rich output (478 landmarks,
  52 blendshapes) but is reference/feasibility only, not a selected production path.
- **Concerns:** new dependencies, model/task file bundling and redistribution licensing, no
  runtime download allowed, CPU/GPU cost, cross-platform packaging size, and validation burden.
- **Architecture home:** the already-designed **Native Core-owned local helper process**
  (H1/H2 docs) is the intended boundary. Rich output would likely also motivate a _future_
  MotionFrame schema extension, gated separately.
- **Verdict:** most capable long-term answer, but must not be added casually. It requires
  explicit owner approval plus a dependency/model/packaging/privacy review before any code
  lands. No backend is selected here.

### Option E — Renderer-side expression approximation

- **Feasibility:** Web Preview already receives `face.position`, `tracking.status`, and
  `tracking.confidence`, and already has a typed mapping + lerp/smoothing layer
  (`mapMotionFrameToAvatar.ts`). It could synthesize _subtle, honest_ motion — e.g. gentle
  idle blinks on a timer, small gaze/head drift, or confidence-scaled liveliness — entirely in
  the renderer.
- **Boundary fit:** needs **no** MotionFrame schema change, no Native Core change, and no new
  dependency. It must be clearly labeled as **approximation / idle animation**, not real eye,
  mouth, or expression tracking, so it never misrepresents tracking capability.
- **Limits:** it cannot reflect the user's actual eyes/mouth because that data does not exist in
  the frame. It is a cosmetic improvement only.
- **Verdict:** the lowest-risk near-term visual improvement, useful if the owner wants the
  avatar to feel less static while true tracking remains future work.

## Option Comparison

| Option                          | Real eye/mouth data? | New dependency          | New model file   | New OpenCV module       | MotionFrame schema change      | Packaging work       | v0.1 realistic?      |
| ------------------------------- | -------------------- | ----------------------- | ---------------- | ----------------------- | ------------------------------ | -------------------- | -------------------- |
| A — face detection only         | No                   | No                      | No               | No                      | No                             | None (current)       | Yes (baseline)       |
| B — Haar/LBP eye/mouth cascades | Weak/crude           | No                      | Cascade XML(s)   | No (`objdetect` linked) | No (fills existing fields)     | Cascade XML bundling | Experimental only    |
| C — OpenCV facemark landmarks   | Moderate             | `opencv_contrib` `face` | Yes (`lbfmodel`) | Yes (`face`)            | No for basic channels          | Module + model file  | Not without approval |
| D — MediaPipe/ONNX local model  | Strong               | Yes (runtime)           | Yes              | N/A                     | Likely, for rich data (future) | Significant          | Future phase only    |
| E — Renderer approximation      | No (cosmetic)        | No                      | No               | No                      | No                             | None                 | Yes (optional)       |

## Recommended v0.1 Path

1. **Keep the current OpenCV face-position path as validated.** It is correct for the current
   phase and privacy-safe.
2. **Do not change MotionFrame now.** The existing fields already cover basic eye/mouth/gaze/
   head channels; no schema edit is warranted by this investigation.
3. **Optionally add one small, clearly-labeled renderer-side approximation PR (Option E)** if
   the owner wants reduced staticness — documented explicitly as idle/approximation, not real
   expression tracking, with no schema, Native Core, dependency, or network changes.
4. **Design true landmark/expression tracking separately** as a future local-only effort,
   reusing the already-documented Native Core-owned helper-process boundary
   (`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`) and existing H1/H2 gates. Choose between
   Option C (OpenCV facemark) and Option D (local model backend) in that separate design track.
5. **Only consider new model/runtime dependencies (Options C/D) after explicit owner approval**
   plus a packaging, model-file, licensing, privacy, and validation review.

Rationale: source inspection shows the weakness is upstream (no feature estimation), so the
honest choices are either (a) a cosmetic renderer approximation that changes nothing structural,
or (b) a properly gated Native Core tracking upgrade. Everything in between (cascade eye/mouth)
adds packaging cost for low-quality output and is not worth adopting as a v0.1 default.

## Proposed Small PR Slices

Ordered from lowest to highest risk. Each is a separate PR; only the first is a near-term
candidate.

1. **(This PR) Investigation/design note only.** No code, no schema, no dependency.
2. **(Optional near-term) Renderer-side idle/approximation slice (Option E).** Renderer-only:
   confidence-scaled idle motion and/or timed blink, clearly labeled as approximation; no schema
   or Native Core change; no new dependency. Validated with existing Web Preview local smoke.
3. **(Future, separate approval) Backend selection design gate.** Choose Option C vs. Option D
   for real landmark/expression tracking, extending the existing helper-process H2 gates; still
   docs-only until approved.
4. **(Future, separate approval) MotionFrame extension design** _only if_ the selected backend
   needs richer data than the current fields — with `schemaVersion` bump, producer+consumer
   updates in one PR, and migration notes per `docs/MOTION_PROTOCOL.md` §9.

## Privacy / Local-First Requirements

Any option must preserve LVK's hard constraints (`docs/AGENTS.md` §4,
`docs/ARCHITECTURE.md` §7):

- Raw camera frames stay local to Native Core memory; no upload, telemetry, analytics, external
  frame processing, or new network behavior.
- Options C/D must not introduce runtime model downloads; any model/`.task` file location,
  bundling, and licensing is a separate explicit decision.
- Web Preview and Electron must not gain camera access or a backend runtime dependency.
- Any future Native Core ↔ helper channel must be local-only and follow the raw-frame IPC stance
  in `docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md` §5.

## Risks and Open Questions

- **Confidence is hardcoded** (`opencv_face_detector.cpp` returns `1.0`), so
  `tracking.confidence` currently carries little information. Any confidence-scaled renderer
  approximation (Option E) should account for this and not over-trust confidence.
- **Cascade path resolution** is already a friction point (see the 2026-07-01 smoke placeholder
  failure). Options B/C would multiply this with additional XML/model files and need a robust,
  packaged path-resolution story — not local absolute paths.
- **Cascade quality** (Option B) is likely too low for VTuber-grade eye/mouth motion; risk of
  shipping a feature that feels worse than honest idle animation.
- **Model licensing/redistribution** (Options C/D) remains unresolved and must be reviewed
  before any bundling.
- **Approximation honesty** (Option E): must be labeled clearly so users and docs never imply
  real expression tracking exists.
- **Open question:** does the owner want a near-term cosmetic Option E slice, or defer all
  eye/mouth work until a real backend is chosen? This note does not decide that.

## Validation Notes

- This is a documentation-only investigation. No source, schema, dependency, model, or runtime
  behavior was changed.
- No webcam, OpenCV camera, Electron GUI, OBS, or OS camera-permission validation was performed
  for this note; none is required for a docs-only change.
- The only automated check in scope is `pnpm format:check`; its result is recorded in the PR.
- Findings are grounded in the current source on this branch:
  `native/tracker-core/src/opencv_face_detector.cpp`,
  `native/tracker-core/src/tracking_sample_factory.cpp`,
  `native/tracker-core/CMakeLists.txt`,
  `packages/motion-protocol/src/motion-frame.ts` (per `docs/MOTION_PROTOCOL.md`),
  and `apps/web-preview/src/motion/mapMotionFrameToAvatar.ts`.
