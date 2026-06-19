# Tracking Helper Process H2 Frame Data-Flow Decision

## Status

Status: H2 docs-only frame / data-flow decision.
Scope: documentation-only decision boundary after the H2 post-synthetic next-scope gate.

This document implements nothing. It follows the post-synthetic next-scope gate and preserves the
frame ownership and data-flow boundary that must remain intact before any production H2 runtime,
backend, helper integration, or process lifecycle work begins.

This document does **not** approve production H2 integration, default `lvk-tracker-core` runtime
wiring, helper-owned camera capture, raw frame IPC, pixel IPC, tensor IPC, MotionFrame changes,
Electron / Web Preview changes, dependencies, telemetry, analytics, cloud upload, external frame
processing, hidden network calls, or new network behavior.

## Decision Summary

Current decision:

- Native Core remains the only approved camera owner.
- Camera frames must stay local in v0.1.
- Helper-owned camera capture remains unapproved.
- Raw frame / pixel / tensor IPC remains unapproved.
- High-rate frame transport remains unapproved.
- Temporary-file frame transport remains rejected.
- Loopback / socket transport remains non-default and unapproved for frame transport.
- Public `lvk-tracker-core` stdout remains MotionFrame JSON only.
- Helper stdout / stderr remain private to Native Core.
- MotionFrame remains the only public renderer-facing contract.

## Why This Decision Exists

H2 synthetic smoke is complete at the synthetic-smoke level, but production H2 would introduce real
data-movement questions that the synthetic smoke phase intentionally did not answer. Moving from
private synthetic helper output to any production helper boundary would require an explicit decision
about what data crosses that boundary and why.

Frame data is privacy-sensitive. Accidental raw frame, pixel-buffer, tensor, image-file, or high-rate
frame transport would violate the local-first v0.1 boundary and could expose camera-derived data
outside the intended Native Core-owned tracking path.

For that reason, frame ownership and data flow must be decided before backend / runtime selection or
production process lifecycle implementation. Backend and lifecycle choices must not implicitly create
frame transport, helper-owned capture, public stdout changes, or renderer-facing protocol changes.

## Approved Current Data Flow

Only the following data flow is currently approved:

- Native Core may emit public MotionFrame JSON on `lvk-tracker-core` stdout.
- Web Preview consumes MotionFrame only.
- Helper stdout / stderr are private to Native Core when used by smoke / helper supervision.
- Synthetic helper output remains test-only and private.
- No production helper frame input exists.

## Explicitly Unapproved Data Flows

The following data flows remain unapproved:

- helper-owned camera capture
- camera access from Electron
- camera access from Web Preview
- raw frame IPC
- pixel buffer IPC
- tensor IPC
- image file / temporary-file frame transport
- high-rate frame transport
- default loopback / socket frame transport
- cloud frame upload
- external frame processing
- telemetry / analytics involving frame data
- MotionFrame schema changes for raw tracking payloads

## Future Candidate Data-Flow Questions

A future gate must answer these questions before any frame / data-flow implementation. This document
does not answer them:

- If a production helper is ever used, what is the minimal input it needs?
- Can Native Core perform all camera capture and preprocessing locally before any helper boundary?
- Is a lower-rate semantic signal enough instead of raw frames?
- Can MotionFrame remain unchanged?
- What validation proves that public stdout remains MotionFrame JSON only?
- What local / manual checks are needed to verify no cloud / network / frame leakage?
- What fallback behavior applies if a helper cannot run?

## Acceptance Criteria Before Any Frame / Data-Flow Implementation

A future implementation gate may start only after:

- the product owner explicitly approves the data-flow scope;
- camera ownership remains documented;
- helper input / output boundaries are documented;
- raw frame / pixel / tensor transport is either explicitly rejected or separately approved with
  rationale;
- MotionFrame impact is documented;
- privacy and local-first validation is documented;
- public stdout safety validation is documented;
- no telemetry / cloud / network behavior is introduced.

## Relationship To Other H2 Decisions

- This document does not choose backend / model / runtime.
- This document does not approve production process lifecycle.
- This document does not approve real helper stop / control-channel semantics.
- This document does not approve Electron UI.
- Backend / runtime and process lifecycle decisions must remain separate future gates.

## Recommended Next Step

First, perform a read-only review of this decision.

Then choose one narrow next planning direction before any implementation:

- `helper-backend-runtime-decision`
- `production-runtime-scope-gate`
- `process-lifecycle-scope-gate`

Do not create those additional documents in this PR. Do not proceed directly to implementation.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_POST_SYNTHETIC_NEXT_SCOPE_GATE.md)
  — post-synthetic next-scope gate.
- [`docs/TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md`](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
  — handoff for the completed H2 synthetic smoke phase.
- [`docs/TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md`](TRACKING_HELPER_PROCESS_H2_OWNERSHIP_DECISION.md)
  — frame ownership decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md`](TRACKING_HELPER_PROCESS_H2_IPC_DECISION.md)
  — first IPC direction decision.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — design-only pipe framing contract.
- [`docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md`](TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md)
  — Native helper prototype implementation gate.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — LVK component and process boundaries.
- [`docs/LOCAL_RUNTIME_CHECKLIST.md`](LOCAL_RUNTIME_CHECKLIST.md) — local/manual validation claim
  rules.
