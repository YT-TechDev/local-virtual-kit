# Tracking Helper Process H2 Docs Index

## Status

Status: H2 design-doc navigation / status index.
Scope: documentation-only navigation summary; no new design decisions.
This document does not approve H2 implementation, IPC implementation, real frame access, or any
backend.

## Purpose

This index is the single place to find the H2 helper-process design documents, their reading
order, the current design state, and the one authoritative next step.

The current active H2 boundary is the first H2 foundation implementation gate decision:
[`docs/TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md).
H2 Narrow Implementation Gates 1 through 7 are closed at the synthetic/smoke checker level and are
not reopened. Gate 7 is implemented only for helper runtime normal-path zero-frame public stream
guard coverage on the explicit `lvk-tracker-core --helper-runtime-smoke <helper> --frames 0` path;
it does not approve production runtime behavior. Foundation Gate 1 produced a docs-only
source-grounded inventory and runtime boundary map and is complete. The first foundation
implementation gate decision selects a future Native Core-only, explicit-smoke-only foundation
boundary assertion slice, but implementation remains unstarted and unapproved until a future
implementation PR is reviewed and merged. Production H2 integration, default helper runtime wiring,
default `lvk-tracker-core` H2 runtime wiring, production supervisor behavior, fallback MotionFrame
behavior and emission, production diagnostics-safety policy behavior, MotionFrame schema changes,
Motion Protocol changes, Electron / Web Preview changes, dependencies, telemetry, analytics, cloud
upload, external frame processing, hidden network calls, new network behavior, camera access
changes, helper-owned camera capture, raw frame / pixel / tensor IPC, high-rate raw frame transport,
real parent-to-child control channel, production forced termination, restart / backoff, backend /
model / runtime selection, readiness claims, and H2 foundation implementation remain unapproved.
Gate 7 added no production runtime behavior and no readiness claim.
The earlier H2 point-in-time next-step notes have been reconciled. For historical design phase status,
use this index
and the H2 design readiness review:
[`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md).
The scoped H2 prototype
implementation-gate is now documented in
[`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md);
any future scoped prototype implementation still requires explicit project-owner approval. No
H2 implementation is approved by this index itself.

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
   — H2 design-doc phase closeout / readiness review (historical design phase status).
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
21. [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
    — closeout for the `shutdown_graceful_exit` synthetic vector; records implementation at the
    synthetic-smoke level only (a reconstructed `stopping` label from a private synthetic marker, not
    a real `stop` exchange); keeps all other shutdown vectors unapproved.
22. [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md)
    — docs-only gate selecting only `shutdown_after_helper_already_exited` as the next future
    synthetic shutdown smoke candidate; keeps timeout / forced termination and failure-after-stop
    unapproved.
23. [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
    — closeout for the `shutdown_after_helper_already_exited` synthetic vector; records
    implementation at the synthetic-smoke level only (a smoke-local idempotent after-exit stop
    observation that is a no-op over the already-terminal path; no new lifecycle state, no marker,
    no real `stop` exchange); keeps timeout / forced termination and failure-after-stop unapproved.
24. [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md)
    — docs-only gate selecting only `shutdown_after_failure_or_timeout` as the next future synthetic
    shutdown smoke candidate; keeps `shutdown_timeout_forced_exit`, forced termination, shutdown
    timeout, and restart / backoff unapproved.
25. [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md)
    — closeout for the `shutdown_after_failure_or_timeout` synthetic vector; records implementation at
    the synthetic-smoke level only, covering both the failure and timeout fallback paths (a smoke-local
    idempotent after-fallback stop observation that is a no-op over the already-terminal path; no new
    lifecycle state, no marker, no real `stop` exchange; fallback meaning preserved); keeps
    `shutdown_timeout_forced_exit`, forced termination, shutdown timeout, and restart / backoff
    unapproved.
26. [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md)
    — docs-only gate selecting only `shutdown_timeout_forced_exit` as the remaining future synthetic
    shutdown smoke candidate; keeps production forced termination, production shutdown timeout policy,
    restart / backoff, production supervisor shutdown semantics, default runtime wiring, and production
    H2 integration unapproved.
27. [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md)
    — closeout for the `shutdown_timeout_forced_exit` synthetic vector; records implementation at the
    synthetic-smoke level only (terminal `exited`, not `fallback`; `stopping` and `timed_out`
    reconstructed from private synthetic markers, `timed_out` being a synthetic shutdown-timeout
    observation rather than a real supervisor timeout; no real forced kill, no supervisor change);
    completes the synthetic shutdown smoke group and keeps production forced termination, production
    shutdown timeout policy, restart / backoff, production supervisor shutdown semantics, default
    runtime wiring, and production H2 integration unapproved.
28. [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
    — docs-only handoff recording that the H2 synthetic smoke phase is complete at the
    synthetic-smoke level after the final readiness review; defines the next scope decision boundary
    before any production H2 work.
29. [`docs/TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
    — docs-only post-synthetic next-scope gate defining decisions required before any production H2
    integration, default runtime wiring, real frame access, helper control-channel work, process
    lifecycle policy, or MotionFrame changes.
30. [`docs/TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
    — docs-only frame / data-flow decision preserving Native Core camera ownership, MotionFrame-only
    public output, and the unapproved status of helper-owned capture and raw frame transport.
31. [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md`](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md)
    — docs-only helper backend / runtime decision preserving the unapproved status of backend,
    runtime, model / task bundle, dependency, production integration, default runtime wiring, cloud
    inference, and external frame processing choices.
32. [`docs/TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
    — docs-only process lifecycle scope gate defining decisions required before production startup,
    shutdown / control, forced termination, timeout, fallback, restart / backoff, validation, or
    default runtime wiring; implements nothing.
33. [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
    — docs-only production runtime scope gate defining decisions required before production H2
    integration, default runtime wiring, feature gating, fallback behavior, validation, or
    user-facing runtime enablement; implements nothing.
34. [`docs/TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
    — docs-only validation scope gate defining CI-safe, local/manual, privacy, public stdout, helper
    privacy, and evidence-claim boundaries required before production H2 runtime work; implements
    nothing.
35. [`docs/TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md)
    — docs-only owner decision recording that H2 must not proceed directly to production runtime
    implementation yet, and that default `lvk-tracker-core` helper runtime wiring remains
    unapproved.
36. [`docs/TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md`](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
    — docs-only local runtime validation plan defining local/manual evidence requirements before any
    future H2 implementation gate; implements nothing.
37. [`docs/TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md)
    — docs-only Electron / user-facing scope gate defining decisions required before exposing H2 in
    the desktop shell, settings, calibration, status, local config, or user controls; implements
    nothing.
38. [`docs/TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md`](TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md)
    — docs-only first implementation gate draft defining the approval boundary, candidate scope,
    exclusions, validation expectations, and owner-approval requirements for a possible future first
    H2 implementation gate; implements nothing and grants no approval.
39. [`docs/TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md)
    — docs-only closeout for the H2 synthetic smoke lifecycle marker ordering hardening after PR #181
    through PR #185; records first-occurrence ordering coverage and preserves production-runtime
    non-approval boundaries.
40. [`docs/TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md)
    — docs-only next-scope gate after the ordering hardening closeout; requires read-only scope
    review and explicit owner approval before production-runtime, runtime-integration, default-runtime,
    or other H2 implementation planning.
41. [`docs/TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md`](TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md)
    — docs-only owner-decision gate after the production-runtime / runtime-integration scope review;
    records that the next decision is whether to approve drafting a future first implementation prompt
    or continue planning, while approving no implementation.
42. [`docs/TRACKING_HELPER_PROCESS_H2_LAUNCH_FAILURE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_LAUNCH_FAILURE_SMOKE_CLOSEOUT.md)
    — closeout for the `launch_failure` synthetic vector (design vector `launch_failure_fallback`,
    path `not_started -> launching -> failed -> fallback`); the first implementation slice under the
    owner-decision-gate Option B, added at the synthetic-smoke level only by exercising the
    launch-failure boundary of `runHelperProcessForSmoke`; records implementation state, not
    production integration, and changes no default `lvk-tracker-core` runtime behavior.
43. [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md)
    — closeout for the `unsafe_diagnostics_fail_closed` synthetic vector (path
    `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`); a
    helper-emitted unsafe stderr diagnostic is detected as a policy violation and reconstructs a
    fail-closed fallback at the synthetic-smoke level only (smoke-local detection, not a production
    policy engine or fallback emission); brings every standalone design vector to synthetic-smoke
    coverage; records implementation state, not production integration, and changes no default
    `lvk-tracker-core` runtime behavior.
44. [`docs/TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md)
    — docs-only closeout for the completed standalone H2 design-vector synthetic-smoke phase after
    PR #191; records ready-with-notes / no-blocking-issues coverage status, treats
    `public_stdout_motionframe_only` as a cross-cutting invariant rather than a standalone smoke case,
    and keeps production runtime integration, default runtime wiring, MotionFrame, Electron / Web
    Preview, dependency, telemetry, network, camera / frame, and local/manual readiness unapproved.
45. [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_PLANNING_GATE.md)
    — docs-only production-runtime planning gate after the standalone synthetic-smoke vector phase
    closeout; records that production-runtime planning is not automatically approved, requires an
    explicit owner decision before planning or implementation, and keeps production runtime behavior,
    default runtime wiring, MotionFrame, Electron / Web Preview, dependency, telemetry, network,
    camera / frame, and readiness claims unapproved.
46. [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OWNER_DECISION_RECORD.md)
    — docs-only owner-decision record / request after the production-runtime planning gate; records
    the pending owner decision options without selecting one, and keeps production-runtime planning,
    production implementation, default runtime wiring, runtime behavior, and readiness claims
    unapproved unless the owner explicitly chooses otherwise.
47. [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
    — docs-only owner decision selecting Option B: H2 may enter source-grounded production-runtime
    planning only; implementation, default runtime wiring, production behavior, runtime behavior
    changes, and readiness claims remain separately gated and unapproved.
48. [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
    — first Option B planning document defining the allowed production-runtime planning scope,
    explicit non-goals, deferred decisions, validation evidence requirements, and next planning-only
    candidate PRs while keeping implementation, default runtime wiring, production behavior, runtime
    behavior changes, and readiness claims unapproved.
49. [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
    — second Option B planning document proposing helper supervisor policy areas for startup,
    ready / liveness, helper output, shutdown, timeout, failure / fallback, restart / backoff
    questions, and validation evidence while keeping implementation, default runtime wiring,
    production supervisor behavior, fallback MotionFrame behavior, runtime behavior changes, and
    readiness claims unapproved.
50. [`docs/TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
    — third Option B planning document proposing fallback MotionFrame behavior planning boundaries,
    candidate fallback situations, compatibility requirements, validation evidence, and deferred
    decisions while keeping fallback MotionFrame behavior, fallback emission, implementation,
    MotionFrame schema changes, runtime behavior changes, and readiness claims unapproved.
51. [`docs/TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md`](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
    — fourth Option B planning document defining diagnostics / stdout / stderr safety planning
    boundaries, unsafe diagnostics categories, candidate size / count / rate questions, privacy
    constraints, and validation evidence while keeping production diagnostics-safety policy behavior,
    implementation, runtime behavior changes, fallback MotionFrame emission, and readiness claims
    unapproved.
52. [`docs/TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md`](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
    — fifth Option B planning document defining requirements for any future owner-approved H2
    implementation gate while keeping implementation, default runtime wiring, production supervisor
    behavior, fallback MotionFrame behavior and emission, production diagnostics-safety policy
    behavior, MotionFrame schema changes, runtime behavior changes, and readiness claims unapproved.
53. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 1: Synthetic-only helper output safety
    hardening; authorizes only a future narrow source-grounded Native Core synthetic helper
    supervision safety hardening PR while keeping production H2 integration, default runtime wiring,
    production supervisor behavior, fallback MotionFrame emission, production diagnostics-safety
    policy behavior, MotionFrame changes, Electron / Web Preview changes, dependencies, network
    behavior, and readiness claims unapproved.
54. [`docs/TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HIGH_VOLUME_CAPTURE_SMOKE_CLOSEOUT.md)
    — closeout for the first H2 Narrow Implementation Gate 1 slice: smoke-only bounded child
    stdout/stderr capture (cap + `stdoutTruncated` / `stderrTruncated` flags) with full concurrent
    pipe draining (POSIX `poll()` / Windows reader threads) plus the `high_volume` synthetic
    supervision smoke case. Records implementation state only: helper supervision behavior remains
    smoke-scoped / synthetic-scoped, active only through explicit smoke paths, and not entered by the
    default runtime when the smoke path is omitted. No production supervisor behavior,
    diagnostics-safety policy engine, fallback MotionFrame emission, MotionFrame schema change,
    default H2 runtime wiring, or readiness claim is added.
55. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_2_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 2: Explicit smoke-path isolation and
    default-runtime guard coverage; authorizes only a future narrow Native Core synthetic/smoke PR to
    strengthen or document evidence that helper supervision is entered only through explicit smoke
    paths and that default runtime behavior remains unchanged, while keeping production H2
    integration, default helper runtime wiring, production supervisor behavior, fallback MotionFrame
    emission, MotionFrame / Motion Protocol changes, Electron / Web Preview changes, dependencies,
    network behavior, camera access changes, frame / tensor IPC, and readiness claims unapproved.
56. [`docs/TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_SMOKE_PATH_ISOLATION_GUARD_CLOSEOUT.md)
    — closeout for the H2 Narrow Implementation Gate 2 slice: an evidence-only default-runtime guard
    added to `tools/check-helper-runtime-integration.mjs` proving that omitting `--helper-runtime-smoke`
    keeps default `lvk-tracker-core` stdout MotionFrame-JSON-only, does not enter helper supervision,
    and leaks no helper stdout/stderr. Records implementation state only; no Native Core runtime source
    was changed, and no default runtime wiring, production supervisor behavior, fallback MotionFrame
    emission, MotionFrame schema change, dependency, or readiness claim was added.
57. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_3_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 3: Unsafe helper diagnostics
    fail-closed smoke coverage; authorizes only a future narrow Native Core synthetic/smoke PR to
    add CI-safe evidence for unsafe helper diagnostics / unsafe helper-output fail-closed behavior,
    while keeping production H2 integration, default helper runtime wiring, production diagnostics
    policy behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol changes, Electron /
    Web Preview changes, dependencies, network behavior, camera access changes, frame / tensor IPC,
    real control-channel work, forced termination, restart / backoff, backend / model / runtime
    selection, and readiness claims unapproved.
58. [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md)
    — closeout for the H2 Narrow Implementation Gate 3 slice: a smoke-only `unsafe-diagnostic` case
    on the explicit `--helper-runtime-smoke` runtime path (`runHelperRuntimeSmoke`) that runs the
    synthetic helper with `--emit-unsafe-diagnostic`, detects the unsafe child stderr, and **fails
    closed** — empty public `lvk-tracker-core` stdout (no MotionFrame, no fallback frame), non-zero
    exit, unsafe child stderr kept private to Native Core — proven by new assertions in
    `tools/check-helper-runtime-integration.mjs`. Records implementation state only; no default
    runtime wiring, production supervisor behavior, production diagnostics-safety policy engine,
    fallback MotionFrame emission, MotionFrame / Motion Protocol change, dependency, or readiness
    claim was added.
59. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_4_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 4: Helper runtime failure-case public
    stdout guard coverage; authorizes only a future narrow Native Core synthetic/smoke PR to add
    CI-safe public stdout guard evidence for existing explicit `--helper-runtime-smoke` failure cases
    such as `launch-failure`, `nonzero-exit`, and `timeout`, while keeping production H2 integration,
    default helper runtime wiring, production supervisor behavior, production diagnostics policy
    behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol changes, Electron / Web
    Preview changes, dependencies, network behavior, camera access changes, frame / tensor IPC, real
    control-channel work, forced termination, restart / backoff, backend / model / runtime selection,
    and readiness claims unapproved.
60. [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md)
    — closeout for the H2 Narrow Implementation Gate 4 slice: checker-only public stdout guards for
    the existing explicit `--helper-runtime-smoke` failure cases (`launch-failure`, `nonzero-exit`,
    `timeout`) added to `tools/check-helper-runtime-integration.mjs`, asserting each case exits 0 with
    exactly one pre-existing fallback MotionFrame (status `lost`, valid native MotionFrame JSON) on
    public `lvk-tracker-core` stdout and forwards no helper diagnostics, lifecycle markers, raw child
    stderr, or unsafe child output to any public stream while helper stdout/stderr stay private to
    Native Core. Records implementation state only; no C++ runtime change, no new fallback MotionFrame
    emission, no default runtime wiring, production supervisor behavior, production diagnostics-safety
    policy engine, MotionFrame / Motion Protocol change, dependency, or readiness claim was added.
61. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 5: Helper runtime normal-path public
    stream guard coverage; authorizes only a future narrow Native Core synthetic/smoke PR to add
    CI-safe public stream guard evidence for the existing explicit `--helper-runtime-smoke`
    normal/success path, while keeping production H2 integration, default helper runtime wiring,
    production supervisor behavior, production diagnostics policy behavior, fallback MotionFrame
    emission, MotionFrame / Motion Protocol changes, Electron / Web Preview changes, dependencies,
    network behavior, camera access changes, frame / tensor IPC, real control-channel work, forced
    termination, restart / backoff, backend / model / runtime selection, and readiness claims
    unapproved.
62. [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md)
    — closeout for the H2 Narrow Implementation Gate 5 slice: a checker-only normal-path public stream
    guard for the existing explicit `--helper-runtime-smoke` normal/success path added to
    `tools/check-helper-runtime-integration.mjs`, asserting the run exits 0 with exactly 3 native
    MotionFrame JSON lines on public `lvk-tracker-core` stdout, public stderr (if any) only safe parent
    `[helper-runtime-smoke] ` diagnostics, and no helper lifecycle marker, helper diagnostic, raw child
    stderr, child stdout JSON, policy/error text, unsafe child output, or smoke-only marker on any
    public stream while helper stdout/stderr stay private to Native Core. Records implementation state
    only; no C++ runtime change, no new fallback MotionFrame emission, no default runtime wiring,
    production supervisor behavior, production diagnostics-safety policy engine, MotionFrame / Motion
    Protocol change, dependency, or readiness claim was added.
63. [`docs/TRACKING_HELPER_PROCESS_H2_POST_GATE_5_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_POST_GATE_5_OWNER_DECISION.md)
    — docs-only post-Gate-5 owner decision boundary; records that H2 Narrow Implementation Gate 5 is
    closed, Gates 1 through 5 remain closed and are not reopened, and the owner decision options were
    continued docs-only planning, drafting a future narrow implementation gate, or pausing H2
    implementation planning for another LVK area. The owner selected Option B for drafting a future
    narrow implementation gate. Approves no production H2 integration, default helper runtime wiring,
    production supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame
    emission, MotionFrame / Motion Protocol change, Electron / Web Preview change, dependency,
    network behavior, or readiness claim.
64. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 6: Helper runtime normal-path
    frame-count variation public stream guard coverage; authorizes only a future narrow
    synthetic/smoke-only checker implementation to extend explicit normal/success smoke public stream
    guard evidence beyond `--frames 3`, subject to source confirmation, while keeping production H2
    integration, default helper runtime wiring, production supervisor behavior, diagnostics-safety
    policy engine behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol changes,
    Electron / Web Preview changes, dependencies, network behavior, and readiness claims unapproved.
65. [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md)
    — closeout for the H2 Narrow Implementation Gate 6 slice: a synthetic/smoke-only checker update
    extending the explicit helper runtime normal/success public stream guard beyond `--frames 3` with
    source-supported `--frames 1` and `--frames 5` checks. Records implementation state only; the
    Gate 5 `--frames 3` positive control and Gate 2 / Gate 3 / Gate 4 / Gate 5 checks remain intact,
    with no C++ runtime change, production H2 integration, default runtime wiring, production
    supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission,
    MotionFrame / Motion Protocol change, Electron / Web Preview change, dependency, network
    behavior, or readiness claim added.
66. [`docs/TRACKING_HELPER_PROCESS_H2_POST_GATE_6_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_POST_GATE_6_OWNER_DECISION.md)
    — docs-only post-Gate-6 owner decision boundary; records that H2 Narrow Implementation Gate 6 is
    closed, Gates 1 through 6 remain closed and are not reopened, and the next active boundary is an
    owner decision among continued docs-only planning, drafting a future narrow implementation gate,
    or pausing H2 implementation planning for another LVK area. Approves no production H2 integration,
    default helper runtime wiring, production supervisor behavior, diagnostics-safety policy engine
    behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol change, Electron / Web
    Preview change, dependency, network behavior, or readiness claim.
67. [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_7_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_7_DECISION.md)
    — owner decision approving H2 Narrow Implementation Gate 7: Helper runtime normal-path zero-frame
    public stream guard coverage; records the post-Gate-6 Option B choice and authorizes only a
    future narrow synthetic/smoke-only checker implementation for the explicit
    `lvk-tracker-core --helper-runtime-smoke <helper> --frames 0` path, subject to source
    confirmation. Approves no production runtime behavior, production H2 integration, default helper
    runtime wiring, production supervisor behavior, diagnostics-safety policy engine behavior,
    fallback MotionFrame emission, MotionFrame / Motion Protocol change, Electron / Web Preview
    change, dependency, network behavior, readiness claim, or H2 foundation implementation planning.

68. [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md)
    — closeout for the H2 Narrow Implementation Gate 7 slice: a synthetic/smoke-only checker update
    extending the explicit helper runtime normal/success public stream guard to the zero-frame
    `lvk-tracker-core --helper-runtime-smoke <helper> --frames 0` path. Records implementation state
    only; Gates 1 through 7 are now closed at the synthetic/smoke checker level and are not
    reopened, with no C++ runtime change, production H2 integration, default runtime wiring,
    production supervisor behavior, diagnostics-safety policy
    engine behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol change, Electron /
    Web Preview change, dependency, network behavior, readiness claim, H2 foundation implementation
    planning approval, or H2 foundation implementation added.

69. [`docs/TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_PLANNING_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_PLANNING_DECISION.md)
    — docs-only owner decision boundary after Gate 7; records that H2 Narrow Implementation Gates 1
    through 7 are closed at the synthetic/smoke checker level and are not reopened, defines the next
    active boundary as H2 foundation implementation planning rather than direct implementation or
    production H2 integration, recommends drafting the first narrow foundation implementation gate,
    and keeps production H2 integration, default helper runtime wiring, production supervisor
    behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission, MotionFrame /
    Motion Protocol changes, Electron / Web Preview changes, dependencies, network behavior,
    readiness claims, and foundation implementation unapproved.
70. [`docs/TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_DECISION.md)
    — docs-only owner decision for H2 Foundation Gate 1: source-grounded foundation inventory and
    runtime boundary map. Records that Gates 1 through 7 remain closed and are not reopened, requires
    the future inventory/map to recommend the smallest possible future foundation implementation
    slice without implementing it, and keeps production H2 integration, default helper runtime wiring,
    production supervisor behavior, diagnostics-safety policy engine behavior, fallback MotionFrame
    emission, MotionFrame / Motion Protocol changes, Electron / Web Preview changes, dependencies,
    network behavior, readiness claims, and foundation implementation unapproved.

71. [`docs/TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_INVENTORY_MAP.md`](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_INVENTORY_MAP.md)
    — docs-only source-grounded H2 Foundation Gate 1 inventory and runtime boundary map. Records
    current Native Core default-runtime and explicit `--helper-runtime-smoke` boundaries, public /
    private stdout/stderr evidence, MotionFrame / Motion Protocol and Electron / Web Preview
    exclusions, and one recommended smallest future foundation implementation slice while keeping
    implementation, production H2 integration, default helper runtime wiring, production supervisor
    behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission, dependencies,
    network behavior, readiness claims, and foundation implementation unapproved.
72. [`docs/TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md)
    — docs-only owner decision selecting H2 Foundation Implementation Gate 1: explicit-smoke-only
    foundation boundary assertion. Approves only a future Native Core-only explicit-smoke-only
    implementation gate and keeps implementation unstarted until a future implementation PR is
    reviewed and merged; production H2 integration, default runtime wiring, production supervisor
    behavior, diagnostics-safety policy engine behavior, fallback MotionFrame emission, MotionFrame /
    Motion Protocol changes, Electron / Web Preview changes, dependencies, network behavior,
    readiness claims, and foundation implementation in this PR remain unapproved.

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
- `shutdown_graceful_exit` is implemented at the synthetic-smoke level only: the
  `shutdown_graceful_exit` case added to the same smoke reconstructs
  `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> exited` from a
  private, test-only synthetic `"stopping"` marker emitted before the clean `stopped` line. There is
  no parent-to-child control channel; `stopping` is a reconstructed lifecycle label, not a real `stop`
  exchange. All other shutdown vectors (`shutdown_timeout_forced_exit`,
  `shutdown_after_helper_already_exited`, `shutdown_after_failure_or_timeout`), forced termination,
  shutdown timeout, restart / backoff, and production shutdown / control semantics remain unapproved.
  See
  [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md).
- The already-exited shutdown smoke gate selects only `shutdown_after_helper_already_exited` as the
  next future candidate and keeps timeout / forced termination and failure-after-stop unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md).
- `shutdown_after_helper_already_exited` is implemented at the synthetic-smoke level only: the
  `shutdown_after_helper_already_exited` case added to the same smoke runs the helper on its normal
  clean-completion path, reconstructs
  `not_started -> launching -> waiting_for_ready -> ready -> running -> exited`, and then applies a
  smoke-local / test-only after-exit stop observation that is a pure idempotent no-op over the
  already-terminal path. There is no real parent-to-child control channel, no new lifecycle state, and
  no marker; the observation is not a real `stop` exchange. `shutdown_timeout_forced_exit`,
  `shutdown_after_failure_or_timeout`, forced termination, shutdown timeout, restart / backoff, and
  production shutdown / control semantics remain unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md).
- The failure / timeout shutdown smoke gate selects only `shutdown_after_failure_or_timeout` as the
  next future candidate and keeps `shutdown_timeout_forced_exit`, forced termination, shutdown
  timeout, and restart / backoff unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md).
- `shutdown_after_failure_or_timeout` is implemented at the synthetic-smoke level only, covering
  **both** the failure and timeout fallback paths: the `shutdown_after_failure_or_timeout` case added
  to the same smoke reconstructs
  `not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback` and
  `not_started -> launching -> waiting_for_ready -> ready -> running -> timed_out -> fallback`, and
  then applies a smoke-local / test-only after-fallback stop observation that is a pure idempotent
  no-op over the already-terminal path. There is no real parent-to-child control channel, no new
  lifecycle state, and no marker; the observation is not a real `stop` exchange and the failure /
  timeout / fallback meaning is preserved. `shutdown_timeout_forced_exit`, forced termination, shutdown
  timeout behavior, restart / backoff, and production shutdown / control semantics remain unapproved.
  See
  [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md).
- The forced-exit shutdown smoke gate selects only `shutdown_timeout_forced_exit` as the remaining
  future candidate, keeps the candidate terminal as `exited` rather than `fallback`, and keeps
  production forced termination, production shutdown timeout policy, restart / backoff, production
  supervisor shutdown semantics, default runtime wiring, and production H2 integration unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md).
- `shutdown_timeout_forced_exit` is implemented at the synthetic-smoke level only, **completing the
  synthetic shutdown smoke group**: the `shutdown_timeout_forced_exit` case added to the same smoke
  reconstructs
  `not_started -> launching -> waiting_for_ready -> ready -> running -> stopping -> timed_out -> exited`
  from private synthetic `"stopping"` and `"shutdown-timeout"` markers plus the helper's own clean
  exit. The terminal state is `exited`, not `fallback`; `timed_out` is a reconstructed synthetic
  shutdown-timeout observation, not a real supervisor timeout, and there is no real forced kill, no new
  lifecycle state, no real `stop` exchange, and no `helper_process_supervisor` change. Production
  forced termination, production shutdown timeout policy, restart / backoff, production supervisor
  shutdown semantics, default runtime wiring, and production H2 integration remain unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md).
- The H2 synthetic smoke phase is complete at the synthetic-smoke level and recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md);
  this does not claim production readiness.
- The post-synthetic next-scope gate has been added and still approves no production H2 work. See
  [`docs/TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md).
- The frame / data-flow decision has been added and still approves no helper-owned camera capture,
  raw frame IPC, tensor IPC, high-rate frame transport, MotionFrame changes, production H2
  integration, or default runtime wiring. See
  [`docs/TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md).
- The helper backend / runtime decision has been added and still approves no backend / runtime /
  model / dependency selection, production H2 integration, default runtime wiring, cloud inference,
  or external frame processing. See
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md`](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md).
- The process lifecycle scope gate has been added and still approves no production lifecycle
  behavior, real stop / control channel, production forced termination, shutdown timeout policy,
  restart / backoff, production H2 integration, or default runtime wiring. See
  [`docs/TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md).
- The production runtime scope gate has been added and still approves no production H2 integration,
  default runtime wiring, backend / model / runtime selection, feature flag implementation, Electron
  UI, MotionFrame changes, real frame access, telemetry / network behavior, or cloud / external
  processing. See
  [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md).
- The validation scope gate has been added and still approves no production H2 integration, default
  runtime wiring, CI job changes, validation script implementation, local/manual validation claim,
  production readiness claim, real frame access, telemetry / network behavior, or cloud / external
  processing. See
  [`docs/TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md).
- The runtime integration owner decision records that production H2 implementation and default
  `lvk-tracker-core` helper runtime wiring are not approved yet. See
  [`docs/TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md).
- The local runtime validation plan has been added and still approves no production H2 integration,
  default runtime wiring, validation script implementation, CI job changes, real frame access, local
  runtime pass claim, or production readiness claim. See
  [`docs/TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md`](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md).
- The Electron / user-facing scope gate has been added and still approves no Electron UI,
  settings, calibration, status controls, feature flag implementation, production H2 integration,
  default runtime wiring, real frame access, MotionFrame changes, or telemetry / network behavior. See
  [`docs/TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md).
- The first implementation gate draft has been added and still approves no implementation, production
  H2 integration, default runtime wiring, backend / model / runtime selection, real frame access,
  Electron UI, MotionFrame changes, or telemetry / network behavior. See
  [`docs/TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md`](TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md).
- The H2 synthetic smoke lifecycle marker ordering hardening after PR #181 through PR #185 is
  documented as complete for the covered synthetic-only cases. The closeout records the
  first-occurrence ordering rule, keeps `unknown_message_type` and `malformed_line` injected markers
  out of lifecycle ordering, leaves `oversized_line_rejected` on its bounded-line scan path, and
  approves no production runtime work. See
  [`docs/TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md).
- The read-only production-runtime / runtime-integration scope review required by the post-ordering
  next-scope gate has completed and returned ready for owner decision, not implementation-ready. See
  [`docs/TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md).
- The Option B decision is now the current active H2 production-runtime planning boundary. The owner
  has selected docs-only production-runtime planning, limited to source-grounded planning documents;
  implementation, default runtime wiring, production supervisor behavior, fallback MotionFrame
  behavior, runtime behavior changes, MotionFrame changes, Electron / Web Preview / Motion Protocol
  changes, dependencies, telemetry, analytics, cloud upload, external frame processing, hidden network
  calls, new network behavior, and readiness claims remain unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md).
- The first Option B planning document now defines the H2 production-runtime scope and non-goals
  planning boundary, including allowed planning topics, forbidden implementation implications,
  deferred decisions, validation evidence requirements, and planning-only next candidates. See
  [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md).
- The H2 helper supervisor policy proposal has been added as an Option B planning document,
  defining planning-only supervisor policy areas for startup, ready / liveness, helper output,
  shutdown, timeout, failure / fallback, restart / backoff questions, and validation evidence while
  preserving that production supervisor behavior remains unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md).
- The H2 fallback MotionFrame behavior proposal has been added as the next Option B planning document,
  defining planning-only fallback situations, MotionFrame compatibility requirements, validation
  evidence, and deferred decisions while preserving that fallback MotionFrame behavior, fallback
  emission, MotionFrame schema changes, and runtime behavior changes remain unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md).
- The H2 diagnostics / stdout / stderr safety planning document has been added as the next Option B
  planning document, defining planning-only public stdout, helper stdout, helper stderr, unsafe
  diagnostics, bounded capture, local-only handling, privacy-safe summary, and validation evidence
  boundaries while preserving that production diagnostics-safety policy behavior, implementation,
  runtime behavior changes, fallback MotionFrame emission, and readiness claims remain unapproved.
  See
  [`docs/TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md`](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md).
- The H2 implementation gate requirements document has been added as the next Option B planning
  document, defining what must be true before any future owner-approved H2 implementation gate can be
  considered while preserving that implementation, default runtime wiring, production supervisor
  behavior, fallback MotionFrame behavior and emission, production diagnostics-safety policy behavior,
  MotionFrame schema changes, runtime behavior changes, and readiness claims remain unapproved. See
  [`docs/TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md`](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md).
- The standalone H2 design-vector synthetic-smoke phase is complete after PR #191, with the
  read-only closeout review returning ready with notes and no blocking issues. See
  [`docs/TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md).
- The H2 Narrow Implementation Gate 3 slice is implemented at the synthetic/smoke level: a smoke-only
  `unsafe-diagnostic` case on the explicit `--helper-runtime-smoke` runtime path runs the synthetic
  helper with `--emit-unsafe-diagnostic`, detects the unsafe child stderr, and fails closed with
  empty public `lvk-tracker-core` stdout (no MotionFrame, no fallback frame) and a non-zero exit
  while keeping the unsafe child stderr private to Native Core; proven by new
  `tools/check-helper-runtime-integration.mjs` assertions. No production diagnostics-safety policy
  engine, supervisor behavior, fallback MotionFrame emission, default runtime wiring, or readiness
  claim is added. See
  [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_PUBLIC_STDOUT_SMOKE_CLOSEOUT.md).
- The H2 Narrow Implementation Gate 6 slice is implemented at the synthetic/smoke checker level:
  `tools/check-helper-runtime-integration.mjs` extends the explicit helper runtime normal/success
  public stream guard beyond `--frames 3` with source-supported `--frames 1` and `--frames 5` checks,
  asserting exact frame counts, native MotionFrame JSON-only public stdout, safe parent-prefixed
  public stderr if present, and no helper lifecycle markers, helper diagnostics, unsafe child output,
  raw child stderr, child stdout JSON forms, policy/error text, or smoke-only markers on public
  streams. Gates 1 through 5 remain closed and intact. No C++ runtime change, production H2
  integration, default runtime wiring, production supervisor behavior, diagnostics-safety policy
  engine behavior, fallback MotionFrame emission, MotionFrame / Motion Protocol change, Electron /
  Web Preview change, dependency, network behavior, or readiness claim is added. See
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_FRAME_COUNT_GUARD_CLOSEOUT.md).
- The H2 Narrow Implementation Gate 5 slice is implemented at the synthetic/smoke (checker-only)
  level: `tools/check-helper-runtime-integration.mjs` now guards the existing explicit
  `--helper-runtime-smoke` normal/success path, asserting the run exits 0 with exactly 3 native
  MotionFrame JSON lines on public `lvk-tracker-core` stdout, public stderr (if any) only safe parent
  `[helper-runtime-smoke] ` diagnostics, and no helper lifecycle marker, helper diagnostic, raw child
  stderr, child stdout JSON, policy/error text, unsafe child output, or smoke-only marker on any public
  stream while helper stdout/stderr stay private to Native Core. No C++ runtime change, new fallback
  MotionFrame emission, default runtime wiring, production supervisor behavior, production
  diagnostics-safety policy engine, or readiness claim is added. The owner decision is
  [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md);
  the implementation closeout is
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_NORMAL_STREAM_GUARD_CLOSEOUT.md).
- The H2 Narrow Implementation Gate 4 slice is implemented at the synthetic/smoke (checker-only)
  level: `tools/check-helper-runtime-integration.mjs` now guards the existing explicit
  `--helper-runtime-smoke` failure cases (`launch-failure`, `nonzero-exit`, `timeout`), asserting each
  exits 0 with exactly one pre-existing fallback MotionFrame (status `lost`, valid native MotionFrame
  JSON) on public `lvk-tracker-core` stdout and forwards no helper diagnostics, lifecycle markers, raw
  child stderr, or unsafe child output to any public stream while helper stdout/stderr stay private to
  Native Core. No C++ runtime change, new fallback MotionFrame emission, default runtime wiring,
  production supervisor behavior, production diagnostics-safety policy engine, or readiness claim is
  added. See
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_FAILURE_STDOUT_GUARD_CLOSEOUT.md).
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
- Production H2 integration.
- Production-runtime / runtime-integration implementation beyond source-grounded docs-only planning.
- Default `lvk-tracker-core` runtime wiring.
- IPC implementation.
- Test implementation.
- Helper process supervisor production policy.
- Real control channel.
- Real forced termination.
- Restart / backoff implementation.
- Real camera access.
- Raw frame / pixel / tensor IPC.
- High-rate raw frame transport.
- Helper-owned camera capture.
- Production helper backend.
- Backend / model / runtime selection.
- Dependency additions.
- MediaPipe / Python runtime / ONNX Runtime production approval.
- Model / task bundling.
- MotionFrame schema change.
- Electron / Web Preview / Motion Protocol changes.
- Telemetry, analytics, cloud upload, external frame processing, hidden network calls, or new network
  behavior.

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
- **Graceful shutdown smoke implemented:** `shutdown_graceful_exit` is recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  at the synthetic-smoke level only.
- **Already-exited shutdown smoke implemented:** `shutdown_after_helper_already_exited` is recorded
  in
  [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
  at the synthetic-smoke level only.
- **Failure / timeout shutdown smoke implemented:** `shutdown_after_failure_or_timeout` is recorded
  in
  [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  at the synthetic-smoke level only, covering both the failure and timeout fallback paths.
- **Forced-exit shutdown smoke implemented:** `shutdown_timeout_forced_exit` is recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  at the synthetic-smoke level only (terminal `exited`, not `fallback`; `timed_out` reconstructed from
  a private synthetic shutdown-timeout marker; no real forced kill or supervisor change). This
  **completes the synthetic shutdown smoke group** (`shutdown_graceful_exit`,
  `shutdown_after_helper_already_exited`, `shutdown_after_failure_or_timeout`,
  `shutdown_timeout_forced_exit`).
- **Ordering hardening closeout added:** the H2 synthetic smoke lifecycle marker ordering hardening
  after PR #181 through PR #185 is recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md).
  It closes the synthetic-only ordering hardening group for the covered cases while keeping
  `oversized_line_rejected` on its bounded-line scan path and approving no production runtime work.
- **Post-ordering next-scope gate added:** the next decision boundary after ordering hardening is
  recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md).
- **Standalone smoke vector phase closeout added:** the completed standalone H2 design-vector
  synthetic-smoke phase is recorded in
  [`docs/TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md).
  There is no remaining standalone synthetic-smoke vector to add; this still does not imply production
  readiness.
- **Option B decision recorded:** the owner has selected Option B, making
  [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
  the current active H2 production-runtime planning boundary. The first Option B planning step, the
  H2 production-runtime scope and non-goals plan, has been added:
  [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md).
  The next Option B planning step, the H2 helper supervisor policy proposal, has also been added:
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md).
  The H2 fallback MotionFrame behavior proposal has now been added:
  [`docs/TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md).
  The H2 diagnostics / stdout / stderr safety planning document has now been added:
  [`docs/TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md`](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md).
  The H2 implementation gate requirements document has now been added:
  [`docs/TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md`](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md).
  H2 Narrow Implementation Gates 1 through 7 are closed at the synthetic/smoke checker level
  and are not reopened. The Gate 7 closeout is:
  [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_HELPER_RUNTIME_ZERO_FRAME_GUARD_CLOSEOUT.md).
  The current active boundary is the first H2 foundation implementation gate decision:
  [`docs/TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FIRST_FOUNDATION_IMPLEMENTATION_GATE_DECISION.md).
  H2 Foundation Gate 1 inventory/map is complete. The selected future implementation slice is
  Native Core-only and explicit-smoke-only, limited to a foundation boundary assertion through an
  explicit `--helper-runtime-smoke` foundation boundary mode. Implementation remains unstarted and
  unapproved until a future implementation PR is reviewed and merged. Do not proceed to production H2
  integration, default helper runtime wiring, default `lvk-tracker-core` H2 runtime wiring,
  production supervisor behavior, production diagnostics-safety policy engine behavior, fallback
  MotionFrame behavior, fallback MotionFrame emission, MotionFrame schema changes, Motion Protocol
  changes, Electron / Web Preview changes, dependencies, telemetry, analytics, cloud upload, external
  frame processing, hidden network calls, new network behavior, camera access changes, helper-owned
  camera capture, raw frame / pixel / tensor IPC, high-rate raw frame transport, real
  parent-to-child control channel, production forced termination, restart / backoff, backend / model /
  runtime selection, local/manual validation claims, webcam / Electron / OBS readiness claims,
  production readiness claims, or foundation implementation beyond the future owner-approved
  implementation PR.
- No production H2 integration, no default `lvk-tracker-core` runtime wiring, no foundation
  implementation beyond the future owner-approved implementation PR, and no real frame access until
  separately scoped and approved. All safety boundaries remain preserved.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_OPTION_B_DECISION.md)
  — current active H2 production-runtime planning boundary; records owner selection of Option B for
  source-grounded docs-only planning while keeping implementation, default runtime wiring, production
  behavior, runtime behavior changes, and readiness claims unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_AND_NONGOALS_PLAN.md)
  — first Option B planning document defining the production-runtime planning scope, non-goals,
  deferred decisions, validation evidence requirements, and next planning-only PR candidates.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_HELPER_SUPERVISOR_POLICY_PROPOSAL.md)
  — second Option B planning document proposing helper supervisor policy areas while keeping
  production supervisor behavior and implementation unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md`](TRACKING_HELPER_PROCESS_H2_FALLBACK_MOTIONFRAME_BEHAVIOR_PROPOSAL.md)
  — third Option B planning document proposing fallback MotionFrame behavior boundaries while keeping
  fallback behavior, fallback emission, MotionFrame schema changes, runtime behavior changes, and
  readiness claims unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md`](TRACKING_HELPER_PROCESS_H2_DIAGNOSTICS_STDOUT_STDERR_SAFETY_PLANNING.md)
  — fourth Option B planning document defining diagnostics / stdout / stderr safety boundaries while
  keeping production diagnostics-safety policy behavior, implementation, runtime behavior changes,
  fallback MotionFrame emission, and readiness claims unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md`](TRACKING_HELPER_PROCESS_H2_IMPLEMENTATION_GATE_REQUIREMENTS.md)
  — fifth Option B planning document defining requirements for any future implementation gate while
  keeping implementation and production runtime behavior unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_GATE_6_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_POST_GATE_6_OWNER_DECISION.md)
  — current active H2 boundary after the Gate 6 closeout; records that Gate 6 is closed, Gates 1
  through 6 remain closed and are not reopened, and the next step is owner decision, not direct
  implementation.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_6_DECISION.md)
  — owner decision that approved only the now-closed narrow synthetic/smoke-only checker
  implementation, not production runtime behavior.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_GATE_5_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_POST_GATE_5_OWNER_DECISION.md)
  — post-Gate-5 owner decision boundary; records owner decision options and is resolved by the
  owner's Option B choice to draft a future narrow implementation gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_5_DECISION.md)
  — owner decision approving only H2 Narrow Implementation Gate 5: Helper runtime normal-path public
  stream guard coverage for a future narrow implementation PR; Gate 5 is now closed.
- [`docs/TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md`](TRACKING_HELPER_PROCESS_H2_NARROW_IMPLEMENTATION_GATE_1_DECISION.md)
  — owner decision approving only H2 Narrow Implementation Gate 1: Synthetic-only helper output
  safety hardening for a future narrow implementation PR.
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md`](TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md)
  — historical owner-decision gate and option set superseded by the recorded Option B decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md`](TRACKING_HELPER_PROCESS_H2_DESIGN_READINESS_REVIEW.md)
  — historical H2 design-doc phase status.
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
- [`docs/TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_GRACEFUL_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_graceful_exit` synthetic vector (synthetic-smoke level only).
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate selecting only `shutdown_after_helper_already_exited` as the next future shutdown
  smoke candidate.
- [`docs/TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ALREADY_EXITED_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_after_helper_already_exited` synthetic vector (synthetic-smoke level
  only).
- [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate selecting only `shutdown_after_failure_or_timeout` as the next future shutdown
  smoke candidate.
- [`docs/TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FAILURE_TIMEOUT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_after_failure_or_timeout` synthetic vector (synthetic-smoke level only;
  both failure and timeout paths).
- [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_GATE.md)
  — docs-only gate selecting only `shutdown_timeout_forced_exit` as the remaining future shutdown
  smoke candidate.
- [`docs/TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_FORCED_EXIT_SHUTDOWN_SMOKE_CLOSEOUT.md)
  — closeout for the `shutdown_timeout_forced_exit` synthetic vector (synthetic-smoke level only;
  terminal `exited`); completes the synthetic shutdown smoke group.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
  — docs-only handoff for the completed H2 synthetic smoke phase and next scope decision boundary.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
  — docs-only post-synthetic next-scope gate; approves no production H2 work.
- [`docs/TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md`](TRACKING_HELPER_PROCESS_H2_FRAME_DATA_FLOW_DECISION.md)
  — docs-only frame / data-flow decision; preserves Native Core camera ownership and rejects default
  frame transport.
- [`docs/TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md`](TRACKING_HELPER_PROCESS_H2_HELPER_BACKEND_RUNTIME_DECISION.md)
  — docs-only helper backend / runtime decision; keeps backend, runtime, model, dependency,
  production integration, default runtime wiring, cloud inference, and external frame processing
  unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROCESS_LIFECYCLE_SCOPE_GATE.md)
  — docs-only process lifecycle scope gate; keeps production lifecycle behavior, real stop / control,
  forced termination, shutdown timeout policy, restart / backoff, production integration, and default
  runtime wiring unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_PRODUCTION_RUNTIME_SCOPE_GATE.md)
  — docs-only production runtime scope gate; keeps production integration, default runtime wiring,
  feature gating, fallback behavior, validation, and user-facing runtime enablement behind future
  approval.
- [`docs/TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_VALIDATION_SCOPE_GATE.md)
  — docs-only validation scope gate; keeps CI-safe checks, local/manual evidence, public stdout
  safety, helper privacy, local-first privacy, and evidence claims bounded before future production
  runtime implementation.
- [`docs/TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md`](TRACKING_HELPER_PROCESS_H2_RUNTIME_INTEGRATION_OWNER_DECISION.md)
  — docs-only owner decision; keeps production H2 implementation and default runtime wiring
  unapproved while requiring explicit owner approval before any implementation gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md`](TRACKING_HELPER_PROCESS_H2_LOCAL_RUNTIME_VALIDATION_PLAN.md)
  — docs-only local runtime validation plan; defines local/manual validation categories, evidence
  requirements, privacy checks, public stdout checks, and claim rules before any future H2
  implementation gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_ELECTRON_USER_FACING_SCOPE_GATE.md)
  — docs-only Electron / user-facing scope gate; defines decisions and acceptance criteria required
  before exposing H2 in desktop shell, settings, calibration, status, local config, or user controls.
- [`docs/TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md`](TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md)
  — docs-only first implementation gate draft; defines the approval boundary, candidate scope,
  exclusions, validation expectations, and owner-approval requirements for a possible future first H2
  implementation gate while approving nothing.
- [`docs/TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_ORDERING_HARDENING_CLOSEOUT.md)
  — docs-only ordering hardening closeout; records first-occurrence lifecycle marker ordering coverage
  after PR #181 through PR #185 and keeps production runtime work unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_ORDERING_NEXT_SCOPE_GATE.md)
  — docs-only post-ordering next-scope gate whose required read-only scope review has completed.
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md`](TRACKING_HELPER_PROCESS_H2_OWNER_DECISION_GATE.md)
  — docs-only owner-decision gate; its option-selection step is superseded by the Option B decision,
  with implementation still unapproved.
- [`docs/TRACKING_HELPER_PROCESS_H2_LAUNCH_FAILURE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_LAUNCH_FAILURE_SMOKE_CLOSEOUT.md)
  — closeout for the `launch_failure_fallback` synthetic vector (synthetic-smoke level only).
- [`docs/TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_UNSAFE_DIAGNOSTICS_SMOKE_CLOSEOUT.md)
  — closeout for the `unsafe_diagnostics_fail_closed` synthetic vector (synthetic-smoke level only).
- [`docs/TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STANDALONE_SMOKE_VECTOR_PHASE_CLOSEOUT.md)
  — docs-only closeout for completed standalone H2 design-vector synthetic-smoke coverage after PR
  #191.
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation
  claim rules and reporting template.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback
  behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
