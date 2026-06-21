# Tracking Helper Process H2 Helper Lifecycle Handshake Failure Guards Closeout

## Status

Status: closeout for the next H2 implementation slice after PR #227 (the helper lifecycle handshake
success path).
Scope: records implementation state for explicit-smoke-only, Native Core/checker-bounded failure
guards for the `helper-lifecycle-handshake` observation. Records implementation state only; it is not
a production readiness claim.

This slice is explicit-smoke-only and Native Core/checker bounded. Production and default runtime
behavior remain **unapproved**.

## What Was Implemented

Fail-closed failure coverage for the lifecycle-handshake observation across three deterministic
vectors. Each vector drives the **same** `handleLifecycleHandshake` observation (unchanged) through an
existing synthetic helper failure mode — or, for launch-failure, a non-existent helper path — so the
observation fails before a clean handshake. In every failure vector the run exits non-zero, public
`lvk-tracker-core` stdout is empty (no MotionFrame, and deliberately no fallback frame), public stderr
carries only the expected safe parent `[helper-runtime-smoke] ` diagnostic, and the helper child's
stdout/stderr stay private to Native Core.

Two new explicit smoke cases were added; launch-failure needed no new case (it reuses the existing
`helper-lifecycle-handshake` case with a non-existent helper path).

| Vector         | Smoke case                                | Helper args / path                                   | Exit         | Public stdout | Public stderr                                   |
| -------------- | ----------------------------------------- | ---------------------------------------------------- | ------------ | ------------- | ----------------------------------------------- |
| launch-failure | `helper-lifecycle-handshake`              | non-existent helper path                             | non-zero (1) | 0 lines       | `[helper-runtime-smoke] helper launch failed`   |
| nonzero-exit   | `helper-lifecycle-handshake-nonzero-exit` | `--frames N --fail-after 1`                          | non-zero (1) | 0 lines       | `[helper-runtime-smoke] helper exited non-zero` |
| timeout        | `helper-lifecycle-handshake-timeout`      | `--frames 5 --interval-ms 1000` (short hang timeout) | non-zero (1) | 0 lines       | `[helper-runtime-smoke] helper timed out`       |

The new cases reuse the existing synthetic helper failure modes (`--fail-after`, `--interval-ms`); no
new synthetic helper behavior was added.

## Exact Files Changed

- `native/tracker-core/src/helper_runtime_smoke.h` — added the
  `HelperLifecycleHandshakeNonzeroExit` and `HelperLifecycleHandshakeTimeout` enum values with a
  smoke-only comment.
- `native/tracker-core/src/helper_runtime_smoke.cpp` — extended `buildHelperArguments()` so the two
  new cases reuse the existing `--fail-after 1` and `--interval-ms 1000` argument sets; extended
  `smokeTimeoutMs()` so the new timeout case uses the existing short hang timeout; extended the
  lifecycle-handshake dispatch in `runHelperRuntimeSmoke()` to route the two new cases into the
  existing `handleLifecycleHandshake()`. The handler body was **not** changed — it already returns
  non-zero with zero public stdout for non-zero exit and timeout.
- `native/tracker-core/src/main.cpp` — explicit smoke-case argument registration only: added the
  `helper-lifecycle-handshake-nonzero-exit` and `helper-lifecycle-handshake-timeout` parser branches
  and added the values to the usage string, the option description, and the unsupported-value error
  message.
- `tools/check-helper-runtime-integration.mjs` — appended the parametrized
  `assertLifecycleHandshakeFailureGuard()` and invoked it for the three vectors; updated the
  top-of-file header comment.
- `docs/TRACKING_HELPER_PROCESS_H2_HELPER_LIFECYCLE_HANDSHAKE_FAILURE_GUARDS_CLOSEOUT.md` — this
  closeout.
- `docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md` — index update (reading order, current active
  boundary, current design state).

`native/tracker-core/src/synthetic_helper_main.cpp` was **not** changed: all failure modes already
exist.

## Why The Slice Is Explicit-Smoke-Only

Both new cases are reachable only when `--helper-runtime-smoke <path>` is supplied together with the
explicit `--helper-runtime-smoke-case` selector. With the smoke path omitted, `runHelperRuntimeSmoke`
is never entered and the new enum values are never used. The slice adds no default runtime wiring, no
production supervisor behavior, no production handshake/control channel, and no fallback MotionFrame
emission.

## Why Default Runtime Behavior Remains Unchanged

`main()` calls `runHelperRuntimeSmoke` only when `options.helperRuntimeSmokePath` is non-empty. The
default tracking path is untouched, and the new parser branches are reached only when the explicit
`--helper-runtime-smoke-case` flag selects one of the new values. Manual confirmation below shows the
default `--frames 3` run still emits exactly 3 MotionFrame JSON lines on stdout with empty stderr, and
the existing handshake success case still exits 0 with zero public stdout lines.

## How Helper stdout/stderr Remain Private

The failure cases route through the same `handleLifecycleHandshake`, which only reads the privately
captured `helperRun.stdoutText` / `helperRun.stderrText` and never writes captured bytes to a public
stream. On failure it writes only a fixed safe parent diagnostic string containing no captured helper
content. The checker asserts no helper lifecycle marker, helper diagnostic, raw child stderr form,
child stdout JSON marker, policy/error text, unsafe child output, or smoke-only marker appears on any
public stream.

## How Public stdout/stderr Safety Is Preserved

- Public stdout: exactly zero non-empty lines on every failure vector (the handler has no access to
  the MotionFrame output stream).
- Public stderr: only safe parent `[helper-runtime-smoke] ` diagnostics; no forbidden child markers
  even behind the safe prefix; the success marker `helper lifecycle handshake observed` never appears
  on a failure vector.
- Each failure vector exits non-zero intentionally and deterministically.

## Checker Coverage Added

`tools/check-helper-runtime-integration.mjs` now runs `assertLifecycleHandshakeFailureGuard()` for the
three vectors. Per vector it asserts: non-zero exit; exactly zero public stdout lines; no helper
lifecycle marker, helper diagnostic, raw helper stderr, child stdout JSON marker, unsafe diagnostic
marker, smoke-only marker, policy/error text, or raw-data marker on public stdout (reusing
`helperSmokeEntryMarkers`, `forbiddenStdoutMarkers`, `unsafeChildMarkers`); public stderr is safe
parent `[helper-runtime-smoke] ` prefixed only, with no forbidden child markers behind the prefix; the
expected safe failure diagnostic is present; and the success marker is absent.

## Gates 1 Through 7, Foundation Consolidation, And Handshake Success Guard Remain Intact

The existing Gate 1 positive control, Gate 2 default-runtime isolation guard, Gate 3
unsafe-diagnostic fail-closed guard, Gate 4 failure-case stdout guards, Gate 5/6/7 normal-path public
stream guards, the H2 Foundation Implementation Gate 1 foundation-boundary consolidation assertion,
and the PR #227 lifecycle-handshake success guard all run unchanged before the new failure guards. The
new guards are appended after them; no existing assertion was modified.

## Validation Commands And Exact Results

Run from the worktree `.claude/worktrees/h2-lifecycle-handshake-failure-guards` on Windows 11
(MSVC 19.44, Visual Studio 17 2022 generator):

- `git diff --check` → clean (no whitespace errors).
- `node --check tools/check-helper-runtime-integration.mjs` → OK (valid syntax).
- prettier (repo binary) `--check` on the changed `.mjs` and `.md` files → all use Prettier code
  style.
- `cmake -S native/tracker-core -B native/tracker-core/build` → configured (OpenCV camera / face
  detector OFF, as expected for the CI-safe synthetic path).
- `cmake --build native/tracker-core/build --config Debug --target lvk-tracker-core lvk-synthetic-helper`
  → built both binaries with no errors (only the pre-existing C4819 codepage warning on
  `helper_process_supervisor.h`, unrelated to this change).
- `node tools/check-helper-runtime-integration.mjs <built lvk-tracker-core> <built lvk-synthetic-helper>`
  → all guards passed, including:
  `Lifecycle-handshake failure guards OK: launch-failure, nonzero-exit, and timeout each fail closed`
  `with non-zero exit, zero public stdout lines, safe parent-prefixed stderr only, and helper`
  `stdout/stderr kept private to Native Core.`
- Manual confirmation (exit / public stdout line count / public stderr):
  - launch-failure (`helper-lifecycle-handshake` + non-existent helper path) → exit 1, 0 stdout lines,
    `[helper-runtime-smoke] helper launch failed`.
  - nonzero-exit (`helper-lifecycle-handshake-nonzero-exit`) → exit 1, 0 stdout lines,
    `[helper-runtime-smoke] helper exited non-zero`.
  - timeout (`helper-lifecycle-handshake-timeout`) → exit 1, 0 stdout lines,
    `[helper-runtime-smoke] helper timed out`.
  - success (`helper-lifecycle-handshake`) → exit 0, 0 stdout lines,
    `[helper-runtime-smoke] helper lifecycle handshake observed; ...` (unchanged).
  - default-path regression (`--frames 3`) → exit 0, 3 MotionFrame JSON stdout lines, empty stderr
    (unchanged).

## Skipped Checks And Reasons

- Full-repo `pnpm format:check` was not run because `pnpm` is not available on this machine's PATH (in
  either Bash or PowerShell). Prettier was instead run directly against the changed checker file and
  the new/updated Markdown docs via the repo's local prettier binary (results above). The full-repo
  `pnpm format:check` should be confirmed in a `pnpm`-enabled environment.
- No webcam, OpenCV camera, OBS, Electron GUI, or OS camera-permission validation was performed; this
  slice is synthetic/smoke-only and CI-safe and touches none of those surfaces.

## Out Of Scope (Deferred)

The following lifecycle-handshake failure vectors were intentionally **not** implemented in this PR
because they would require new synthetic helper modes and/or handler-semantics changes:

- missing-ready (a clean exit-0 without a `ready` line; `--delay-ready-ms` under a short timeout trips
  the timeout branch instead);
- missing-stopped (`--fail-after` makes the non-zero exit dominate, so it cannot be isolated);
- malformed lifecycle output (`--emit-malformed-line` still yields a clean ready/stopped/exit-0
  handshake, so it is not a failure without changing handler semantics).

## Non-Goals Confirmation

This slice did not add and does not imply: production H2 integration; default helper runtime wiring;
default `lvk-tracker-core` H2 runtime wiring; production supervisor behavior; diagnostics-safety
policy engine behavior; fallback MotionFrame emission; MotionFrame schema changes; Motion Protocol
changes; Electron changes; Web Preview changes; dependency changes; telemetry; analytics; cloud
upload; external frame processing; hidden network calls; new network behavior; camera behavior
changes; helper-owned camera capture; raw frame / pixel / tensor IPC; high-rate raw frame transport;
real parent-to-child production control channel; production forced termination; restart / backoff;
backend / model / runtime selection; readiness claims; or any production behavior.

## Cross-References

- [H2 docs index](TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md)
- [H2 helper lifecycle handshake smoke closeout (PR #227)](TRACKING_HELPER_PROCESS_H2_HELPER_LIFECYCLE_HANDSHAKE_SMOKE_CLOSEOUT.md)
- [H2 Foundation Implementation Gate 2 decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_GATE_2_DECISION.md)
