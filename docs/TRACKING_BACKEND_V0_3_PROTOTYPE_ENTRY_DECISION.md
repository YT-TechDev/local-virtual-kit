# Tracking Backend v0.3 Prototype Entry Decision

## Status

Status: docs-only owner-decision record for issue #426, entered under umbrella issue #400.
Scope: records which candidate direction #400 should explore first and the smallest safe
next PR-sized implementation slice. This document adds no dependency, model/task/cascade
file, production runtime wiring, or MotionFrame schema change.

## Purpose

#100 (local diagnostics evidence) and #401 (packaged Electron runtime validation follow-up)
are closed. #400 (prototype the next local tracking backend behind the Native Core boundary)
remains open and explicitly must not start by adding a backend dependency or model asset. This
document converts the evidence already recorded in `docs/TRACKING_BACKEND_EVALUATION.md` and
`docs/reports/packaged-electron-runtime-validation-follow-up-2026-07-08.md` into a small,
source-grounded prototype entry decision for #400.

## Evidence Reviewed

- `docs/TRACKING_BACKEND_EVALUATION.md` Pass 1–5 diagnostics (2026-06-16 through 2026-07-08),
  including the MediaPipe Face Landmarker Python Tasks feasibility spike (Pass 4), the C++/Bazel
  reconnaissance and build spike (Pass 5/6 follow-ups, blocked on `rules_swift`/Windows), and the
  Pass 5 (2026-07-08) re-confirmation that the Native Core-owned helper-process H1 contract and H2
  synthetic smokes (`--helper-runtime-smoke`, `lvk-helper-result-mapping-smoke`,
  `lvk-helper-process-supervision-smoke`, `lvk-helper-h2-state-machine-smoke`) all pass on `main`.
- `docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md`: the project owner
  has already selected **Option B** for issue #405 — docs-only production-runtime planning may
  proceed, but production implementation, default runtime wiring, backend/model/runtime selection,
  real camera access, and readiness claims remain separately gated and not approved.
- `docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md`: confirms the same
  boundary — planning-only PRs (supervisor policy proposal, fallback MotionFrame behavior
  proposal, local/manual validation plan) are allowed; implementation and backend selection are not.
- `docs/reports/packaged-electron-runtime-validation-follow-up-2026-07-08.md`: confirms the current
  `main` packages and launches cleanly with the H2 helper-runtime guard work included, but full
  in-app native-pipeline GUI validation and browser/OBS visual observation against current `main`
  remain owner-performed follow-ups, not yet re-run.
- `docs/ROADMAP.md` Phase 6.5 / v0.3+ direction: continue toward a better local tracking backend
  and calibration/smoothing polish without weakening the local-first privacy boundary.

## Decision

### Candidate direction for v0.3

No new backend dependency, model file, or in-process runtime is selected or added by this
decision. The candidate direction to keep exploring first is the **Native Core-owned
helper-process boundary already built through H1 (synthetic contract) and H2 (synthetic
smokes)**, as the eventual host for a MediaPipe Face Landmarker-shaped candidate — not the
in-process C++ MediaPipe Framework / Bazel route, which remains blocked on Windows
(`rules_swift` toolchain failure, confirmed twice in Pass 5/6 and Pass 7 follow-ups) and not yet
retried.

Rationale:

- MediaPipe Face Landmarker (Python Tasks route) is the only candidate with confirmed output
  fields (478 landmarks, 52 blendshapes, a 4x4 transform) and a documented, schema-preserving
  MotionFrame mapping (Pass 4). It remains the most evidenced product-quality candidate.
- The in-process C++/Bazel route is not currently viable on this Windows DevPC without further,
  unapproved toolchain work (Swift toolchain missing; no official CMake path).
- OpenCV Haar remains confirmed only as a smoke/baseline path (~34 ms/frame at 640x480, no
  detection-quality evaluation) and is explicitly not product-quality VTuber tracking.
- The helper-process boundary is the only path with a passing, source-grounded synthetic
  prototype on `main` today (Pass 5, 2026-07-08), so it is the correct place to continue
  low-risk, non-dependency prototype work while backend/runtime selection stays gated.
- The owner has already recorded Option B for the H2 production-runtime gate: docs-only
  production-runtime planning may proceed, but backend/model/runtime selection and
  implementation remain separately gated. This decision does not reopen or exceed that gate;
  it stays inside it.

This is **not** a final backend selection. No dependency, model/task file, or production wiring
is approved by this document.

### Smallest next PR-sized implementation slice

The smallest safe next slice for #400 is a **docs-only production-runtime planning proposal**,
scoped to one narrow topic already explicitly permitted by Option B, for example:

- a source-grounded fallback MotionFrame behavior proposal (what the helper-process boundary
  should emit on the current MotionFrame schema when the helper is absent, slow, or crashed), or
- a source-grounded supervisor policy proposal (restart/backoff rules, still design-only, no
  implementation).

Either topic builds directly on the passing H2 synthetic prototype without adding a dependency,
model file, or runtime behavior change, and without selecting a backend. If, instead, further
synthetic-only test coverage of the existing H1/H2 contract is judged more valuable than a
planning document, that is an acceptable alternative smallest slice (matching the pattern of
recent merged PRs such as #418, #420, #422, #424), provided it adds no dependency or backend
selection.

### Out of scope for that first slice

- No backend dependency addition (MediaPipe, ONNX Runtime, or any other runtime package).
- No model/task/cascade file addition or download-and-commit.
- No production H2 integration, default `lvk-tracker-core` runtime wiring, or production helper
  supervisor/fallback behavior implementation.
- No MotionFrame schema change or Motion Protocol change.
- No Electron or Web Preview runtime dependency change.
- No real camera / webcam / OBS / GUI validation claim.
- No raw frame / pixel / tensor IPC approval.
- No telemetry, analytics, cloud upload, remote inference, external frame processing, hidden
  network calls, runtime downloads, or new network behavior.
- No claim that #400 or #405's production-runtime gate is closed; both remain open.

### Validation that would prove the slice

Without overclaiming product-quality tracking, the next slice should be considered proven only if:

- `pnpm format:check` and `pnpm test:motion-validator-import` pass (or the equivalent test suite
  for any synthetic smoke added);
- any new synthetic H2 smoke added exercises the existing helper contract only, with stdout
  remaining MotionFrame JSON and diagnostics remaining safe stderr metadata;
- any planning document is explicit about what remains unapproved (implementation, backend
  selection, default runtime wiring, readiness claims);
- no local/manual camera, Electron GUI, or OBS validation is claimed unless actually performed
  and recorded per `docs/LOCAL_RUNTIME_CHECKLIST.md`.

## Evidence Gaps and Limits

- MediaPipe Face Landmarker tracking quality, jitter, and lost-face rate under real conditions
  remain unmeasured (Pass 4 was a single-frame feasibility spike, not a quality evaluation).
- The MediaPipe model/task file license and full redistribution terms still require review before
  any production bundling decision (partially reviewed 2026-06-16; see
  `docs/MEDIAPIPE_FACE_LANDMARKER_RESEARCH.md`).
- The C++/Bazel in-process route has not been retried past the `rules_swift` blocker; it is not
  proven infeasible, only unproven and currently blocked.
- Full in-app native-pipeline GUI validation and browser/OBS visual observation against current
  `main` (post H2 helper-runtime guard work) have not been re-run since 2026-06-30; this decision
  does not rely on or claim that validation.
- No camera/webcam validation was performed to produce this decision document.

## Confirmation

- #400 remains open.
- #405 / H2 production-runtime implementation remains separately gated (Option B: docs-only
  planning only).
- No backend dependency, model/task/cascade file, MotionFrame schema change, Motion Protocol
  change, Electron/Web Preview dependency change, or production runtime behavior change is made
  by this document.

## Decision Record

```md
## Tracking Backend Decision Record

- Date: 2026-07-08
- Candidate: none selected; direction to continue exploring is MediaPipe Face Landmarker behind
  the Native Core-owned helper-process boundary (H1/H2 synthetic prototype already on `main`)
- Local-only status: confirmed for all evidence collected to date (Pass 1-5)
- Required runtime/dependencies: none added by this decision
- Required model/data files: none added by this decision
- MotionFrame schema impact: none
- Measured diagnostics: see `docs/TRACKING_BACKEND_EVALUATION.md` Pass 1-5
- Packaging notes: see `docs/reports/packaged-electron-runtime-validation-follow-up-2026-07-08.md`
- Privacy notes: no raw frame upload, telemetry, analytics, or external processing in any evidence pass
- Decision: continue helper-process boundary work with a docs-only production-runtime planning
  slice or additional synthetic H2 coverage; do not select or implement a backend yet
- Follow-up PRs: one narrow docs-only production-runtime planning PR (fallback MotionFrame
  behavior or supervisor policy), scoped under #400, staying inside the Option B gate
```

## References

- `docs/TRACKING_BACKEND_EVALUATION.md`
- `docs/MEDIAPIPE_FACE_LANDMARKER_RESEARCH.md`
- `docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md`
- `docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md`
- `docs/reports/packaged-electron-runtime-validation-follow-up-2026-07-08.md`
- `docs/ROADMAP.md`
