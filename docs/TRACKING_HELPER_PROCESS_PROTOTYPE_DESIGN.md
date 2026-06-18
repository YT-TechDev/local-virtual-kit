# Tracking Helper Process Prototype Design

## Status

- Prototype **design memo** only. Documentation, not code.
- This is **not** production approval and **not** a backend selection.
- Builds on the recommended boundary in
  [`docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md`](TRACKING_HELPER_PROCESS_ARCHITECTURE.md) §3 (a
  Native Core-owned local helper process).
- Approves no dependency, no IPC implementation, no raw frame IPC, no model/task bundling, and no
  MotionFrame schema change.

### This memo explicitly does NOT

- select a tracking backend
- approve MediaPipe or the Python Tasks route for production
- approve model/task file bundling or redistribution
- approve raw frame / pixel / tensor IPC
- implement helper IPC
- add any dependency, package, or lockfile change
- change the MotionFrame schema

## Background

The C++ / Bazel route has now been probed twice on the Windows DevPC and still has not reached C++
compilation. The most recent focused reprobe cleared the previous TensorFlow `python_version_repo`
"System Python not found" blocker (via `--repo_env=HERMETIC_PYTHON_VERSION=3.11`) and progressed into
target analysis, but then failed at a new Windows toolchain blocker — `rules_swift` autoconfiguration
(`No 'swiftc.exe' executable found in Path`) — before any compilation
(see `docs/MEDIAPIPE_FACE_LANDMARKER_RESEARCH.md#python--bazel-reprobe-2026-06-17` and
`docs/TRACKING_BACKEND_EVALUATION.md` Pass 7). The pattern is consistent: the full MediaPipe Bazel
workspace pulls broad, platform-spanning toolchain requirements that are expensive to satisfy for a
single small C++ target on Windows.

LVK is therefore pivoting **away from further immediate C++ / Bazel toolchain chasing** and toward
designing the smallest useful Native Core-owned helper-process prototype. This document is the
design step only; it precedes any implementation spike. It does not re-copy the prior evidence — see
the referenced docs for details.

## 1. Prototype Goal

Design the **smallest useful** Native Core-owned helper-process prototype direction. The prototype
exists to validate, cheaply and locally:

- process ownership and supervision (Native Core spawns/supervises/stops the helper)
- a compact **internal** result shape crossing the process boundary
- safe diagnostics (stderr metadata only)
- startup/shutdown handshake
- crash/hang handling and fallback
- whether the boundary is worth pursuing further

Explicit non-goal: this prototype does **not** implement production tracking, does not run a real
model, and does not touch raw camera frames.

## 2. Boundary Decision

The prototype keeps every existing boundary intact (`docs/ARCHITECTURE.md` §3):

- **Native Core owns and supervises the helper** and stays behind the existing tracker seam in
  `native/tracker-core/`.
- **Native Core remains the tracking owner and the sole MotionFrame producer.** The helper is an
  internal implementation detail of the tracking stage, never a second MotionFrame producer.
- **Electron remains shell / settings / calibration / native-process-lifecycle owner only.** It does
  not gain tracking or backend runtime responsibilities.
- **Web Preview continues to consume MotionFrame only** (`docs/MOTION_PROTOCOL.md`); it never learns a
  helper exists.
- **Motion Protocol remains unchanged.** `packages/motion-protocol` stays framework-independent at
  `schemaVersion: 1`.

## 3. Prototype Phases

A staged plan, each phase gated by explicit review before the next:

- **H0 — Design only (this document).** Define the contract, lifecycle, diagnostics, and gates. No
  code.
- **H1 — Non-camera synthetic helper prototype.** Native Core launches a dummy/synthetic helper that
  emits compact **synthetic** internal results (no camera, no model, no raw frames). Proves process
  lifecycle, supervision, the internal result shape, mapping to MotionFrame, fallback, and
  diagnostics. This is the first implementation spike, and only if separately approved.
  For the current implementation status and H1 closeout checklist, see
  [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md).
- **H2 — Local-frame-access design PR (future, explicit).** Only if real helper inference needs raw
  frames, pixels, or tensors. Requires the full local-only / no-persistence / backpressure / crash /
  diagnostics / IPC-security proof (see §13). Not approved here.
- **H3 — Production integration (future, explicit).** Only after dependency, model packaging, license,
  runtime footprint, local-only proof, and MotionFrame mapping are all approved. Not approved here.

This document covers **H0** and recommends **H1** as the next step. H2 and H3 are explicitly deferred.

## 4. Internal Helper Result Shape (illustrative, documentation-only)

The boundary should carry a **compact internal result** consumed only by Native Core — never the
public MotionFrame, and never added to `packages/motion-protocol`. The following is illustrative
**design only**; it is not a committed type and not a protocol:

```jsonc
// ILLUSTRATIVE ONLY — Native Core-internal, not MotionFrame, not in motion-protocol.
{
  "timestampMs": 0, // helper-side timestamp
  "status": "tracking", // e.g. not_started | tracking | lost (helper's view)
  "confidence": 1.0, // 0.0–1.0
  "faceRotation": { "pitch": 0, "yaw": 0, "roll": 0 }, // or a derived transform
  "eyes": { "leftOpen": 1.0, "rightOpen": 1.0 },
  "mouth": { "open": 0.0, "smile": 0.0 },
  "diag": { "inferenceMs": 0.0 }, // optional, safe timing only
}
```

Rules:

- It must stay **Native Core-only** and compact.
- It must **not** be added to `packages/motion-protocol` and must **not** become public MotionFrame.
- Native Core maps/normalizes/smooths it into the existing MotionFrame fields
  (`docs/TRACKING_SPEC.md` §3–§6, `docs/MOTION_PROTOCOL.md`).
- **Full landmark arrays and the complete blendshape set are NOT approved for MotionFrame.** Any
  richer expression protocol is a separate, intentional MotionFrame schema proposal — out of scope
  here.

## 5. IPC Stance for the Prototype

- **Prefer stdin/stdout JSON** for control messages and compact internal results in the initial
  non-camera prototype. This matches LVK's existing convention (stdout = newline-delimited JSON,
  stderr = safe diagnostics) and the tradeoff analysis in
  `docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md` §6.
- **High-rate raw frame IPC is not approved.**
- **Temporary files must not be used for frame transport** (persistence risk).
- **Loopback sockets are new local network behavior** and require explicit review before use; restrict
  strictly to `127.0.0.1` if ever adopted.
- **Named pipes and shared memory / mmap are deferred** until a real need (e.g. high-rate frame
  transport) is proven and justified.

## 6. Frame Ownership and Access

- **Native Core keeps camera ownership by default.**
- **Helper-owned camera capture is not approved.**
- **Helper access to raw frames, pixels, or tensors is not approved by this design PR.**
- If real inference later requires frames/pixels/tensors, that requires a **separate future
  design/implementation PR** (phase H2) proving local-only operation, no persistence, bounded
  backpressure, crash behavior, safe diagnostics, and platform-specific IPC security (§13). The H1
  prototype must work entirely on **synthetic** data with no camera access.

## 7. Startup / Shutdown Protocol (prose)

Intended handshake between Native Core (supervisor) and the helper:

- **Start:** Native Core spawns the helper and waits for a `ready` signal (a structured line on the
  chosen stdout channel) within a bounded timeout.
- **Ready:** the helper announces it is initialized and able to accept control messages / produce
  results.
- **Health:** the helper periodically signals liveness (e.g. heartbeat or the steady result/diagnostic
  stream); Native Core treats prolonged silence as a hang.
- **Stop:** Native Core sends an explicit `stop` control message and waits a bounded time for graceful
  exit before terminating the process.
- **Error:** the helper reports structured error states; Native Core records safe diagnostics and
  applies the fallback policy (§9).
- **Failure to start:** if `ready` does not arrive within the timeout, Native Core abandons the helper,
  keeps emitting a safe MotionFrame shape (status `lost`/`not_started` as appropriate per
  `docs/TRACKING_SPEC.md` §5), and may attempt a bounded restart (§9).

## 8. Backpressure and Dropped-Frame Policy

- **H1 (non-camera prototype):** the helper produces synthetic results at a controlled rate; Native
  Core consumes the latest result and never accumulates an unbounded queue. No raw frames exist, so
  there is no frame backpressure to manage yet.
- **Future real frame access (H2+):** a **bounded queue only** — drop oldest / coalesce to the latest;
  **no unbounded buffering**. This rule must be specified and reviewed in the H2 design PR before any
  frame crosses the boundary.

## 9. Crash / Hang Recovery

- Native Core detects helper crash (process exit) or hang (missed health/heartbeat) within a bounded
  window.
- Policy: **bounded restart** (limited retries with backoff) or **fallback to `lost`** if restart
  fails.
- During and after failure, **Native Core keeps emitting a safe MotionFrame shape** — lower
  `tracking.confidence`, set `tracking.status = "lost"`, and let the renderer hold/smooth the last
  valid pose (`docs/TRACKING_SPEC.md` §5).
- **No MotionFrame schema change** is introduced by any of this.

## 10. Diagnostics

- **Safe stderr metadata only**, reusing the existing pattern (timing fields such as a helper
  `inferenceMs`, has-result / lost counts) consistent with `docs/TRACKING_BACKEND_EVALUATION.md`.
- **Never** emit raw pixels, images, screenshots, frame dumps, model contents, or sensitive
  filesystem paths in diagnostics.
- **stdout stays structured JSON** for the selected process boundary; diagnostics stay on stderr.

## 11. Security / Privacy Checklist

Before any implementation beyond H0, the following must hold and be demonstrated:

- [ ] local-only operation
- [ ] no upload
- [ ] no telemetry
- [ ] no analytics
- [ ] no external frame processing
- [ ] no raw frame persistence
- [ ] no temporary files for frame transport
- [ ] platform-specific IPC security defined (loopback-only binding, pipe ACLs, or equivalent)
- [ ] safe diagnostics only (no raw pixels/images/paths)
- [ ] bounded backpressure (no unbounded buffering) once frames are involved

## 12. Non-Goals

- No backend selection.
- No MediaPipe production approval.
- No Python runtime production approval.
- No model/task bundling approval.
- No helper IPC implementation.
- No raw frame / pixel / tensor IPC approval.
- No MotionFrame schema change.
- No camera/webcam validation.
- No Electron or Web Preview backend dependency.
- No dependency, package, lockfile, Native Core source, Electron, Web Preview, or Motion Protocol
  change.

## 13. Gates Before Real Frame Access (H2)

Any future PR that lets the helper touch raw frames, pixels, or tensors must prove, before code lands:
local-only operation; no persistence; no upload; no telemetry; no analytics; no external frame
processing; safe diagnostics only; defined backpressure (bounded queue); defined crash behavior; and
platform-specific IPC security. This mirrors `docs/TRACKING_HELPER_PROCESS_ARCHITECTURE.md` §5 and is
restated here as the H2 entry condition.

## 14. Next-Step Recommendation

Recommend a future, **separate** implementation spike **only after this design is reviewed**. The
first spike (phase **H1**), if approved later, should be small and must avoid raw camera frames:

1. Native Core launches a dummy/synthetic helper process.
2. The helper returns compact **synthetic** internal tracking results (no camera, no model).
3. Native Core maps those results to the **existing** MotionFrame schema (no schema change).
4. This proves lifecycle, process supervision, IPC shape, fallback, and diagnostics before any real
   model or raw frame access is ever designed (H2) or integrated (H3).

Do not implement H1 in this PR. This document is design-only.

## Non-Selection Statement

- The helper process is **not** selected for production; this is a prototype design candidate.
- MediaPipe Face Landmarker is **not** selected; Python Tasks remains reference/feasibility only.
- Model/task file bundling is **not** approved. Raw frame IPC is **not** approved.
- No tracking backend is selected. No dependency is added to LVK. No IPC is implemented.
- No MotionFrame schema change is made. No camera/webcam validation was performed.
- Camera frames must stay local; no upload, telemetry, analytics, or external frame processing.
- Any production integration requires a separate implementation / dependency / model packaging PR.
