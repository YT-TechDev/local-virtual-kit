# Tracking Backend v0.3 Implementation Entry Decision

## Status

Status: docs-only owner-decision record for issue #436, under umbrella issue #400.
Scope: selects the smallest next implementation-entry slice after the v0.3 backend prototype entry decision, H2 production-runtime supervisor policy proposal, helper launch / ready-timeout fail-closed guard work, and H2 supervisor fail-closed coverage inventory.

This document does not implement source code, add dependencies, add model/task/cascade files, change runtime behavior, change the default `lvk-tracker-core` path, wire production H2 behavior, change MotionFrame schema, or change Motion Protocol. #400 remains open.

## Context Reviewed

- `docs/TRACKING_BACKEND_V0_3_PROTOTYPE_ENTRY_DECISION.md` recorded that #400 should continue through the Native Core-owned helper-process boundary without selecting or adding a backend dependency, model file, or production runtime wiring.
- `docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SUPERVISOR_POLICY_PROPOSAL.md` proposed production-runtime supervisor policy as design-only, not implementation approval.
- `docs/TRACKING_HELPER_PROCESS_H2_SUPERVISOR_FAIL_CLOSED_GUARD_COVERAGE_INVENTORY.md` confirmed current H2 helper-runtime-smoke fail-closed guard coverage and recommended moving to the next #400 implementation-entry decision.
- `docs/TRACKING_BACKEND_EVALUATION.md` continues to treat dummy/noop as the safe deterministic default, OpenCV Haar as a smoke/baseline path only, and MediaPipe / ONNX-style candidates as unselected until dependency, model, packaging, runtime, and validation evidence exists.

## Decision

The next smallest implementation slice under #400 should be a **no-dependency synthetic backend/helper adapter slice behind the Native Core boundary**.

This slice is selected over these alternatives:

- **OpenCV Haar baseline preservation/improvement slice:** not selected as the next #400 entry because Haar remains an optional rectangle-detector smoke/baseline path, not product-quality VTuber tracking. It should stay preserved, but improving it now would not answer the helper-boundary implementation-entry question.
- **Packaging/runtime availability slice:** not selected because production H2 default runtime wiring, runtime downloads, helper packaging assumptions, and distribution readiness remain unapproved and would overreach the current evidence.
- **No implementation yet:** not selected because #426, #429, #431, #432, and #434 have reduced the immediate H2 supervisor evidence gap enough to allow a narrow synthetic-only implementation-entry slice, provided it stays explicit-smoke-only or test-only and changes no defaults.

## Allowed Touch Areas for the Next Implementation PR

The next implementation PR may touch only the minimum files needed for an explicit synthetic adapter smoke/test path, such as:

- Native Core helper-runtime smoke/test code under `native/tracker-core/src/`, limited to explicit `--helper-runtime-smoke` or equivalent test-only/smoke-only seams.
- Synthetic helper fixtures or helper-smoke scripts under existing test/tooling locations such as `tools/`, only when they emit or validate safe synthetic records and never require camera frames.
- Existing package scripts or test wiring only if needed to run the new smoke/check explicitly, without changing default runtime behavior.
- A short docs note or decision follow-up under `docs/`, if needed to record what the synthetic slice proves and does not prove.

The PR should prefer the smallest possible file set and should preserve existing dummy/noop and OpenCV Haar baseline paths.

## Required Out of Scope for the Next Implementation PR

The next implementation PR must not:

- change default `lvk-tracker-core` behavior;
- wire the helper runtime into production defaults;
- add MediaPipe, ONNX Runtime, or any real backend/runtime dependency;
- add model, task, cascade, binary, generated package, or runtime-download artifact files;
- add runtime download behavior or new network behavior;
- implement production fallback MotionFrame behavior;
- implement production retry/backoff behavior;
- add real camera access changes or helper-owned camera capture;
- approve raw frame, pixel, or tensor IPC;
- change Native Core public output fields, MotionFrame schema, Motion Protocol, renderer mapping, Electron behavior, Web Preview behavior, or Electron/Web Preview dependencies;
- add telemetry, analytics, cloud upload, remote inference, external frame processing, hidden network calls, or readiness claims;
- claim webcam, OBS, Electron GUI, local/manual, or product-quality tracking validation unless actually performed and recorded under the local validation policy.

## Validation Bar for the Synthetic Slice

The synthetic implementation slice should be considered proven only when it demonstrates the adapter/helper boundary without claiming product-quality VTuber tracking:

- existing MotionFrame validator import checks still pass;
- formatting still passes;
- helper-runtime or MotionFrame smoke coverage proves stdout remains MotionFrame JSON where expected and diagnostics remain safe stderr metadata;
- synthetic helper records do not expose raw frames, pixels, tensors, private helper stdout/stderr, local paths, logs, screenshots, or generated artifacts;
- failure paths remain fail-closed for the explicit smoke path and do not introduce default fallback behavior;
- dummy/noop and OpenCV Haar baseline behavior remain preserved.

Recommended validation commands for the decision PR and the next implementation PR:

```bash
pnpm format:check
pnpm test:motion-validator-import
```

Any additional implementation-specific smoke/check command must be recorded exactly in the PR that adds it.

## Evidence Needed Before Any Real Backend Dependency or Production Wiring

Before LVK adds a real backend dependency, model file, task file, cascade file, runtime download, helper packaging/default wiring, or production default behavior, a separate decision/evidence PR must document:

- local-only operation with camera frames staying local and no upload, telemetry, analytics, remote inference, external frame processing, hidden network calls, or runtime downloads;
- exact dependency/runtime package names, versions, licenses, notices, platform support, build flags, binary-size impact, and maintenance risks;
- exact model/task/cascade/data artifact identity, source, version, license, redistribution terms, notices, expected storage location, and update policy;
- packaging/runtime availability behavior for local development and future distribution, without relying on undeclared downloads;
- measured local diagnostics for startup/shutdown, effective FPS, frame timing, lost/no-face behavior, stability, and stderr-only safe metadata;
- mapping from backend output into the current MotionFrame schema, or a separate explicit Motion Protocol schema-change proposal if the current schema is insufficient;
- fallback, timeout, crash, retry/backoff, and readiness policy that has been approved before production implementation;
- confirmation that Electron, Web Preview, and Motion Protocol do not gain backend runtime dependencies.

## Confirmation

- Selected next implementation slice: **no-dependency synthetic backend/helper adapter slice behind the Native Core boundary**.
- The slice should be explicit-smoke-only or test-only.
- No real backend, model asset, runtime dependency, runtime download, production default wiring, MotionFrame schema change, or Motion Protocol change is approved.
- Dummy/noop and OpenCV Haar baseline paths must be preserved.
- #400 remains open after this decision and after the next narrow implementation-entry PR.
