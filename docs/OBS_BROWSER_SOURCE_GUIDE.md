# OBS Browser Source Setup Guide

This guide explains how to add the LVK Web Preview to OBS as a Browser Source for the local LVK v0.1 development/runtime workflow.

It focuses only on the Browser Source workflow. For broader system boundaries, package ownership, and local runtime checks, see `docs/ARCHITECTURE.md`, `docs/TECH_STACK.md`, and `docs/LOCAL_RUNTIME_CHECKLIST.md`.

## Purpose

Use this guide when you want OBS to render the LVK Web Preview from a local development server.

LVK v0.1 is local-first:

- OBS should point to a `localhost` Web Preview URL.
- Raw camera frames must stay on the local machine.
- Native tracker, Web Preview, and MotionFrame transport runtime paths are local.
- This guide does not add or describe cloud upload, telemetry, analytics, remote camera processing, or external camera frame transmission.

## Start the Web Preview

From the repository root, start the Vite Web Preview development server:

```bash
pnpm dev:web
```

Keep this process running while using the preview in a browser or OBS Browser Source.

## Dummy renderer-only preview

Open the dummy preview URL in a normal browser:

```txt
http://localhost:5173/?source=dummy
```

The dummy preview uses frontend dummy `MotionFrame` data from the renderer/protocol development path. It is useful for checking the Web Preview renderer without starting native tracking.

Dummy preview does **not** require:

- the native tracker,
- a webcam,
- the local MotionFrame bridge, or
- OBS validation.

## Native OBS preview workflow

Use the native workflow when OBS should render the Web Preview from the native MotionFrame source.

First build the native tracker when the native source is needed:

```bash
cmake -S native/tracker-core -B native/tracker-core/build
cmake --build native/tracker-core/build
```

Then start the Web Preview if it is not already running:

```bash
pnpm dev:web
```

Start the desktop app in another terminal:

```bash
pnpm dev:desktop
```

After the native tracker has been built, the native pipeline can be started from the desktop app. The desktop app manages the development native process and local MotionFrame bridge for the native preview path.

Use this OBS-friendly native preview URL:

```txt
http://localhost:5173/?mode=obs&source=native
```

Before adding the URL to OBS, open it in a normal browser and confirm that the local Web Preview page loads. Animation from the native source requires the native pipeline and local MotionFrame bridge to be running.

## Add the URL to OBS

OBS validation is a **local/manual check** because it requires OBS or equivalent Browser Source validation on a local graphical machine.

In OBS:

1. Add a new Browser Source.
2. Set the URL to:

   ```txt
   http://localhost:5173/?mode=obs&source=native
   ```

3. Set the Browser Source width and height.
4. Confirm the preview renders locally.

Keep this check generic and local: exact OBS behavior can vary by OBS version, OS, graphics configuration, and Browser Source settings. Do not mark OBS validation as complete unless it was actually tested locally.

## Recommended Browser Source dimensions

For a full HD scene, start with:

```txt
1920x1080
```

You can choose dimensions that match your OBS canvas or scene layout. If the Browser Source looks cropped, stretched, or too small, adjust the Browser Source width and height in OBS.

## Transparency and background expectations

`mode=obs` is intended to use an OBS-friendly preview layout. In the current Web Preview implementation, this mode is the route intended for Browser Source usage.

Verify the actual background and transparency result locally in OBS before relying on it in a production scene. Do not assume exact transparency behavior unless it has been tested in your local OBS setup.

## Local-first privacy notes

- Point OBS to a `localhost` URL such as `http://localhost:5173/?mode=obs&source=native`.
- Raw camera frames stay local to the native runtime path.
- Native and Web Preview runtime paths are local for LVK v0.1 development.
- MotionFrame transport is local.
- Do not send camera frames to external servers in v0.1.
- Do not add telemetry, analytics, cloud upload, remote camera processing, or external camera frame transmission for this workflow.

## Troubleshooting

### Web Preview is not running

Confirm the Web Preview development server is running:

```bash
pnpm dev:web
```

Then open the preview URL in a normal browser before testing OBS.

### Native source does not animate

Confirm the native pipeline is started from the desktop app after the native tracker has been built. Native animation also requires the local MotionFrame bridge to be running and serving native frames to the Web Preview.

### MotionFrame bridge is not running

If `source=native` loads but does not update, confirm the desktop-managed native pipeline is running. The native preview path depends on local MotionFrame transport between the native process and the Web Preview.

### OBS shows a blank Browser Source

Confirm OBS points to the exact local URL:

```txt
http://localhost:5173/?mode=obs&source=native
```

Also confirm the same URL opens in a normal browser while `pnpm dev:web` is running. If it does not load in a browser, fix the Web Preview or native pipeline first, then retry OBS.

### Browser Source dimensions are wrong

Adjust the Browser Source width and height to match your OBS canvas or scene layout. For a full HD canvas, start with `1920x1080`.

### Webcam permission issues

Webcam/OpenCV validation requires:

- local hardware,
- local OS camera permission for the terminal or app host process,
- a compatible native build, and
- the intended native camera source configuration.

Codex/cloud environments are not expected to validate webcam, Electron GUI, OBS, or native hardware behavior.

### Native pipeline requires local hardware validation

Native dummy paths can be useful for development, but real camera validation requires a local machine with the required hardware and OS permissions. Mark Electron, OBS, webcam, and native hardware checks as manual/local unless they were actually performed on such a machine.
