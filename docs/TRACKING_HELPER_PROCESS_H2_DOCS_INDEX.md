# Tracking Helper Process H2 Docs Index

## Status

Status: H2 design-doc navigation / status index.
Scope: documentation-only navigation summary; no new design decisions.
This document does not approve H2 implementation, IPC implementation, real frame access, or any
backend.

## Purpose

This index is the single place to find the H2 helper-process design documents, their reading
order, the current design state, and the one authoritative next step.

The H2 design **readiness review** is the authoritative latest phase status:
[`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md).
The earlier H2 point-in-time next-step notes have been reconciled. For current phase status,
use this index and the H2 design readiness review. The scoped H2 prototype
implementation-gate is now documented in
[`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md);
any future scoped prototype implementation still requires explicit project-owner approval. No
H2 implementation is approved by this document.

## H2 Docs Reading Order

1. [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_PREPARATION.md)
   — H2 design gates, frame-ownership options, and open questions.
2. [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
   — prefer Native Core camera ownership; helper-owned capture not approved.
3. [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
   — first IPC direction: a Native Core-owned private parent-child pipe.
4. [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
   — UTF-8 newline-delimited JSON framing, channel roles, bounds, safe diagnostics.
5. [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
   — startup / liveness / shutdown states, transitions, and fail-closed fallback.
6. [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
   — automated-check goals and representative design-only test vectors.
7. [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_MANUAL_VALIDATION.md)
   — manual local validation checklist and safe-evidence / claim rules.
8. [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
   — H2 design-doc phase closeout / readiness review (authoritative latest status).
9. [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
   — scoped prototype implementation-gate: intended scope, anticipated changed files, and the
   gates a future implementation PR must satisfy (grants no approval).
10. [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)
    — owner decision approving a future synthetic-only scoped prototype PR, bounded by the gate
    (records approval only; implements nothing).
11. [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
    — closeout for the first implemented synthetic-only H2 slice (PR #147,
    `lvk-helper-h2-state-machine-smoke`); records implementation state, not production integration.
12. [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
    — closeout for the startup-timeout synthetic vector (PR #149,
    `startup_timeout_fallback`); records implementation state, not production integration.
13. [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
    — gate / decision for the next synthetic-only slice: a narrowly scoped helper-output error
    vector group (malformed / unknown / oversized); records the decision and future gates,
    implements nothing.
14. [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md)
    — closeout for the unknown-message-type synthetic vector (PR #152,
    `unknown_message_type_safe_ignore`); the first helper-output error vector under the gate,
    records implementation state, not production integration.
15. [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md)
    — closeout for the malformed-line synthetic vector (PR #154, case key `malformed_line`); the
    second helper-output error vector under the gate; records implementation state without claiming
    parser-level safe-drop semantics.
16. [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md)
    — scope / gate for the then-remaining `oversized_message_reject` candidate: records
    source-grounded size/capture findings and the smallest safe future implementation shape and
    honest naming; implements nothing.
17. [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
    — closeout for the oversized-line synthetic vector (PR #157, case key
    `oversized_line_rejected`); the final helper-output error vector under the gate; records
    implementation state without claiming production supervisor size policy or general
    backpressure semantics.
18. [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
    — scope / gate for a future helper shutdown / stop / control-channel slice: records that the
    `stop` handshake is designed-only (not implemented), lists the decisions that must be settled
    before implementation, and keeps shutdown / control gated before production wiring; implements
    nothing.
19. [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
    — docs-only plan for the smallest future synthetic shutdown smoke slice; records candidate
    vectors and invariants while leaving shutdown / control implementation unapproved.
20. [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md)
    — docs-only gate selecting only `shutdown_graceful_exit` as the first future synthetic shutdown
    smoke slice; keeps other shutdown vectors unapproved.

Background:

- [`docs/TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md`](TRACKING_HELPER_PROCESS_H1_CLOSEOUT_REVIEW.md)
  — H1 synthetic-prototype closeout review.
- [`docs/TRACKING_HELPER_PROCESS_H1_COMPLETION.md`](TRACKING_HELPER_PROCESS_H1_COMPLETION.md)
  — H1 completion criteria and slice status.
- [`docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md`](TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md)
  — prototype design and phase boundaries (H0–H3).

## Current H2 Design State

- The H2 design-doc phase is complete.
- The first synthetic-only H2 state-machine smoke is implemented (PR #147):
  `lvk-helper-h2-state-machine-smoke`, a standalone Native Core executable that validates the
  normal / failure / timeout-silence lifecycle state paths using the existing synthetic helper
  and supervisor. See
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md).
- The startup-timeout synthetic vector is implemented (PR #149): the `startup_timeout_fallback`
  case (`not_started -> launching -> waiting_for_ready -> timed_out -> fallback`) added to the
  same smoke, covering a pure startup timeout where `ready` is not emitted before the bounded
  startup timeout. See
  [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md).
- The first helper-output error vector under the gate is implemented (PR #152): the
  `unknown_message_type_safe_ignore` case added to the same smoke, where an unknown-type helper
  output line is captured only in private helper stdout and does not corrupt the reconstructed
  lifecycle path (`not_started -> launching -> waiting_for_ready -> ready -> running -> exited`).
  See
  [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md).
- The malformed-line vector is implemented (PR #154): the `malformed_line` case added to the same
  smoke, where a short, intentionally invalid helper output line is captured only in private helper
  stdout and does not corrupt the normal lifecycle path
  (`not_started -> launching -> waiting_for_ready -> ready -> running -> exited`). With the current
  parser-free smoke style it does not claim parser-level safe-drop semantics. See
  [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md).
- The oversized-line vector is implemented (PR #157): the `oversized_line_rejected` case added to
  the same smoke, where a deterministic bounded synthetic oversized line emitted after `ready` is
  marked rejected by the smoke-local / test-only `kMaxHelperLineBytesForSmoke = 1024` limit and
  excluded from lifecycle marker reconstruction. This closes the final helper-output error vector at
  the synthetic-smoke level without defining production supervisor size policy or general
  backpressure semantics. See
  [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md).
- The helper-output error vector group is now covered at the synthetic-smoke level (PR #152 /
  #154 / #157). A docs-only shutdown / control-channel scope gate records the decisions that must
  be settled before any helper stop / control-channel implementation begins; the `stop` handshake
  remains designed-only (not implemented), and shutdown / control stays gated before production
  wiring. See
  [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md).
- The synthetic shutdown smoke plan is docs-only; it records candidate future vectors and invariants,
  but shutdown / control implementation remains unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md).
- The graceful shutdown smoke gate selects only `shutdown_graceful_exit` as the first future slice and
  keeps all other shutdown vectors unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md).
- No production H2 integration exists; the default `lvk-tracker-core` runtime remains unchanged
  (the helper is not wired into it).
- No real frame access, helper-owned camera capture, new dependency, or MotionFrame schema
  change exists.
- Camera ownership, the first IPC direction, the framing contract, the state machine, the
  automated-check goals / test vectors, and the manual-validation claim rules remain **design
  documents**.

## Safety Boundaries

These boundaries are preserved across all H2 docs:

- Native Core remains the only camera owner.
- The helper must not open the camera.
- Native Core remains the only public MotionFrame producer.
- Helper stdout remains private to Native Core.
- Helper stderr is safe diagnostics only.
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- MotionFrame schema remains unchanged.
- `packages/motion-protocol` must not gain helper runtime dependencies.
- No raw frame / pixel / tensor IPC is approved.
- No high-rate raw frame transport is approved.
- No helper-owned camera capture is approved.
- No new network behavior is approved.
- Temporary files for frame transport remain rejected.
- Loopback sockets remain non-default.
- Shared memory / mmap remains deferred.

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

## Next Recommended Step

- **First slice merged:** the first synthetic-only H2 state-machine smoke is implemented and
  merged (PR #147), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md).
  It satisfied the implementation gate
  ([`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md))
  and the owner decision
  ([`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)).
- **Startup-timeout vector merged:** the `startup_timeout_fallback` vector is implemented and
  merged (PR #149), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md).
- **Unknown-message vector merged:** the `unknown_message_type_safe_ignore` vector — the first
  helper-output error vector under the gate — is implemented and merged (PR #152), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md).
- **Malformed-line vector merged:** the `malformed_line` vector — the second helper-output error
  vector under the gate — is implemented and merged (PR #154), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md).
- **Oversized-line vector merged:** the `oversized_line_rejected` vector — the final helper-output
  error vector under the gate — is implemented and merged (PR #157), recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md).
- **Helper-output error vector group covered:** unknown-message, malformed-line, and oversized-line
  coverage now exists at the synthetic-smoke level. Shutdown / control-channel vectors still require
  a separate scope decision before implementation.
- **Shutdown / control-channel scope gate added:** the decisions that must be settled before any
  helper shutdown / stop / control-channel implementation are recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md).
  It implements nothing; the `stop` handshake remains designed-only, and shutdown / control stays
  gated before production wiring.
- **Synthetic shutdown smoke plan added:** candidate shutdown smoke vectors are recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md).
- **Graceful shutdown smoke gate added:** the next step is read-only review of
  [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md)
  before any implementation.
- No production H2 integration, no default `lvk-tracker-core` runtime wiring, and no real frame
  access until separately scoped and approved. All safety boundaries remain preserved.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  — authoritative latest H2 phase status.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — scoped prototype implementation-gate (intended scope, anticipated changed files, gates).
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md)
  — owner decision approving a future synthetic-only scoped prototype PR (bounded by the gate).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147).
- [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
  — closeout for the startup-timeout synthetic vector (PR #149).
- [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
  — gate / decision for the next synthetic-only helper-output error vector slice.
- [`docs/TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNKNOWN_MESSAGE_SMOKE_CLOSEOUT.md)
  — closeout for the unknown-message-type synthetic vector (PR #152).
- [`docs/TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_MALFORMED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the malformed-line synthetic vector (PR #154).
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md)
  — scope / gate for the oversized helper-output vector.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the oversized-line synthetic vector (PR #157).
- [`docs/TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_SHUTDOWN_CONTROL_SCOPE_GATE.md)
  — scope / gate for a future helper shutdown / stop / control-channel slice (designed-only `stop`
  handshake; decisions required before implementation).
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SHUTDOWN_SMOKE_PLAN.md)
  — docs-only plan for a future synthetic shutdown smoke slice; implementation remains unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate selecting only `shutdown_graceful_exit` as the first future shutdown smoke slice.
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation
  claim rules and reporting template.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
