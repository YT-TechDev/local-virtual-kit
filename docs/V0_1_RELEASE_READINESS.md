# v0.1 Release Readiness Checklist

## Purpose

Use this checklist to decide whether Local Virtual Kit (LVK) v0.1 is ready to tag or announce.

LVK v0.1 is a local-first developer foundation for native tracking, `MotionFrame` transport, Web Preview rendering, Electron desktop orchestration, and OBS Browser Source workflow testing. It is not a full consumer VTuber suite, and this checklist must not be used to claim final product-quality tracking, packaged desktop distribution, or production OBS readiness unless those checks were actually performed.

## Scope

This checklist focuses only on v0.1 release readiness for the current repository state:

- Web Preview readiness.
- Electron desktop readiness.
- Native tracker readiness.
- `MotionFrame` protocol readiness.
- OBS workflow readiness.
- Local-first privacy confirmation.
- Known limitations.
- Release-blocking issue tracking.
- Post-release follow-up items.

Keep broader system boundaries in `docs/ARCHITECTURE.md`, technology/package details in `docs/TECH_STACK.md`, local smoke-test steps in `docs/LOCAL_RUNTIME_CHECKLIST.md`, OBS setup details in `docs/OBS_BROWSER_SOURCE_GUIDE.md`, and `MotionFrame` protocol details in `docs/MOTION_PROTOCOL.md`.

## Automated repository checks

Run these commands from the repository root unless noted otherwise. If a command is unavailable or not run, report that honestly in the release notes or verification log. CMake and OpenCV availability can vary by local machine, so record the environment and any missing native prerequisites.

| Done | Check                          | Command                                                                                 | Result / note |
| ---- | ------------------------------ | --------------------------------------------------------------------------------------- | ------------- |
| [ ]  | Install workspace dependencies | `pnpm install`                                                                          |               |
| [ ]  | Formatting                     | `pnpm format:check`                                                                     |               |
| [ ]  | Workspace build                | `pnpm build`                                                                            |               |
| [ ]  | Type checks                    | `pnpm typecheck`                                                                        |               |
| [ ]  | Tests                          | `pnpm test`                                                                             |               |
| [ ]  | Lint                           | `pnpm lint`                                                                             |               |
| [ ]  | Native configure               | `cmake -S native/tracker-core -B native/tracker-core/build`                             |               |
| [ ]  | Native build                   | `cmake --build native/tracker-core/build`                                               |               |
| [ ]  | Native tracker output smoke    | `node tools/check-native-tracker-output.mjs native/tracker-core/build/lvk-tracker-core` |               |
| [ ]  | Motion WebSocket bridge smoke  | `pnpm test:motion-ws-bridge`                                                            |               |

Do not mark v0.1 as fully release-ready from automated checks alone. Electron, OBS, webcam, native camera, and OS permission validation require local/manual checks.

## Manual local checks

Electron, OBS, webcam, native camera, and OS permission checks are not expected to be validated in Codex Cloud, headless CI, or other cloud runners. They require local hardware and/or a local graphical desktop environment. Mark each item with the OS, hardware, and whether it was actually performed.

| Done | Local/manual check                                                 | Expected confirmation                                                                                                              | Result / note |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| [ ]  | Electron app starts locally.                                       | `pnpm dev:desktop` opens the Electron desktop app in a local graphical session.                                                    |               |
| [ ]  | Web Preview opens with dummy source.                               | `http://localhost:5173/?source=dummy` loads while `pnpm dev:web` is running.                                                       |               |
| [ ]  | Web Preview opens with native source.                              | `http://localhost:5173/?source=native` loads and consumes local native-source `MotionFrame` data when the local bridge is running. |               |
| [ ]  | Native tracker can emit `MotionFrame`-shaped output.               | Native output passes the repository checker or equivalent local validation.                                                        |               |
| [ ]  | Electron can start and stop the native development pipeline.       | Desktop controls start/stop the local development native pipeline or show a clear local error.                                     |               |
| [ ]  | OBS Browser Source can load the OBS-friendly preview URL.          | OBS or an equivalent local Browser Source loads `http://localhost:5173/?mode=obs&source=native`.                                   |               |
| [ ]  | Webcam / OpenCV camera behavior is checked locally when available. | A compatible local webcam, OS permission, and OpenCV-enabled native build are used when available.                                 |               |
| [ ]  | OS camera permissions are verified locally.                        | The terminal or Electron host process has the required local camera permission.                                                    |               |
| [ ]  | No raw camera frames are sent to external servers.                 | Camera frames remain local to the native runtime path; only local `MotionFrame` transport is used.                                 |               |

## Privacy confirmation

LVK v0.1 is local-first. Confirm these items before tagging or announcing v0.1:

- [ ] Raw camera frames stay local.
- [ ] `MotionFrame` transport uses local runtime paths.
- [ ] OBS points to localhost URLs such as `http://localhost:5173/?mode=obs&source=native`.
- [ ] No cloud upload is introduced.
- [ ] No telemetry or analytics is introduced.
- [ ] No remote camera processing is introduced.
- [ ] v0.1 does not send camera frames to external servers.

## Documentation readiness

- [ ] `README.md` describes the current development flow.
- [ ] `docs/LOCAL_RUNTIME_CHECKLIST.md` exists and is current.
- [ ] `docs/OBS_BROWSER_SOURCE_GUIDE.md` exists and is current if the OBS Browser Source guide has been merged.
- [ ] `MotionFrame` details remain in `docs/MOTION_PROTOCOL.md`.
- [ ] Architecture details remain in `docs/ARCHITECTURE.md`.
- [ ] This release readiness checklist stays focused and does not duplicate broad architecture, roadmap, or protocol content.

## Known limitations

- v0.1 is an early developer foundation, not a full consumer VTuber suite.
- OBS validation must be performed locally before claiming OBS readiness.
- Webcam/OpenCV behavior depends on local hardware, OS camera permissions, and native build support.
- Tracking quality is not final product-quality face tracking.
- Electron, webcam, OBS, native camera, and OS permission checks are local/manual unless explicitly validated on a suitable local machine.
- Cloud features, telemetry, analytics, and remote camera processing are out of scope for v0.1.

## Release-blocking issues

Use this table to track blockers. Do not mark the release as ready while any required blocker remains open or unverified.

| Issue / PR | Area | Blocking reason | Status | Owner / note |
| ---------- | ---- | --------------- | ------ | ------------ |
|            |      |                 |        |              |
|            |      |                 |        |              |
|            |      |                 |        |              |

## Post-release follow-up items

Use this table for non-blocking follow-ups after v0.1. Keep entries grounded in accepted project scope or existing issues/docs before turning them into roadmap commitments.

| Item | Area | Reason | Candidate issue / note |
| ---- | ---- | ------ | ---------------------- |
|      |      |        |                        |
|      |      |        |                        |
|      |      |        |                        |

## Final readiness decision

Maintainer decision:

- [ ] Ready to tag v0.1.
- [ ] Not ready.
- [ ] Ready after local/manual checks.

Notes:

```txt

```
