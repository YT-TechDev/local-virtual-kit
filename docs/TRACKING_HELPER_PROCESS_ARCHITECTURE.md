# Tracking Helper Process Architecture Memo

## Status

- Architecture and design memo only.
- Written after the MediaPipe C++ / Bazel local build spike (2026-06-17).
- No tracking backend is selected.
- No dependency, runtime behavior, IPC, model/task file, or MotionFrame schema change is introduced.

This memo exists so the project owner can compare a possible **local helper process** route against
continuing the C++ / Bazel route, using a source-grounded summary of the current decision point. It
does not commit LVK to any of these options.

### This memo explicitly does NOT

- select a tracking backend
- approve MediaPipe for production
- approve the MediaPipe Python Tasks route for production
- approve model/task file bundling or redistribution
- add any dependency
- add any runtime behavior
- add any inter-process communication (IPC)
- change the MotionFrame schema

Any production integration still requires a separate implementation / dependency / model packaging PR
with its own review, exactly as stated in `docs/TRACKING_BACKEND_EVALUATION.md` and
`docs/MEDIAPIPE_FACE_LANDMARKER_RESEARCH.md`.

## Background

Prior evaluation evidence (see `docs/TRACKING_BACKEND_EVALUATION.md` and
`docs/MEDIAPIPE_FACE_LANDMARKER_RESEARCH.md`):

- The dummy/noop diagnostics baseline passed (Pass 1).
- An OpenCV camera smoke passed on the Windows DevPC (Pass 2).
- An OpenCV Haar smoke passed only as a wiring baseline, not product-quality VTuber tracking (Pass 3).
- MediaPipe Face Landmarker research found it promising but not selected.
- The Python Tasks route confirmed useful output on Windows 11 (478 landmarks, 52 blendshapes, a 4×4
  transformation matrix) — for reference/feasibility only, not as a Native Core production path.
- Model/license review found the component model cards promising, but combined `.task` redistribution
  and packaging remain unresolved.
- The official C++ Tasks `FaceLandmarker` API exists in the MediaPipe source tree.
- The C++ / Bazel local build spike showed high Windows DevPC setup cost and stopped at TensorFlow's
  hermetic Python detection (`python_version_repo`) during the Bazel repository fetch phase, before
  reaching C++ compilation.

No backend is selected. Python Tasks remains reference/feasibility only. The C++ / Bazel route remains
unvalidated and high-cost. A local helper process is now being considered as one architecture
candidate.

## 1. Current Decision Point

- **C++ / Bazel is the best Native Core fit if it can be built.** A native C++ tracker target would sit
  directly inside `native/tracker-core/` behind the existing camera, preprocessing, detector/tracker,
  and MotionFrame writer seams (`docs/ARCHITECTURE.md` §3, `docs/TRACKING_SPEC.md` §2), with no extra
  process boundary and no new transport.
- **The C++ / Bazel cost on Windows is high and currently unproven.** The spike confirmed a heavy
  toolchain surface (Bazel/Bazelisk, MSVC C++20, Windows SDK, MSYS2, a TensorFlow + Python + JS +
  Kotlin + Apple + Rust dependency chain pulled in by the full MediaPipe WORKSPACE) and stopped at the
  first actionable blocker: TensorFlow's `python_version_repo` could not match a hermetic Python
  version to system Python during repository fetch. There is no officially supported way to extract
  just the `face_landmarker` C++ library for a CMake project.
- **A local helper process is being considered as a fallback architecture candidate.** It could let
  LVK reuse an already-working tracking implementation (for example the validated Python Tasks route)
  without first solving the full Bazel/MSVC/OpenCV/Python build, at the cost of a process boundary and
  IPC. This memo evaluates that idea against LVK's boundaries; it does not adopt it.

## 2. Options Compared

Each option is measured against the existing boundaries: Native Core owns tracking and MotionFrame
output; Electron owns shell/settings/calibration/native-process lifecycle; Web Preview consumes
MotionFrame only (`docs/ARCHITECTURE.md` §3).

### Option A — Continue the C++ / Bazel route

- **Fit:** Best Native Core fit; no new process boundary, no new transport, tracking stays in-process.
- **Cost/risk:** High and unproven on Windows. Requires resolving TensorFlow hermetic Python detection,
  MSVC C++20, MSYS2, OpenCV path reconciliation (the MediaPipe WORKSPACE hardcodes OpenCV 3.4.10 at
  `C:\opencv\build`; LVK uses vcpkg OpenCV 4.12.0), and Bzlmod resolution, with no official
  minimal-target or CMake-consumable path.
- **Note:** Remains the cleanest _if_ a focused environment fix-and-reprobe succeeds.

### Option B — Native Core-owned local helper process (recommended candidate boundary)

- **Fit:** Native Core spawns and owns a local helper process behind its tracker seam. Native Core
  remains the tracking owner and the sole MotionFrame producer.
- **Cost/risk:** Adds a local process boundary and a small internal IPC channel that must be designed
  carefully. Avoids the full Bazel/MSVC build for an initial prototype.
- **Note:** Keeps every existing boundary intact; see §3.

### Option C — Electron-owned helper process

- **Fit:** Electron would launch and manage the tracking helper directly.
- **Risk:** Pushes backend runtime ownership into Electron, which currently must **not** own tracking
  algorithms or backend runtime (`docs/ARCHITECTURE.md` §3). This blurs the Native Core boundary and is
  not preferred. Electron should continue to own only the native-process lifecycle (start/stop), not
  the tracking runtime itself.

### Option D — Helper process owns camera capture directly

- **Fit:** The helper would open the webcam itself and produce tracking output.
- **Risk:** Moves camera ownership out of Native Core and creates the strongest local-first exposure
  (a second component touching raw frames). Camera frames must stay local to Native Core memory
  (`docs/TRACKING_BACKEND_EVALUATION.md`, `docs/AGENTS.md` §4). Not preferred for v0.1 unless a future
  design PR proves the full local-only/IPC-security checklist in §6.

### Option E — ONNX Runtime + local model (later candidate)

- **Fit:** A local-only model executed behind the Native Core tracker seam, potentially in-process,
  avoiding the MediaPipe Bazel chain.
- **Status:** Remains a later candidate, only after a specific model, license, redistribution path, and
  runtime setup are identified (`docs/TRACKING_BACKEND_EVALUATION.md`). Out of scope for this memo
  beyond noting it as an alternative that may not need a helper process at all.

## 3. Recommended Safest Helper-Process Candidate Boundary

If a helper process is pursued at all, the safest boundary is **Option B — a Native Core-owned local
helper process**:

- The helper process is spawned and owned by Native Core and stays **behind the Native Core tracker
  seam** (the existing detector/tracker abstraction in `native/tracker-core/`).
- **Native Core remains the tracking owner.** From the rest of the system's perspective, nothing
  changes: tracking is still a Native Core responsibility.
- **Electron remains the shell / settings / calibration / native-process-lifecycle owner**, not a
  backend runtime owner. Electron may start/stop the native tracker as it does today
  (`docs/ARCHITECTURE.md` §4); it does not gain tracking or backend runtime responsibilities.
- **Web Preview continues to consume MotionFrame only.** It must not learn that a helper process
  exists, and must not consume anything other than MotionFrame (`docs/ARCHITECTURE.md` §3,
  `docs/MOTION_PROTOCOL.md`).
- Electron, Web Preview, and Motion Protocol must not gain any backend runtime dependency
  (`docs/TRACKING_BACKEND_EVALUATION.md`).

## 4. Helper Output Contract Intent

- The helper's output should normally be a **compact internal tracking result** consumed only by
  Native Core — for example detected landmarks/blendshapes or already-derived values — **not** the
  public MotionFrame directly, unless a later PR intentionally decides otherwise.
- **Native Core maps, normalizes, smooths, handles fallback/lost-face behavior, and emits the final
  MotionFrame**, exactly as described in `docs/TRACKING_SPEC.md` (§2 pipeline, §4 normalization, §5
  tracking status, §6 smoothing). The helper is an internal detail of the tracking stage, not a second
  MotionFrame producer.
- This keeps MotionFrame a stable, framework-independent contract with `schemaVersion: 1`
  (`docs/MOTION_PROTOCOL.md`). This memo proposes **no** schema change. Richer helper output (for
  example all 52 blendshapes or full landmark arrays) would require a separate, intentional schema
  decision and is out of scope here.

## 5. Raw Frame IPC Stance

- **Raw frame IPC is NOT approved by this memo.** The recommended boundary (§3–§4) keeps camera frames
  inside Native Core and crosses the helper boundary only with compact tracking results or, if camera
  ownership stays in Native Core, with frames the helper needs — and that case is explicitly deferred.
- If raw frames ever cross a local process boundary in a future design, that future explicit
  design/implementation PR must prove all of the following before any code lands:
  - local-only operation (no network egress of frames)
  - no persistence of raw frames
  - no upload
  - no telemetry
  - no analytics
  - no external frame processing
  - safe diagnostics only (no raw pixels/image dumps in diagnostics)
  - defined backpressure behavior
  - defined crash behavior
  - platform-specific IPC security (access control on the chosen channel)

## 6. IPC Options and Tradeoffs

These are evaluated for a possible Native Core ↔ helper channel. None is adopted here.

| IPC option                             | Suitability                         | Tradeoffs                                                                                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **stdin/stdout JSON**                  | Control messages or compact results | Simple, cross-platform, and consistent with the existing convention of reserving stdout for newline-delimited JSON and stderr for safe diagnostics (`docs/TRACKING_BACKEND_EVALUATION.md`). Not suitable for high-rate raw frame transport.                            |
| **Named pipe**                         | Local IPC, especially on Windows    | May fit Windows local IPC well, but needs a cross-platform abstraction (Windows named pipes vs. POSIX FIFOs/Unix domain sockets differ) and access-control handling.                                                                                                   |
| **Local TCP loopback**                 | Easy, language-agnostic             | Easy to implement and already familiar (MotionFrame uses `ws://127.0.0.1:45731` per `docs/ARCHITECTURE.md` §5), but must be strictly bound to `127.0.0.1`, and any helper-facing socket must be treated carefully as **new local network behavior** that needs review. |
| **Shared memory / memory-mapped file** | High-rate frame transport           | More plausible for high-rate raw frames, but heavier to implement correctly (synchronization, lifetime, cleanup) and **not a v0.1 default**.                                                                                                                           |
| **Temporary files**                    | Not appropriate for frames          | Creating files for frame transport introduces a persistence risk that conflicts with local-first/no-persistence rules. Not appropriate for frame transport.                                                                                                            |

Practical guidance:

- Prefer stdin/stdout JSON for control messages and compact tracking results in an initial prototype.
- Treat any loopback socket as new local network behavior and restrict it to `127.0.0.1`.
- Defer shared memory / mmap unless high-rate raw frame transport is actually required and justified.
- Do not use temporary files for frame transport.

## 7. Cross-Cutting Concerns to Resolve

A future helper-process design/implementation PR must address each of the following:

- **Process ownership** — Native Core spawns, supervises, and shuts down the helper; Electron retains
  only the existing native-process start/stop lifecycle role.
- **Frame ownership** — camera frames stay owned by Native Core in v0.1; the helper does not own the
  camera (Option D is deferred).
- **Backpressure and dropped-frame behavior** — define what happens when the helper is slower than the
  capture rate (drop oldest, coalesce, or block within bounds) without unbounded buffering.
- **Startup / shutdown protocol** — define handshake, readiness signaling, and clean teardown so a
  half-started helper never produces partial results.
- **Crash recovery** — define detection of helper crash/hang and Native Core fallback (for example
  emit `tracking.status = "lost"` per `docs/TRACKING_SPEC.md` §5 and attempt a bounded restart).
- **Diagnostics and safe stderr metadata** — reuse the existing stderr-only safe-metadata pattern
  (timing fields, `detectionDurationMs`, has-face/lost-face counts) and never emit raw pixels in
  diagnostics (`docs/TRACKING_BACKEND_EVALUATION.md`).
- **Local-only proof** — demonstrate no upload, telemetry, analytics, or external frame processing.
- **Model / task file location** — where any model/`.task` file lives, how it is fetched, and that it
  is not committed or bundled without a separate packaging decision.
- **Packaging size and license notices** — measure helper + runtime footprint and capture required
  license/notice obligations before any distribution.
- **Windows / macOS / Linux differences** — IPC primitives, process spawning, and path handling differ
  per platform; the design must be explicit about the cross-platform abstraction.
- **Local IPC security** — restrict the channel to the local machine and the intended processes
  (loopback-only binding, pipe ACLs, or equivalent).
- **Future OBS / Web Preview compatibility** — the preview and OBS Browser Source path must keep
  consuming MotionFrame only; the helper boundary stays invisible to them.
- **v0.1 suitability** — judge whether the chosen design is simple enough for an early local-first
  release, or whether it should remain a prototype/spike.

## 8. Open Questions Before Implementation

1. Which tracking implementation would the helper wrap first (for example the validated Python Tasks
   route), and is that acceptable as a non-production prototype only?
2. Does Native Core keep camera ownership (preferred), so the helper never touches raw frames?
3. What exact internal result shape crosses the boundary, and how does Native Core map it to
   MotionFrame without any schema change?
4. Which single IPC mechanism is chosen for a first prototype, and how is it secured locally?
5. What are the concrete backpressure, dropped-frame, startup, shutdown, and crash-recovery rules?
6. What is the helper + runtime + model footprint, and which license/notice obligations apply?
7. Is a helper process actually preferable to a focused C++ / Bazel environment fix-and-reprobe, or to
   the ONNX Runtime route, given the cost comparison in §1–§2?

## 9. Smallest Next Step

1. **Review this docs-only memo first.** It changes no code and selects nothing.
2. Then the project owner chooses between either:
   - a focused **Python / Bazel environment fix-and-reprobe** of the C++ / Bazel route (identify the
     exact Python configuration TensorFlow's `python_repo.bzl` expects and re-run the minimal probe
     once, with approval), **or**
   - a **helper-process prototype design/spike** that designs (and only then prototypes, outside the
     repository) the Native Core-owned local helper boundary described in §3.
3. **Do not implement helper IPC or add any dependency in this PR.** Either follow-up is a separate,
   explicitly approved PR.

## Non-Selection Statement

- The helper process is **not** selected; it is one architecture candidate under review.
- MediaPipe Face Landmarker is **not** selected.
- The MediaPipe Python Tasks route is **not** approved for production; it remains reference/feasibility
  only.
- Model/task file bundling is **not** approved.
- No tracking backend is selected.
- No dependency is added to LVK.
- No runtime behavior or IPC is added.
- No MotionFrame schema change is made.
- No camera/webcam validation was performed for this memo.
- Camera frames must stay local; no upload, telemetry, analytics, or external frame processing.
- Any production integration requires a separate implementation / dependency / model packaging PR.
