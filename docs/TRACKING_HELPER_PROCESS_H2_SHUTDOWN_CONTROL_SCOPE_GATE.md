# Tracking Helper Process H2 Shutdown / Control-Channel Scope Gate

## Status

Status: H2 shutdown / control-channel scope / gate for a future helper stop / lifecycle-control slice.
Scope: documentation-only scope/gate.

- Docs-only scope/gate for future H2 helper shutdown / stop / control-channel work.
- Does not implement anything.
- Does not authorize production integration.
- Does not authorize default `lvk-tracker-core` runtime wiring.
- Grants no real frame access.
- Adds no dependency.
- Changes no MotionFrame schema.
- Does **not** define restart / backoff, supervisor policy, or general stdout/stderr streaming semantics.
- Does **not** imply that helper stop / control-channel behavior is implemented. It is **designed on
  paper only** (see Source-Grounded Observations); no code path establishes a parent → child control
  channel today.

This document decides **what must be settled before** any H2 helper shutdown, stop, control-channel,
or lifecycle-control implementation begins. It implements nothing.

## Why This Gate Exists

The H2 helper-process synthetic-only smoke group is complete and was reviewed as `ready with notes`
on `origin/main` at PR #158. The covered synthetic smoke vectors are:

- normal lifecycle path
- failure / fallback path
- ready / running silence timeout
- startup timeout before ready
- unknown helper-output message
- malformed helper-output line
- oversized helper-output line

That coverage is enough to **close the synthetic-smoke group** for the one-way captured-output flow.
It does **not** establish helper shutdown / control-channel behavior. The implemented smoke launches
`lvk-synthetic-helper` through the existing bounded `runHelperProcessForSmoke(...)` supervisor,
captures the child's **private** stdout/stderr, and reconstructs the lifecycle path from captured
output and a bounded run timeout. There is **no** parent → child control channel, **no** `stop`
message, and **no** `stopping` state in code.

Shutdown / control semantics need a **separate** gate because they easily mix with concerns the
synthetic smoke group deliberately kept out:

- default `lvk-tracker-core` runtime wiring,
- restart / backoff policy,
- production supervisor policy,
- parent → child `stdin` control framing,
- stdout / stderr handling and diagnostic privacy.

The existing H2 design documents already **propose** a bounded `stop` handshake (a `stop` control
message, a `stopping` state, a bounded shutdown timeout, and terminate-on-timeout). Those remain
**design only**. This gate exists so that, before that design is implemented, the open decisions
below are made explicitly rather than drifting in during a wiring PR.

## Source-Grounded Observations

Inspected: `native/tracker-core/src/helper_h2_state_machine_smoke.cpp`,
`native/tracker-core/src/synthetic_helper_main.cpp`,
`native/tracker-core/src/main.cpp`,
`native/tracker-core/CMakeLists.txt`,
`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`,
`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`.

- **No control channel exists in code.** The synthetic helper reads command-line options only; it has
  no `stdin` command loop. `runHelperProcessForSmoke(...)` captures child stdout/stderr and enforces a
  bounded run timeout, terminating the child when the timeout elapses — it never sends a `stop` or any
  control message. The H2 smoke models `stopping` / `timed_out` / `fallback` purely as **reconstructed
  state-path labels**, not as a real parent → child stop exchange.
- **The synthetic helper's `stopped` line is helper-driven, not stop-driven.** The helper emits a
  `{"type":"stopped",...}` line when it completes its own frame loop (`writeStoppedLine(...)`). It is a
  helper-output lifecycle marker on the helper's **private** stdout; it is **not** a response to a
  Native Core `stop` request and is **not** a public MotionFrame.
- **The shutdown handshake is designed, not built.** `TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`
  and `TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md` propose a `stop` control message, a
  bounded shutdown timeout, a `stopping` state, and terminate-on-timeout, with public stdout remaining
  MotionFrame JSON only throughout. These are **design documents**; no source implements them.
- **The helper is not wired into the default runtime.** `lvk-helper-h2-state-machine-smoke` is a
  standalone executable and is not linked into `lvk-tracker-core`. The only helper entry point in
  `main.cpp` is the explicit, opt-in `--helper-runtime-smoke PATH` flag (default tracking unchanged
  when omitted). No default runtime wiring exists.

**Conclusion:** shutdown / control-channel behavior is **not** implemented. A future slice that builds
the designed `stop` handshake must first settle the decisions below so it stays as small, honest, and
source-grounded as the synthetic-smoke vectors did.

## In Scope for a Future Shutdown / Control Implementation

These are **candidate decisions to be made**, not implementation. A future slice must answer each:

- **Shutdown ownership / shape.** Whether H2 helper shutdown is process-lifecycle-only (Native Core
  terminates the child process), control-message-based (a `stop` message over the private channel),
  or both (graceful `stop` first, forced termination as a bounded fallback).
- **Graceful before forced.** Whether a graceful shutdown attempt is required before forced
  termination, or whether forced termination alone is acceptable for the first slice.
- **Timeout boundaries.** What bounded timeout(s) are needed (e.g. a graceful-stop timeout distinct
  from the existing bounded run timeout) and how they relate to startup / liveness timeouts.
- **Shutdown markers.** Whether shutdown markers are allowed at all, and if so where they may appear
  (helper private stdout only) and that they remain distinct from public MotionFrame.
- **Diagnostic privacy.** Confirmation that helper shutdown diagnostics remain private to Native Core
  (safe `[helper]` / `[h2-...]` style stderr diagnostics only; never forwarded to public stdout).
- **One-shot vs stateful cancellation.** Whether stop / cancellation is one-shot (a single request,
  idempotent on repeat) or stateful (tracked across transitions), and the resulting state model.
- **Already-terminal helpers.** Defined behavior when a helper has already `exited`, `timed_out`, or
  `failed` before / during a stop request (stop must be safe and not corrupt the reconstructed state).
- **Interaction with fallback.** How shutdown interacts with the existing fallback state (a stop during
  `failed` / `timed_out`, and whether a clean stop ever triggers fallback) without changing the
  current fallback meaning.
- **Separation from restart / backoff.** What must remain explicitly separate from restart / backoff
  (this gate covers stop / shutdown only; restart / backoff stays a distinct, separately gated slice).

## Out of Scope

The following are explicitly **excluded** from this gate and from the future shutdown / control slice
it gates:

- production H2 integration
- default `lvk-tracker-core` runtime wiring
- restart / backoff
- backend / model / runtime selection
- real camera / frame access
- raw frame / pixel / tensor IPC
- high-rate frame transport
- MotionFrame schema changes
- Electron / Web Preview / Motion Protocol changes
- general stdout / stderr streaming framework
- production size / rejection / backpressure policy
- new dependencies
- telemetry / analytics / cloud upload / network behavior

## Required Invariants for Future Work

Any future shutdown / control work must preserve all of the following:

- Public `lvk-tracker-core` stdout remains **MotionFrame JSON only**.
- Helper stdout / stderr remain **private to Native Core**.
- Shutdown / control diagnostics must **not** leak into public MotionFrame stdout.
- Shutdown / control behavior must **not** require Electron or Web Preview runtime dependencies.
- Camera frames stay local (no external transport in v0.1).
- Any future implementation must be **opt-in or gated** until explicitly approved (no default runtime
  wiring by default).
- Any future test / smoke-only behavior must be labeled **smoke-local / test-only** (mirroring
  `kMaxHelperLineBytesForSmoke` and the existing synthetic vectors), and must not be presented as a
  production supervisor policy.
- No new dependency, telemetry, analytics, cloud upload, or network behavior.

## Acceptance Criteria for the Gate

The next implementation PR may only start after explicit decisions are recorded for:

- **shutdown ownership** — process-lifecycle-only, control-message-based, or both,
- **shutdown signal / control shape** — the concrete stop signal / control-message shape (consistent
  with the designed framing contract, not a new framework),
- **timeout behavior** — the bounded shutdown timeout(s) and their relation to existing timeouts,
- **fallback interaction** — how stop interacts with the existing fallback state,
- **private diagnostics** — confirmation shutdown diagnostics stay private to Native Core,
- **public stdout safety** — confirmation public stdout stays MotionFrame JSON only throughout,
- **separation from restart / backoff** — restart / backoff stays a distinct, separately gated slice,
- **validation strategy** — a planned, smoke-local / test-only validation approach (no production
  wiring), with checks planned before implementation.

Until each of these is decided and recorded, no shutdown / control-channel implementation should
begin.

## What Remains Unapproved

- production H2 integration
- default `lvk-tracker-core` runtime wiring
- shutdown / control-channel implementation
- restart / backoff
- real frame access
- helper-owned camera capture
- raw frame / pixel / tensor IPC
- high-rate raw frame transport
- general parser / backpressure / streaming framework
- production supervisor policy
- backend / model / runtime selection
- MotionFrame schema changes
- Electron / Web Preview / Motion Protocol changes
- new dependencies
- manual local validation execution

## Recommended Next Step

- After this docs gate is merged, do a **read-only review** of this shutdown / control-channel gate to
  confirm the decision list is complete and source-grounded, **or** draft a **narrowly scoped synthetic
  shutdown smoke plan** (smoke-local / test-only, no runtime wiring) that records the chosen decisions
  above before any code is written.
- Do **not** implement shutdown / control behavior in the same step as this gate.
- Do **not** proceed to default runtime wiring or production H2 integration until the acceptance
  criteria above are satisfied and separately approved.

## Cross-References

- [`docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md`](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
  — H2 docs navigation / status index.
- [`docs/TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md`](TRACKING_HELPER_PROCESS_H2_NEXT_SYNTHETIC_VECTOR_GATE.md)
  — gate that scoped the helper-output error vector group; flags that shutdown / control-channel
  vectors require a separate scope decision (this document).
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_OUTPUT_SCOPE_GATE.md)
  — prior scope-gate precedent for honest, source-grounded scoping.
- [`docs/TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md`](TRACKING_HELPER_PROCESS_H2_OVERSIZED_LINE_SMOKE_CLOSEOUT.md)
  — closeout for the final helper-output error vector (PR #157), completing the synthetic-smoke group.
- [`docs/TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md`](TRACKING_HELPER_PROCESS_H2_HANDSHAKE_STATE_MACHINE.md)
  — designed (not implemented) startup / shutdown handshake and helper state machine.
- [`docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md`](TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md)
  — designed (not implemented) control messages (`stop`) and framing the future slice would follow.
- [`docs/TRACKING_SPEC.md`](TRACKING_SPEC.md) — Native Core tracking output and fallback behavior.
- [`docs/MOTION_PROTOCOL.md`](MOTION_PROTOCOL.md) — MotionFrame schema (`schemaVersion: 1`).
