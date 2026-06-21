# Tracking Helper Process H2 Helper Lifecycle Handshake Smoke Closeout

## Status

Status: closeout for the first H2 implementation slice after the post Foundation Gate 1 boundary
assertion owner decision (Option B) and the H2 Foundation Implementation Gate 2 decision.
Scope: records implementation state for an explicit-smoke-only, Native Core/checker-bounded helper
lifecycle handshake smoke case. Records implementation state only; it is not a production readiness
claim.

This is the first **implementation** PR after the gate-only phase. It is explicit-smoke-only and
Native Core/checker bounded. Production and default runtime behavior remain **unapproved**.

## What Was Implemented

A new explicit-smoke-only helper runtime smoke case, `helper-lifecycle-handshake`, selectable only
through the existing explicit `--helper-runtime-smoke` path plus the existing
`--helper-runtime-smoke-case` selector.

The case launches the existing synthetic helper through the existing bounded supervisor
(`runHelperProcessForSmoke`) and observes the helper lifecycle/ready boundary **from the privately
captured helper stdout only**:

- it confirms the helper announced its `ready` lifecycle boundary (with `"schemaVersion":1` and
  `"source":"synthetic-helper"`) and reached its clean `stopped` boundary (with `"schemaVersion":1`)
  before exiting `0`;
- it emits **nothing** to public stdout — exactly zero public stdout lines (no MotionFrame, and
  deliberately no fallback frame);
- it keeps the helper's stdout and stderr private to Native Core (never forwarded or echoed);
- it writes only a single safe parent `[helper-runtime-smoke] ` diagnostic to public stderr
  (`helper lifecycle handshake observed; helper streams kept private to Native Core`);
- it returns `0` on a clean handshake and non-zero otherwise (launch failure, timeout, non-zero exit,
  missing ready boundary, or missing stopped boundary).

This is distinct from the existing `normal` case, which maps helper result lines to MotionFrame JSON
on public stdout. The handshake case is a public-stdout-silent lifecycle observation path; it mirrors
the lifecycle-observation style of the standalone `lvk-helper-h2-state-machine-smoke` while staying
inside the existing `runHelperRuntimeSmoke` explicit-smoke entry point.

## Exact Files Changed

- `native/tracker-core/src/helper_runtime_smoke.h` — added the `HelperLifecycleHandshake` enum value
  to `HelperRuntimeSmokeCase` with a smoke-only comment.
- `native/tracker-core/src/helper_runtime_smoke.cpp` — added the file-local
  `handleLifecycleHandshake()` handler (takes only `diagnosticsOutput`, so it cannot write to public
  stdout) and a dispatch for the new case in `runHelperRuntimeSmoke()` placed right after the
  `UnsafeDiagnostic` dispatch (before `handleExpectedFailure`), so the case never reaches the
  MotionFrame-emitting normal path. `buildHelperArguments()` and `smokeTimeoutMs()` were not changed:
  the handshake case reuses the default `{--frames N}` arguments and the default 5000 ms timeout.
- `native/tracker-core/src/main.cpp` — explicit smoke-case argument registration only: added the
  `helper-lifecycle-handshake` branch to the `--helper-runtime-smoke-case` parser and added the value
  to the usage string, the option description, and the unsupported-value error message.
- `tools/check-helper-runtime-integration.mjs` — appended `assertLifecycleHandshakeGuard()` after the
  Foundation Boundary consolidation block and updated the top-of-file header comment.
- `docs/TRACKING_HELPER_PROCESS_H2_HELPER_LIFECYCLE_HANDSHAKE_SMOKE_CLOSEOUT.md` — this closeout.
- `docs/TRACKING_HELPER_PROCESS_H2_DOCS_INDEX.md` — index update (reading order, current active
  boundary, current design state).

`native/tracker-core/src/synthetic_helper_main.cpp` was **not** changed: the synthetic helper already
emits `ready` and `stopped` on its normal path, so no new lifecycle marker was needed.

## Why The Slice Is Explicit-Smoke-Only

The case is reachable only when `--helper-runtime-smoke <path>` is supplied and
`--helper-runtime-smoke-case helper-lifecycle-handshake` is selected. With the smoke path omitted,
`runHelperRuntimeSmoke` is never entered and the new enum value is never used. The case adds no
default runtime wiring, no production supervisor behavior, and no production handshake/control
channel. It is a smoke-local lifecycle observation that asserts a public/private stream boundary.

## Why Default Runtime Behavior Remains Unchanged

`main()` calls `runHelperRuntimeSmoke` only when `options.helperRuntimeSmokePath` is non-empty. The
default tracking path (dummy/OpenCV camera → pipeline → MotionFrame JSON on stdout) is untouched. The
new enum value defaults to nothing on the default path, and the parser branch is reached only when the
explicit `--helper-runtime-smoke-case` flag is supplied. Manual confirmation below shows the default
`--frames 3` run still emits exactly 3 MotionFrame JSON lines on stdout with empty stderr.

## How Helper stdout/stderr Remain Private

The handshake handler reads only `helperRun.stdoutText` / `helperRun.stderrText`, which the existing
bounded supervisor captures privately. It never writes those captured bytes to public stdout or
stderr. The only public stderr output is a fixed safe parent diagnostic string that contains no
captured helper content. The checker asserts no helper lifecycle marker, helper diagnostic, raw child
stderr form, child stdout JSON marker, policy/error text, unsafe child output, or smoke-only marker
appears on any public stream.

## How Public stdout/stderr Safety Is Preserved

- Public stdout: exactly zero non-empty lines (the handler has no access to the MotionFrame output
  stream).
- Public stderr: empty or only safe parent `[helper-runtime-smoke] ` diagnostics; no forbidden child
  markers even behind the safe prefix.
- The checker verifies both boundaries plus positive evidence that the parent reported the handshake
  observation.

## Checker Coverage Added

`tools/check-helper-runtime-integration.mjs` now runs `assertLifecycleHandshakeGuard()`, which runs
`lvk-tracker-core --helper-runtime-smoke <helper> --frames 3 --helper-runtime-smoke-case helper-lifecycle-handshake`
and asserts:

- the case runs only through the explicit `--helper-runtime-smoke` invocation (explicit-only
  invocation is additionally established by the reused default-runtime isolation guard, which proves
  the default path never enters helper supervision);
- exit status `0`;
- exactly zero public stdout lines;
- public stdout contains no helper lifecycle marker, helper diagnostic, raw helper stderr, child
  stdout JSON marker, unsafe diagnostic marker, smoke-only marker, policy/error text, or raw-data
  marker (reusing `helperSmokeEntryMarkers`, `forbiddenStdoutMarkers`, `unsafeChildMarkers`);
- public stderr is empty or safe parent `[helper-runtime-smoke] ` prefixed only, with no forbidden
  child markers behind the prefix;
- helper stdout/stderr remain private;
- positive evidence: public stderr reports `helper lifecycle handshake observed`.

## Gates 1 Through 7 Remain Intact

The existing Gate 1 positive control, Gate 2 default-runtime isolation guard, Gate 3
unsafe-diagnostic fail-closed guard, Gate 4 failure-case stdout guards, Gate 5/6/7 normal-path public
stream guards all run unchanged before the new guard. The new guard is appended after them; no
existing assertion was modified.

## Foundation-Boundary Consolidation Remains Intact

The H2 Foundation Implementation Gate 1 foundation-boundary consolidation assertion
(`assertDefaultRuntimeIsolationGuard()` + `assertNormalPathPublicStreamGuard(3, "Foundation boundary")`)
still runs unchanged immediately before the new lifecycle-handshake guard.

## Validation Commands And Exact Results

Run from the worktree
`.claude/worktrees/h2-helper-lifecycle-handshake-explicit-smoke` on Windows 11 (MSVC 19.44, Visual
Studio 17 2022 generator):

- `git diff --check` → clean (no whitespace errors).
- `node --check tools/check-helper-runtime-integration.mjs` → OK (valid syntax).
- `npx prettier --check tools/check-helper-runtime-integration.mjs` (via the repo prettier) →
  `All matched files use Prettier code style!`.
- `cmake -S native/tracker-core -B native/tracker-core/build` → configured (OpenCV camera / face
  detector OFF, as expected for the CI-safe synthetic path).
- `cmake --build native/tracker-core/build --config Debug --target lvk-tracker-core lvk-synthetic-helper`
  → built `lvk-tracker-core.exe` and `lvk-synthetic-helper.exe` (only a pre-existing C4819 codepage
  warning on `helper_process_supervisor.h`, unrelated to this change).
- `node tools/check-helper-runtime-integration.mjs <built lvk-tracker-core> <built lvk-synthetic-helper>`
  → all guards passed, including:
  `Lifecycle-handshake guard OK: explicit helper-lifecycle-handshake case observes the helper`
  `ready/stopped boundary privately, emits zero public stdout lines, keeps public stderr to safe`
  `parent diagnostics only, and keeps helper stdout/stderr private.`
- Manual handshake run
  `lvk-tracker-core --helper-runtime-smoke <helper> --frames 3 --helper-runtime-smoke-case helper-lifecycle-handshake`
  → exit `0`, zero public stdout lines, one public stderr line
  `[helper-runtime-smoke] helper lifecycle handshake observed; helper streams kept private to Native Core`.
- Default-path regression `lvk-tracker-core --frames 3` → exit `0`, 3 MotionFrame JSON stdout lines,
  empty stderr (unchanged).

## Skipped Checks And Reasons

- `pnpm format:check` over the whole repo was not run as `pnpm` is not available on this machine's
  PATH (in either Bash or PowerShell). Prettier was instead run directly against the changed checker
  file via the repo's local prettier binary (result above); the new Markdown docs were also
  prettier-checked. The full-repo `pnpm format:check` should be confirmed in a `pnpm`-enabled
  environment.
- No webcam, OpenCV camera, OBS, Electron GUI, or OS camera-permission validation was performed; this
  slice is synthetic/smoke-only and CI-safe and touches none of those surfaces.

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
- [H2 Foundation Implementation Gate 2 decision](TRACKING_HELPER_PROCESS_H2_FOUNDATION_IMPLEMENTATION_GATE_2_DECISION.md)
- [H2 post Foundation Gate 1 boundary assertion decision](TRACKING_HELPER_PROCESS_H2_POST_FOUNDATION_GATE_1_BOUNDARY_ASSERTION_DECISION.md)
- [H2 Foundation Gate 1 boundary assertion closeout](TRACKING_HELPER_PROCESS_H2_FOUNDATION_GATE_1_BOUNDARY_ASSERTION_CLOSEOUT.md)
