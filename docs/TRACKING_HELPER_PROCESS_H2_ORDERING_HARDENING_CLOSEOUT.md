# Tracking Helper Process H2 Ordering Hardening Closeout

## Status

Status: docs-only closeout for the H2 synthetic smoke lifecycle marker ordering hardening group after PR #181 through PR #185.
Scope: documents the completed synthetic-only ordering hardening; implements nothing.

This closeout does not approve production H2 integration, default `lvk-tracker-core` runtime wiring, or any production runtime behavior.

## Purpose

This document closes out the H2 synthetic smoke lifecycle marker ordering hardening group. The hardening made the relevant synthetic smoke cases assert lifecycle marker order using first-occurrence positions, so repeated helper result markers cannot hide an earlier out-of-order marker.

## Covered Synthetic Smoke Cases

The ordering hardening is complete for these synthetic-only smoke cases:

- `normal`
- `shutdown_graceful_exit`
- `shutdown_timeout_forced_exit`
- `shutdown_after_helper_already_exited`
- `unknown_message_type`
- `malformed_line`

## Ordering Rule

The synthetic helper can emit repeated `"type":"result"` markers. A search-from-prior-match / subsequence check can therefore be insufficient: it could skip an early out-of-order `result` and match a later one instead.

The hardened rule is first-occurrence ordering over captured private helper stdout:

- Clean lifecycle: `first(ready) < first(result) < first(stopped)`
- Graceful shutdown: `first(ready) < first(result) < first(stopping) < first(stopped)`
- Forced-exit shutdown synthetic vector: `first(ready) < first(result) < first(stopping) < first(shutdown-timeout) < first(stopped)`

These assertions remain smoke-local and synthetic-only. They are substring-position checks, not a production JSON parser or production supervisor policy.

## Error-Vector Handling

`unknown_message_type` and `malformed_line` keep their injected marker checks as separate presence assertions. Those injected markers are intentionally not part of lifecycle ordering; the ordering chain remains limited to lifecycle markers such as `ready`, `result`, and `stopped`.

## Oversized-Line Exception

`oversized_line_rejected` intentionally remains outside this ordering hardening. That case uses bounded-line scanning that rejects an oversized line before marker reconstruction, so it should stay on its existing bounded-line scan path. This closeout does not propose changing it.

## Explicit Non-Approvals

This closeout does not approve or implement:

- production H2 integration;
- default `lvk-tracker-core` runtime wiring;
- helper process supervisor production policy changes;
- real parent-to-child control channel semantics;
- real forced termination;
- restart / backoff;
- backend / model / runtime selection;
- real camera access;
- helper-owned camera capture;
- raw frame / pixel / tensor IPC;
- MotionFrame schema changes;
- Electron / Web Preview / Motion Protocol changes;
- new dependencies;
- telemetry, analytics, cloud upload, external frame processing, or new network behavior.

## Next Recommended Step

Perform a read-only scope review before moving toward any production-runtime or runtime-integration planning. Any future docs step should remain explicit and owner-approved.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 synthetic smoke phase handoff](TRACKING_HELPER_PROCESS_H2_SYNTHETIC_SMOKE_PHASE_HANDOFF.md)
- [H2 first implementation gate draft](TRACKING_HELPER_PROCESS_H2_FIRST_IMPLEMENTATION_GATE_DRAFT.md)
