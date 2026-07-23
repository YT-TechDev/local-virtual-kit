# OBS Browser Source Setup Guide

This guide explains how to add the LVK Web Preview to OBS as a Browser Source for the local LVK v0.1 development/runtime workflow, including the approved local GLB avatar workspace setup flow.

It focuses only on the Browser Source workflow. For broader system boundaries, package ownership, and local runtime checks, see `docs/ARCHITECTURE.md`, `docs/TECH_STACK.md`, and `docs/LOCAL_RUNTIME_CHECKLIST.md`.

## Purpose

Use this guide when you want OBS to render the LVK Web Preview from a local development server.

LVK v0.1 is local-first:

- OBS should point to a `localhost` Web Preview URL.
- Raw camera frames must stay on the local machine.
- Native tracker, Web Preview, and MotionFrame transport runtime paths are local.
- The local GLB avatar workspace (file, scale, vertical offset, yaw) is stored only in the browser profile's own IndexedDB. It is never uploaded, transferred, or served by Electron.
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

## The normal browser profile and the OBS browser profile are different storage contexts

Web Preview stores the local GLB avatar workspace in the browser profile's own IndexedDB, keyed to the exact origin (`http://localhost:5173`). A browser profile is not just an application window — it is a distinct storage context.

This has one important consequence:

- **A GLB workspace saved while browsing in your normal, everyday Chrome/Edge/Firefox profile is not available to OBS.** OBS's Browser Source uses its own embedded browser profile (Chromium Embedded Framework, or CEF), which has its own separate IndexedDB, even when it loads the exact same `localhost` origin.
- Setting up or updating the avatar workspace must happen **inside the OBS Browser Source's own profile**, through OBS's built-in **Interact** feature (which lets you click, type, and use file pickers inside that Browser Source as if it were a normal page).
- This is **not** a transfer or synchronization between browser profiles. Nothing is copied from your normal browser to OBS. Standard Preview (interactive) and `mode=obs` (restore-only) simply run in the _same_ OBS profile and read/write the _same_ IndexedDB record there.

## Canonical URLs

Only one production workflow is supported. The `source=dummy` equivalents of these URLs are test variants for renderer-only checks, not a separate production workflow.

| Purpose                                                   | Exact URL                                       |
| --------------------------------------------------------- | ----------------------------------------------- |
| Setup or update the avatar inside the OBS browser profile | `http://localhost:5173/?source=native`          |
| Final OBS rendering                                       | `http://localhost:5173/?mode=obs&source=native` |

Use `localhost` consistently for both URLs. Do not substitute `127.0.0.1` — changing the literal origin string selects a different browser storage context, so a workspace saved under `localhost` will not appear under `127.0.0.1`, and vice versa.

When pasting a URL into the OBS Browser Source URL field, paste **only the URL value itself**. Do not include a `URL:` prefix, surrounding quotes, extra prose, or leading/trailing whitespace — any of these will change the requested address and can prevent the page from loading or from matching the expected storage origin.

## Setup or update the avatar workspace (same Browser Source, temporary URL swap)

Use this procedure the first time you want a custom GLB avatar in OBS, and again any time you want to change the GLB, scale, vertical offset, or yaw.

1. Start the Web Preview development server if it is not already running:

   ```bash
   pnpm dev:web
   ```

2. In OBS, create the Browser Source (or use your existing one) with the final URL:

   ```txt
   http://localhost:5173/?mode=obs&source=native
   ```

   Before any workspace exists, this route renders the built-in primitive avatar. That is expected and confirms the source is reachable.

3. Temporarily change that **same** Browser Source's URL to the setup URL:

   ```txt
   http://localhost:5173/?source=native
   ```

4. Right-click the Browser Source in OBS and choose **Interact**. This opens an interactive window into the Browser Source's own profile.

5. Inside Interact, select one compatible, non-sensitive local `.glb` file through the file picker, then set the uniform scale, vertical offset, and yaw controls to the values you want. Record the three numeric values somewhere so you can check them later if needed.

6. Wait for both exact persistence messages to appear before continuing:

   ```text
   Saved in browser-local storage
   Framing saved · OBS may need a refresh or reopen to update.
   ```

7. Close the Interact window.

8. Restore the Browser Source's URL to the exact final URL:

   ```txt
   http://localhost:5173/?mode=obs&source=native
   ```

9. Observe the render. The restore is expected to appear immediately, with **no initial refresh required** — the URL switch itself reloads the page inside the same profile and restores the just-saved workspace.

## If the final render looks stale

The first observation after switching back to the final URL should require no refresh. If the renderer still looks stale (for example, after leaving OBS idle, or after other OBS activity):

- Use **one** explicit Browser Source refresh (right-click → **Refresh**), or
- Reopen/recreate the source so the page genuinely reloads.

This is the only documented recovery action. It should not require reselecting the GLB or re-entering framing values unless the stored workspace itself is actually missing, or the numeric framing checkpoint (see below) has changed from what you set.

Do not describe toggling the Browser Source's visibility "eye" icon as equivalent to this refresh/reopen recovery. Visibility toggling only shows/hides the existing rendered source — unless the specific OBS action you used is confirmed to actually destroy and recreate the Browser Source page, do not classify it as a page reload.

## Final output expectations

Once a workspace exists and the Browser Source points at the final URL, the render is expected to show:

- the restored GLB, at the restored scale/vertical offset/yaw;
- no management controls (file picker, sliders, buttons) — the final route is restore-only and control-free;
- a transparent background;
- a full-viewport render, filling the Browser Source dimensions;
- native/dummy MotionFrame source selection (`source=native` vs `source=dummy`) stays independent of the avatar workspace — switching source does not affect the stored GLB/framing.

## Source recreation and the framing checkpoint

If you remove and recreate the Browser Source (rather than just editing its URL), treat the framing values as a bounded checkpoint to verify, not something known to be safe:

1. Recreate the source using the exact final URL: `http://localhost:5173/?mode=obs&source=native`.
2. Temporarily switch that source to the setup URL (`http://localhost:5173/?source=native`) and open Interact.
3. Inspect the three numeric framing values (scale, vertical offset, yaw) shown in Standard Preview.
4. If they match what you last set, no action is needed — return to the final URL.
5. If they have reset to defaults (`1.00× / 0.00 / 0°`), re-enter your intended values through Standard Preview, wait for the `Framing saved · OBS may need a refresh or reopen to update.` message, then return to the final URL.

A prior investigation (#609) observed this exact reset (GLB bytes retained, framing read back at defaults) around source removal/recreation on one machine. **The exact mutation point and root cause were not established**, and this guide does not claim source removal/recreation is the cause. Treat the numeric checkpoint above as the bounded, supported recovery step. If you can reliably reproduce a framing reset, report it as a separate, bounded bug with exact reproduction steps rather than treating it as expected behavior of this workflow.

## Clear local avatar and primitive fallback

To clear the avatar workspace used by OBS, temporarily open the setup URL (`http://localhost:5173/?source=native`) in that same OBS Browser Source and use **Clear local avatar** through OBS Interact. Clearing a workspace in a normal browser affects only that normal browser profile and does not clear the OBS Browser Source workspace.

After clearing the workspace from the same OBS Browser Source through Interact:

- the file selector shows no file selected;
- the workspace is no longer stored in that OBS browser profile;
- returning the same Browser Source to the final `mode=obs` route renders the built-in primitive avatar;
- the final output remains control-free, transparent, and full viewport, exactly as with a GLB workspace.

## Troubleshooting

### `localhost` vs `127.0.0.1`

Symptom: a workspace set up successfully still does not appear, or the setup flow behaves as if starting from empty every time.

Check that **both** the setup URL and the final URL use `localhost`, not `127.0.0.1`. These are different origins with different storage, even though they both reach the same local dev server. Fix any mismatch and retry.

### Accidental `URL:` prefix or surrounding text

Symptom: OBS shows a blank page, an error page, or a page that does not match the expected route.

Re-check the exact string in the Browser Source URL field. Paste only the bare URL (for example `http://localhost:5173/?mode=obs&source=native`), with no leading `URL:` label, no surrounding quotes, and no extra whitespace or line breaks.

### Setup performed in a normal browser instead of through OBS Interact

Symptom: a GLB was selected and framed successfully in a normal desktop browser, both persistence messages appeared, but the final OBS route still shows the built-in primitive.

This is expected: the normal browser profile's IndexedDB is separate from the OBS Browser Source profile's IndexedDB. A normal browser may be used only to confirm the page itself loads and responds (a reachability check) — it does not seed the OBS profile. Redo the setup steps using OBS Interact on the actual Browser Source.

### Unsupported GLB vs. a missing workspace

Symptom: the final route shows the built-in primitive instead of a GLB.

Distinguish two cases:

- **No workspace was ever saved, or it was cleared** — this is expected primitive fallback. Redo the setup flow above.
- **A GLB was selected but rejected or failed to persist** — check Standard Preview's status text (shown while using Interact) for a specific error (for example, an unsupported file type, an oversized file, or a save failure). Select a different, compatible, non-sensitive local `.glb` file and repeat setup.

### Stale render vs. actually missing/reset state

If the final route does not show the expected result:

1. First try the single documented refresh/reopen recovery (see above).
2. If that does not resolve it, check the numeric framing checkpoint through Standard Preview via Interact (see "Source recreation and the framing checkpoint").
3. Only reselect the GLB if Standard Preview itself shows no file selected (that is, the workspace is genuinely missing), not merely because the OBS render looked stale.

### Web Preview is not running

Confirm the Web Preview development server is running:

```bash
pnpm dev:web
```

A normal browser may be used to confirm the exact URL loads and responds before relying on OBS — this is a page/server reachability check only. It does not seed or verify the OBS browser profile's own workspace storage.

### Native source does not animate

Confirm the native pipeline is started from the desktop app after the native tracker has been built. Native animation also requires the local MotionFrame bridge to be running and serving native frames to the Web Preview.

### MotionFrame bridge is not running

If `source=native` loads but does not update, confirm the desktop-managed native pipeline is running. The native preview path depends on local MotionFrame transport between the native process and the Web Preview.

### OBS shows a blank Browser Source

Confirm OBS points to the exact local URL:

```txt
http://localhost:5173/?mode=obs&source=native
```

Also confirm the same URL loads in a normal browser while `pnpm dev:web` is running, as a reachability check. If it does not load in a browser, fix the Web Preview or native pipeline first, then retry OBS.

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

## Recommended Browser Source dimensions

For a full HD scene, start with:

```txt
1920x1080
```

You can choose dimensions that match your OBS canvas or scene layout. If the Browser Source looks cropped, stretched, or too small, adjust the Browser Source width and height in OBS.

## Transparency and background expectations

`mode=obs` is intended to use an OBS-friendly preview layout. In the current Web Preview implementation, this mode is the route intended for Browser Source usage, and it is control-free, transparent, and full viewport by contract.

Verify the actual background and transparency result locally in OBS before relying on it in a production scene. Do not assume exact transparency behavior unless it has been tested in your local OBS setup.

## Local-first privacy notes

- Point OBS to a `localhost` URL such as `http://localhost:5173/?mode=obs&source=native`.
- Raw camera frames stay local to the native runtime path.
- The local GLB avatar workspace (file bytes, scale, vertical offset, yaw) stays inside the OBS Browser Source's own browser-profile IndexedDB.
- Native and Web Preview runtime paths are local for LVK v0.1 development.
- MotionFrame transport is local.
- Do not send camera frames or avatar workspace data to external servers in v0.1.
- Do not add telemetry, analytics, cloud upload, remote camera processing, or external camera frame transmission for this workflow.
- Do not publish a GLB file path, GLB bytes, OBS profile path, IndexedDB contents, or screenshots of private local state.

## Known limitations

- This workflow has been validated on the owner's supported Windows development machine with one OBS version at one point in time (see #609). It is not claimed to be proven across other machines, OBS versions, browser/CEF versions, graphics stacks, or arbitrary GLB files.
- The source-recreation framing observation described above remains a bounded, unexplained observation, not a confirmed defect with a known cause.
