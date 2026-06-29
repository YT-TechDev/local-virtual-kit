# Electron Native Pipeline Launch Boundary Validation — 2026-06-29

## 1. Summary

This report records the investigation and minimal implementation that establishes
the Electron-owned packaged native runtime launch boundary.

**Key findings:**

- Electron already had a full dev-mode native pipeline lifecycle (`NativePipelineManager`,
  `queryNativeRuntimeCapabilities`, `cleanupOnQuit`, IPC handlers).
- The missing piece was packaged native runtime path resolution: `resolveTrackerExecutable`
  only walked `native/tracker-core/build/` (dev paths); packaged mode was not covered.
- `electron-builder.yml` already wires `.lvk-native-runtime/` → `<resources>/native-runtime/`
  via `extraResources`, so the packaged layout is correct.
- Two helper functions were added to `nativePipeline.ts`:
  - `resolvePackagedTrackerExecutable()` — checks `process.resourcesPath/native-runtime/bin/`
    without mutating global `PATH` or importing Electron APIs beyond what Node.js provides.
  - `buildNativeRuntimeEnv(binDir)` — builds a process-local env with the native runtime
    `bin/` dir prepended to `PATH`; the spawned child process inherits this env, no global
    `PATH` mutation occurs.
- Both `queryNativeRuntimeCapabilities()` and `NativePipelineManager.start()` now prefer the
  packaged path when available and fall back to the dev build path.
- The `motion-ws-bridge.mjs` development bridge is not included in packaged builds; full
  packaged pipeline start (tracker + bridge) remains a follow-up item.

**Automated checks run in this pass:**

| Check                                     | Result |
| ----------------------------------------- | ------ |
| `pnpm format:check`                       | PASS   |
| `pnpm --filter @lvk/desktop typecheck`    | PASS   |
| `pnpm --filter @lvk/desktop build`        | PASS   |
| `pnpm --filter @lvk/desktop build:unpack` | PASS   |

This report does not claim local/manual Electron GUI validation, packaged Electron
app launch, or native process spawn from the packaged Electron app. Those require
a graphical desktop session and are out of scope for this automated pass.

## 2. Target

- Repository: `YT-TechDev/local-virtual-kit`
- Branch: `feat/electron-native-pipeline-launch-validation`
- Prior validation chain: PR #370–#377 (DLL manifest, packaged native start, full
  `build:unpack`, VC++ Redistributable, OpenCV camera smoke, continuous bridge,
  OBS Browser Source availability)

## 3. Environment

- OS: Windows 11 Pro (x64)
- Node / pnpm: Node v24.16.0 / pnpm 11.5.0
- Electron: 39.8.10 (via `apps/desktop/package.json`)
- electron-builder: 26.8.1

## 4. Investigation findings

### 4.1 Pre-existing Electron native lifecycle (dev mode)

`apps/desktop/src/main/nativePipeline.ts` already contained:

- `NativePipelineManager` — full start/stop/cleanup state machine for the tracker
  and bridge processes; IPC-exposed via `index.ts`.
- `queryNativeRuntimeCapabilities()` — spawns `--print-runtime-capabilities` and
  parses sanitized key=value output.
- `cleanupOnQuit()` — kills tracker and bridge on `app.before-quit`.
- Force-kill with 1 500 ms SIGKILL fallback after SIGTERM.
- `findRepoRoot()` — walks up from `__dirname` to find the monorepo root for dev mode.
- `resolveTrackerExecutable(repoRoot)` — searches `native/tracker-core/build/` including
  `Debug`, `Release`, `RelWithDebInfo`, `MinSizeRel` config dirs.

No packaged path resolution was present. In packaged mode the dev build path
would not exist, `resolveTrackerExecutable` would return `null`, and both `start()`
and `queryNativeRuntimeCapabilities()` would return an error/skipped result without
attempting the packaged location.

### 4.2 Packaged resources layout (confirmed from prior passes)

`electron-builder.yml` `extraResources` is already configured:

```yaml
extraResources:
  - from: ../../.lvk-native-runtime/
    to: native-runtime/
    filter:
      - "**/*"
```

`build:unpack` (PR #373, re-confirmed in this pass) places the tracker and all 21
manifest DLLs at:

```txt
<unpacked-app>/resources/native-runtime/bin/
  lvk-tracker-core.exe
  <21 manifest DLLs>
```

In packaged Electron, `process.resourcesPath` resolves to `<unpacked-app>/resources/`.

### 4.3 Bridge in packaged mode

`tools/motion-ws-bridge.mjs` is a development tool and is not included in the
packaged app. `NativePipelineManager.start()` checks `existsSync(bridgeScriptPath)`
before spawning, which will return `false` in packaged mode, producing a clear
`motionBridgeStatus: 'error'` with an actionable message. This is correct behavior
for the current release scope. A packaged bridge solution is a follow-up item.

## 5. Changes made

**File:** `apps/desktop/src/main/nativePipeline.ts`

Two helper functions added:

```typescript
function resolvePackagedTrackerExecutable(): string | null;
```

Checks `process.resourcesPath/native-runtime/bin/lvk-tracker-core.exe` (or the
platform-appropriate executable name). Returns `null` if the path does not exist.
Does not import Electron APIs; accesses `process.resourcesPath` via type cast on
the existing `nodeProcess` alias. Does not mutate global `PATH`.

```typescript
function buildNativeRuntimeEnv(binDir: string): NodeJS.ProcessEnv;
```

Returns a copy of `process.env` with `PATH` set to `<binDir>;<SystemRoot\System32>;<SystemRoot>`
(Windows) or `<binDir>:/usr/bin:/bin` (other platforms). The spawned child process
inherits this env; global `process.env.PATH` is never mutated.

`queryNativeRuntimeCapabilities()` updated:

- Tries `resolvePackagedTrackerExecutable()` first.
- Falls back to `resolveTrackerExecutable(repoRoot)` (dev build path).
- Passes `buildNativeRuntimeEnv(dirname(executablePath))` as the child process env
  when using the packaged path.

`NativePipelineManager.start()` updated:

- Tries `resolvePackagedTrackerExecutable()` first for the tracker.
- Falls back to `resolveTrackerExecutable(repoRoot)`.
- Passes `buildNativeRuntimeEnv(dirname(trackerExecutablePath))` to the tracker
  `spawn()` call when using the packaged path.
- Bridge resolution is unchanged; bridge still fails gracefully in packaged mode.

## 6. Checks and results

### 6.1 Formatting

```
pnpm format:check
```

Result: **PASS** — `All matched files use Prettier code style!`

### 6.2 Type check

```
pnpm --filter @lvk/desktop typecheck
```

Result: **PASS** — no TypeScript errors (`typecheck:node` and `typecheck:web` both clean).

### 6.3 Build

```
pnpm --filter @lvk/desktop build
```

Result: **PASS** — electron-vite main (29.59 kB), preload (1.58 kB), renderer built
successfully.

### 6.4 build:unpack

```
pnpm --filter @lvk/desktop build:unpack
```

Result: **PASS** — electron-builder exit 0. Packaged tracker confirmed signed at
`dist\win-unpacked\resources\native-runtime\bin\lvk-tracker-core.exe`.

## 7. Out-of-scope items

- Packaged Electron app GUI launch and native pipeline start from the packaged app
  (requires graphical desktop session with packaged bridge).
- Bridge packaging for packaged mode (design question for a follow-up PR).
- Full packaged start-to-stop pipeline validation from the Electron UI.
- OBS scene automation.
- MotionFrame schema changes.
- Web Preview behavior changes.
- Native Core C++ changes.
- Telemetry, analytics, cloud upload, or new network behavior.

## 8. Local-first / privacy confirmation

- No raw camera frames were opened, printed, written, uploaded, persisted, or logged
  by any check in this pass.
- No global `PATH` was mutated. `buildNativeRuntimeEnv` returns a new env object for
  the spawned child process only.
- No runtime download of OpenCV or native dependencies was introduced.
- No telemetry, analytics, cloud upload, external frame processing, hidden network
  calls, or new network behavior was introduced.
- No actual DLLs, Native Core binaries, build artifacts, `.lvk-native-runtime/`
  contents, `win-unpacked/` directory, raw logs, screenshots, or local absolute
  paths were committed.
- `MotionFrame` schema and Motion Protocol were not changed.
- Web Preview code was not changed.
- Native Core C++ and CMake behavior were not changed.

## 9. Follow-up items

1. **Packaged bridge for packaged pipeline start:** `tools/motion-ws-bridge.mjs` is
   not included in packaged builds. Packaging or embedding the bridge is required
   before `NativePipelineManager.start()` can start a full pipeline from the packaged
   app. Options include: bundling the bridge as a packaged resource, using a native
   WebSocket bridge embedded in the Native Core binary, or spawning the bridge via
   a packaged Node.js helper.
2. **Manual Electron packaged launch validation:** with `.lvk-native-runtime/` staged
   and `build:unpack` rebuilt, launch `dist/win-unpacked/desktoplvk.exe`, open the
   Electron UI, and confirm `getNativeRuntimeCapabilities` resolves the packaged path
   and returns `opencvCameraSupport=true`. Record the result in a follow-up pass.
3. **Packaged bridge design:** decide whether the bridge is packaged alongside the
   app or replaced by an in-process WebSocket server in Electron main.
