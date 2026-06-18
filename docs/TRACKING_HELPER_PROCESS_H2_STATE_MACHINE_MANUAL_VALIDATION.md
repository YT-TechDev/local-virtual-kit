# Tracking Helper Process H2 State Machine Manual Validation

## Status

Status: H2 state-machine manual local validation checklist design memo.
Scope: documentation-only design narrowing.
This is not an implementation plan; no manual validation is performed and no tests are
implemented in this PR.
This document does not approve H2 implementation, IPC implementation, test implementation,
restart / backoff implementation, real frame access, raw frame / pixel / tensor IPC, high-rate
raw frame transport, production backend selection, or H3 production integration.

This memo proposes a future **manual local validation checklist** for the helper handshake /
state machine. It builds on
[`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md),
[`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md),
and the claim rules in
[`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md).

## Summary

- Describes how a future operator would **manually validate** the designed startup / liveness
  / shutdown / error-handling state machine on a local machine.
- Defines validation principles, per-phase checklists, safe-evidence fields, and explicit
  "what must not be claimed" guardrails.
- This is a **design direction only**. No manual validation is performed, no tests are
  implemented, and nothing is approved here. The checklist becomes meaningful only once an H2
  prototype is separately approved and built.

## Scope

- Covers a manual local validation **checklist** and **safe-evidence recording** for the
  designed state machine only.
- Excludes any frame transport, backend selection, MotionFrame schema change, and any actual
  validation run.
- All recorded evidence stays **Native Core-internal** in classification terms; it is never
  public MotionFrame and never raw data.

## Manual Validation Principles

- Manual validation must be performed **only on a local developer machine**.
- Do **not** claim OBS, webcam / OpenCV, Electron GUI, OS camera permission, or native
  hardware validation unless it was **actually performed** on a suitable local machine with the
  required hardware, permissions, and build (`docs/LOCAL_RUNTIME_CHECKLIST.md`).
- Do **not** use Codex Cloud / headless CI / cloud runners to claim local manual validation.
- Capture only **safe evidence**: command names, pass / fail result, timestamps, stdout /
  stderr **classification** (not payloads), state names, and MotionFrame `status` / `confidence`
  values.
- Do **not** record raw pixels, screenshots, images, tensors, model contents, sensitive
  filesystem paths, secrets, or private helper stdout / stderr payloads.
- Public stdout must remain **MotionFrame JSON only**.

## Preconditions

- An H2 prototype has been **separately approved and built** (this memo does not approve or
  build it).
- The helper is **synthetic only** — no camera, no model, no real frames.
- **Native Core owns camera capture**; the helper never opens the camera.
- Bounded startup / liveness / shutdown timeouts are defined per the handshake memo.

## Validation Environment

- A local developer machine only.
- Record OS and relevant toolchain versions (see the reporting shape in
  `docs/LOCAL_RUNTIME_CHECKLIST.md`).
- This checklist asserts **nothing** about cloud or CI environments.

## Startup Validation Checklist

- [ ] The helper launch path is **local** (no network, no upload).
- [ ] `ready` arrives **before the bounded startup timeout** → state reaches `running`.
- [ ] When `ready` does not arrive in time, startup **timeout falls back safely**
      (`waiting_for_ready` → `timed_out` → `fallback`).
- [ ] **Launch failure** falls back safely (`launching` → `failed` → `fallback`).

## Runtime Liveness Validation Checklist

- [ ] A steady stream of `heartbeat` / `result` keeps the machine in `running`.
- [ ] **Missed heartbeat / prolonged silence** transitions to `timed_out` then `fallback`.
- [ ] There is **no unbounded helper output accumulation**; Native Core keeps producing
      MotionFrame.

## Shutdown Validation Checklist

- [ ] `stop` is sent (`running` → `stopping`).
- [ ] A **clean exit** transitions to `exited`.
- [ ] A **shutdown timeout** terminates the helper and records safe diagnostics.

## Error / Timeout Validation Checklist

- [ ] **Malformed JSON** does not crash Native Core (line dropped, safe diagnostic).
- [ ] An **unknown message type** is ignored with a safe diagnostic.
- [ ] An **oversized message** is rejected with a safe diagnostic.
- [ ] A **non-zero exit** transitions to `failed` then `fallback`.

## Diagnostics Safety Checklist

- [ ] Helper `stderr` contains **safe metadata only** (no raw data).
- [ ] Helper `stdout` / `stderr` are **not forwarded** to public stdout.
- [ ] **Unsafe diagnostics** are treated as a **policy violation / fail closed**.

## Public Stdout Safety Checklist

- [ ] `lvk-tracker-core` public stdout contains **MotionFrame JSON only** throughout every
      phase (startup, running, error, shutdown, fallback).

## Fallback MotionFrame Checklist

- [ ] Fallback uses only current MotionFrame fields:
  - `tracking.status`
  - `tracking.confidence`
- [ ] For helper failure, prefer `tracking.status = "lost"` and `tracking.confidence = 0` (or a
      lowered value).
- [ ] No stale fields are introduced — no `face.detected`, no `head.yaw`, no `eyes.blink`.
- [ ] Renderer-visible behavior remains **MotionFrame-only**.

## Evidence to Record

Record only safe-evidence classifications (never raw payloads):

- `validation_id`
- `environment`
- `command_or_flow`
- `expected_state_path`
- `observed_state_path`
- `expected_public_stdout`
- `observed_public_stdout_classification`
- `expected_private_diagnostics`
- `observed_private_diagnostics_classification`
- `fallback_observed`
- `result`
- `notes`

## What Must Not Be Claimed

- Do **not** claim OBS, webcam / OpenCV, Electron GUI, OS camera permission, or native hardware
  validation unless it was actually performed on a suitable local machine.
- Do **not** claim local manual validation from Codex Cloud, headless CI, or cloud runners.
- Do **not** record or claim raw frame / pixel / tensor evidence.
- Do **not** make performance, network, telemetry, or cloud validation claims.

## Out-of-Scope Validation

- Real camera validation.
- OBS validation.
- Electron GUI validation.
- OS camera permission validation.
- Production backend validation.
- MediaPipe / Python / ONNX validation.
- Real frame / pixel / tensor validation.
- Performance validation.
- Network validation.
- Cloud or telemetry validation.

## What Remains Unapproved

- H2 implementation.
- IPC implementation.
- Test implementation.
- Restart / backoff implementation.
- Real frame access.
- Raw frame / pixel / tensor IPC.
- High-rate raw frame transport.
- Helper-owned camera capture.
- Production helper backend.
- MediaPipe / Python runtime / ONNX Runtime production approval.
- Model / task bundling.
- MotionFrame schema change.
- Electron / Web Preview / Motion Protocol changes.

## Future Approval Gates

Before any manual validation run:

- [ ] owner approval recorded
- [ ] H2 prototype built under separate approval
- [ ] local-only operation
- [ ] no upload
- [ ] no telemetry
- [ ] no analytics
- [ ] no external frame processing
- [ ] no raw frame persistence
- [ ] bounded backpressure documented
- [ ] crash / hang behavior documented
- [ ] safe diagnostics only
- [ ] platform-specific IPC security documented
- [ ] no MotionFrame schema change

## Next Recommended Step

- The project owner reviews this manual local validation checklist.
- A future **docs-only** PR may add a helper prototype cleanup / docs maintenance PR, or — only
  under explicit owner approval — begin a scoped H2 prototype design-to-implementation gate.
- No implementation until explicit owner approval is recorded.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check plan and test vectors this checklist mirrors.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and state machine being validated.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — pipe message / framing contract and message types.
- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first H2 IPC direction (private parent-child pipe).
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — Native Core camera ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
  — H2 design gates and open questions.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design, startup/shutdown (§7), crash/hang (§9), diagnostics (§10).
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation
  claim rules and reporting template.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
