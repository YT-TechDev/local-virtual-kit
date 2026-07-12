#!/usr/bin/env node
// Electron/Desktop OBS Browser Source setup actions source checker.
//
// Protects the dedicated OBS Browser Source setup workflow in the Desktop
// renderer: a distinct section with dummy/native panels, Copy/Open actions per
// URL, source/action/URL-keyed pending and feedback state, native-runtime
// staleness guards, accessible status/alert semantics, recommended dimensions,
// localhost-only privacy guidance, and responsive layout coverage.
//
// Source-level only. No Electron, no OBS, no transpilation.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const appRendererPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "App.tsx",
);
const cssPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "assets",
  "main.css",
);

const fail = (message) => {
  console.error(`Electron OBS setup actions check failed: ${message}`);
  process.exit(1);
};

const source = readFileSync(appRendererPath, "utf8");
const css = readFileSync(cssPath, "utf8");

const requireMatch = (src, pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

// 1. A dedicated OBS Browser Source section exists.
requireMatch(
  source,
  /className="card card--wide obs-setup-card"/u,
  "a dedicated OBS Browser Source section must use className 'card card--wide obs-setup-card'",
);

// 2. Stable accessible heading relationship.
requireMatch(
  source,
  /aria-labelledby="obs-browser-source-heading"/u,
  'the OBS section must set aria-labelledby="obs-browser-source-heading"',
);
requireMatch(
  source,
  /<h2\s+id="obs-browser-source-heading">\s*OBS Browser Source\s*<\/h2>/u,
  'the OBS section must have an <h2 id="obs-browser-source-heading">OBS Browser Source</h2> heading',
);

// 3. Both runtime URLs are used.
requireMatch(
  source,
  /runtimeStatus\.previewObsDummyUrl/u,
  "the OBS section must use runtimeStatus.previewObsDummyUrl",
);
requireMatch(
  source,
  /runtimeStatus\.previewObsNativeUrl/u,
  "the OBS section must use runtimeStatus.previewObsNativeUrl",
);

// 4. Both Copy actions exist.
requireMatch(
  source,
  /copyObsPreviewUrl\('dummy',/u,
  "a Copy action must call copyObsPreviewUrl('dummy', ...)",
);
requireMatch(
  source,
  /copyObsPreviewUrl\('native',/u,
  "a Copy action must call copyObsPreviewUrl('native', ...)",
);

// 5. Both Open actions exist.
requireMatch(
  source,
  /openObsPreviewUrl\('dummy',/u,
  "an Open action must call openObsPreviewUrl('dummy', ...)",
);
requireMatch(
  source,
  /openObsPreviewUrl\('native',/u,
  "an Open action must call openObsPreviewUrl('native', ...)",
);

// 6. Open actions use desktopApi.openExternalUrl through the existing safe API.
requireMatch(
  source,
  /const\s+openObsPreviewUrl\s*=\s*async[\s\S]*?desktopApi\.openExternalUrl\(url\)/u,
  "openObsPreviewUrl must call desktopApi.openExternalUrl(url)",
);

// 7. Copy actions use navigator.clipboard.writeText.
requireMatch(
  source,
  /const\s+copyObsPreviewUrl\s*=\s*async[\s\S]*?navigator\.clipboard\.writeText\(url\)/u,
  "copyObsPreviewUrl must call navigator.clipboard.writeText(url)",
);

// 8. Buttons have source-specific accessible names.
for (const label of [
  "Copy OBS dummy Browser Source URL",
  "Open OBS dummy Browser Source preview",
  "Copy OBS native Browser Source URL",
  "Open OBS native Browser Source preview",
]) {
  requireMatch(
    source,
    new RegExp(`aria-label="${label}"`, "u"),
    `an OBS button must expose the accessible name "${label}"`,
  );
}

// 9. Pending state is keyed by source and action.
requireMatch(
  source,
  /type\s+ObsPreviewActionContext\s*=\s*\{\s*source:\s*ObsPreviewSource\s*action:\s*ObsPreviewAction\s*url:\s*string\s*\}/u,
  "ObsPreviewActionContext must carry source, action, and url",
);
requireMatch(
  source,
  /const\s+\[obsActionPending,\s*setObsActionPending\]\s*=\s*useState<ObsPreviewActionPending>\(null\)/u,
  "obsActionPending state must be declared as useState<ObsPreviewActionPending>(null)",
);
requireMatch(
  source,
  /setObsActionPending\(\{\s*source,\s*action:\s*'copy',\s*url\s*\}\)/u,
  "copyObsPreviewUrl must set pending keyed by source and action ('copy')",
);
requireMatch(
  source,
  /setObsActionPending\(\{\s*source,\s*action:\s*'open',\s*url\s*\}\)/u,
  "openObsPreviewUrl must set pending keyed by source and action ('open')",
);

// 10. Feedback is keyed by source, action, and URL.
requireMatch(
  source,
  /const\s+\[obsActionFeedback,\s*setObsActionFeedback\]\s*=\s*useState<ObsPreviewActionFeedback\s*\|\s*null>\(null\)/u,
  "obsActionFeedback state must be declared as useState<ObsPreviewActionFeedback | null>(null)",
);
requireMatch(
  source,
  /feedback\.source\s*!==\s*source\s*\|\|\s*feedback\.url\s*!==\s*url/u,
  "resolveObsSourceFeedback must discard feedback whose source or url no longer matches",
);

// 11. Native feedback is guarded against relevant runtime-status changes.
requireMatch(
  source,
  /source\s*===\s*'native'\s*&&\s*\(\s*feedback\.nativeTrackerStatus\s*!==\s*status\.nativeTrackerStatus\s*\|\|\s*feedback\.motionBridgeStatus\s*!==\s*status\.motionBridgeStatus\s*\)/u,
  "native OBS feedback must become stale when nativeTrackerStatus or motionBridgeStatus changes",
);

// 12. Pending/success output uses role="status".
requireMatch(
  source,
  /<p\s+className="obs-action-feedback"\s+role="status">\s*\{buildObsPendingMessage\(/u,
  'OBS pending message must render with className="obs-action-feedback" and role="status"',
);

// 13. Failure output uses role="alert" (and success stays role="status").
requireMatch(
  source,
  /role=\{[A-Za-z]+Feedback\.tone\s*===\s*'danger'\s*\?\s*'alert'\s*:\s*'status'\}/u,
  "OBS feedback must use role='alert' for danger tone and role='status' otherwise",
);

// 14. Recommended dimensions are visible.
requireMatch(
  source,
  /1920 × 1080/u,
  "the OBS section must display the recommended 1920 × 1080 starting size",
);

// 15. localhost-only and camera-frames-remain-local guidance exists.
requireMatch(
  source,
  /localhost-only/u,
  "the OBS section must state that both URLs are localhost-only",
);
requireMatch(
  source,
  /Camera frames remain local/u,
  "the OBS section must state that camera frames remain local",
);

// 16. The dedicated OBS layout has responsive CSS coverage.
requireMatch(
  css,
  /\.obs-source-panel\s*\{/u,
  "main.css must style the dedicated .obs-source-panel layout",
);
requireMatch(
  css,
  /@media\s*\(max-width:\s*860px\)\s*\{[\s\S]*?\.obs-setup-grid\s*\{\s*grid-template-columns:\s*1fr/u,
  "main.css must stack .obs-setup-grid into one column under the 860px breakpoint",
);

console.log(
  "Electron OBS setup actions OK: dedicated OBS Browser Source section with " +
    "obs-browser-source-heading relationship; dummy and native panels use " +
    "previewObsDummyUrl and previewObsNativeUrl; Copy actions use " +
    "navigator.clipboard.writeText and Open actions use desktopApi.openExternalUrl; " +
    "source-specific accessible button names; pending state keyed by source+action; " +
    "feedback keyed by source+action+url with source/url staleness and native " +
    "tracker/bridge staleness guards; pending/success use role=status and failure " +
    "uses role=alert; recommended 1920 × 1080 size shown; localhost-only and " +
    "camera-frames-remain-local guidance present; responsive obs-setup-grid stacking.",
);
