# Tracking Helper Process H2 Next Synthetic Vector Gate

## Status

Status: H2 next-synthetic-vector gate / decision.
Scope: documentation-only gate for the next synthetic-only H2 implementation slice.

- Docs-only gate / decision.
- No implementation.
- No runtime behavior change.
- No production integration.
- No real frame access.
- No MotionFrame schema change.

This document records a decision about **what the next safe synthetic-only slice should be** and
the gates a future implementation PR must satisfy. It implements nothing, approves no production
integration, grants no real frame access, adds no dependency, and changes no MotionFrame schema.

## Current Implemented H2 Synthetic Smoke Coverage

The implemented H2 work is the standalone, synthetic-only `lvk-helper-h2-state-machine-smoke`
executable. It launches the existing `lvk-synthetic-helper` through the existing bounded
`runHelperProcessForSmoke(...)` supervisor and reconstructs the designed H2 lifecycle state path
from the supervised run result, using lightweight bounded string checks against the helper's known
stdout markers (no JSON library, no general JSON parser).

- **PR #147** — first synthetic-only H2 state-machine smoke:
  - normal lifecycle
    (`not_started -> launching -> waiting_for_ready -> ready -> running -> exited`)
  - helper non-zero exit fallback
    (`not_started -> launching -> waiting_for_ready -> ready -> running -> failed -> fallback`)
  - liveness / silence timeout after `ready` / `running`
    (`not_started -> launching -> waiting_for_ready -> ready -> running -> timed_out -> fallback`)
- **PR #149** — startup-timeout fallback vector:
  - `not_started -> launching -> waiting_for_ready -> timed_out -> fallback`
    (pure startup timeout: `ready` is not emitted before the bounded startup timeout)

No production H2 integration exists. The default `lvk-tracker-core` runtime remains unchanged (the
helper is not wired into it).

## Decision

- The next implementation candidate should be a **small synthetic-only helper-output error vector
  slice**.
- Prefer **parser / diagnostic-safe helper-output error vectors** before shutdown /
  control-channel vectors.
- Shutdown / control-channel vectors require a **separate scope decision** before implementation,
  because they introduce parent-to-child `stop` / control semantics that the current smoke and
  supervisor do not establish (the current smoke exercises a one-way captured-output flow only).

## Future Approved-for-Planning Candidate

A future PR may **plan** a synthetic-only helper-output error vector implementation. Candidate
vectors (named per
[`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
and the framing contract's error handling in
[`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)):

- **malformed helper output line** — a malformed line is safely dropped and counted as a safe
  diagnostic; the smoke does not crash (`malformed_json_line_safe_drop`).
- **unknown helper message type** — an unknown `type` is ignored with a safe diagnostic; no state
  corruption (`unknown_message_type_safe_ignore`).
- **oversized helper output line** — a line exceeding the bounded size is rejected with a safe
  diagnostic (`oversized_message_reject`).

Notes for the future planning slice:

- The future implementation should choose the **smallest useful subset**, not necessarily all
  three.
- If implementing all three would make the PR too large, **prefer one or two vectors first**.
- The current smoke uses bounded string checks, not a JSON library; the future slice should keep
  that style and remain source-grounded (it will likely need a small, bounded synthetic-only helper
  mode to emit the error lines, mirroring the existing `--fail-after` / `--delay-ready-ms`
  bounded-option pattern). Designing that mode is **out of scope for this gate**.

## Required Future Implementation Gates

A future helper-output error vector implementation PR must satisfy all of the following:

- Exact implementation scope documented.
- Exact changed files listed.
- Current source inspected before editing.
- No camera access.
- No real frames / pixels / tensors.
- No helper-owned camera capture.
- No raw frame / pixel / tensor IPC.
- No high-rate raw frame transport.
- No MotionFrame schema change.
- No dependencies unless separately approved.
- No production H2 integration.
- No default `lvk-tracker-core` runtime wiring.
- Helper stdout / stderr remain private to Native Core (never forwarded to public stdout).
- `lvk-tracker-core` public stdout remains MotionFrame JSON only.
- No telemetry / analytics / cloud upload / new network behavior.
- Diagnostics remain safe and must not include raw data, paths, secrets, model contents, images,
  pixels, tensors, or private payloads.
- Fallback behavior must use only current MotionFrame fields (`tracking.status`,
  `tracking.confidence`); no stale fields (`face.detected`, `head.*`, `eyes.blink`).
- Checks must be planned before implementation.

## What Remains Unapproved

- Production H2 integration.
- Default runtime wiring.
- Real frame access.
- Helper-owned camera capture.
- Raw frame / pixel / tensor IPC.
- High-rate raw frame transport.
- Shutdown / control-channel implementation.
- Restart / backoff.
- MotionFrame schema changes.
- Electron / Web Preview / Motion Protocol changes.
- New dependencies.
- Backend / model / runtime selection.

## Recommended Next Step

- After this docs gate is merged, create a **small implementation plan** for the first
  helper-output error vector slice (smallest useful subset of malformed / unknown / oversized).
- Do **not** implement shutdown / control semantics until separately gated.
- Do **not** proceed to production integration.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STARTUP_TIMEOUT_SMOKE_CLOSEOUT.md)
  — closeout for the startup-timeout synthetic vector (PR #149).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_SMOKE_CLOSEOUT.md)
  — closeout for the first implemented synthetic-only H2 slice (PR #147).
- [`docs/TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md`](TRACKING_HELPER_PROCESS_H2_STATE_MACHINE_TEST_VECTORS.md)
  — automated-check goals and the error / timeout test vectors named above.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — framing rules and bounded error / timeout handling the candidate vectors exercise.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — handshake and helper state machine the smoke exercises.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
