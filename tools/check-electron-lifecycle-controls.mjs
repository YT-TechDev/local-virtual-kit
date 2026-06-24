#!/usr/bin/env node
// Electron native runtime lifecycle controls smoke checker.
//
// Protects the source-level derivation of canStartNativePipeline,
// canStopNativePipeline, isPipelineBusy, pipelineError clearing, and
// pending message display in the renderer. Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
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

const fail = (message) => {
  console.error(`Electron lifecycle controls smoke check failed: ${message}`);
  process.exit(1);
};

const source = readFileSync(appRendererPath, "utf8");

const requireMatch = (text, pattern, message) => {
  if (!pattern.test(text)) {
    fail(message);
  }
};

requireMatch(
  source,
  /const\s+isPipelineBusy\s*=\s*runtimeStatus\s*\?\s*\['starting',\s*'running',\s*'stopping'\]\.includes\(runtimeStatus\.nativeTrackerStatus\)\s*\|\|\s*\['starting',\s*'running',\s*'stopping'\]\.includes\(runtimeStatus\.motionBridgeStatus\)\s*:\s*false/u,
  "isPipelineBusy must check ['starting','running','stopping'] for both nativeTrackerStatus and motionBridgeStatus",
);

requireMatch(
  source,
  /const\s+isPipelineActionPending\s*=\s*pipelineActionPending\s*!==\s*null/u,
  "isPipelineActionPending must be derived as pipelineActionPending !== null",
);

requireMatch(
  source,
  /const\s+canStartNativePipeline\s*=\s*Boolean\(\s*desktopApi\s*&&\s*runtimeStatus\s*&&\s*!isPipelineBusy\s*&&\s*!isPipelineActionPending\s*\)/u,
  "canStartNativePipeline must require desktopApi && runtimeStatus && !isPipelineBusy && !isPipelineActionPending",
);

requireMatch(
  source,
  /const\s+canStopNativePipeline\s*=\s*runtimeStatus\s*\?\s*!isPipelineActionPending\s*&&\s*\(\['starting',\s*'running'\]\.includes\(runtimeStatus\.nativeTrackerStatus\)\s*\|\|\s*\['starting',\s*'running'\]\.includes\(runtimeStatus\.motionBridgeStatus\)\)\s*:\s*false/u,
  "canStopNativePipeline must require !isPipelineActionPending and nativeTrackerStatus or motionBridgeStatus in ['starting','running']",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{startNativePipeline\}[\s\S]*?disabled=\{!canStartNativePipeline\}/u,
  "Start native pipeline button must bind disabled={!canStartNativePipeline}",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{startNativePipelineAndOpenPreview\}[\s\S]*?disabled=\{!canStartNativePipeline\}/u,
  "Start and open native preview button must bind disabled={!canStartNativePipeline}",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{stopNativePipeline\}[\s\S]*?disabled=\{!canStopNativePipeline\}/u,
  "Stop native pipeline button must bind disabled={!canStopNativePipeline}",
);

requireMatch(
  source,
  /const\s+startNativePipeline\s*=\s*async[\s\S]*?setPipelineError\(null\)\s*\n\s*setPipelineActionPending\('start'\)/u,
  "startNativePipeline must clear pipelineError before setting pipelineActionPending",
);

requireMatch(
  source,
  /const\s+stopNativePipeline\s*=\s*async[\s\S]*?setStopFeedback\(null\)\s*\n\s*setPipelineError\(null\)\s*\n\s*setPipelineActionPending\('stop'\)/u,
  "stopNativePipeline must clear stopFeedback and pipelineError before setting pipelineActionPending",
);

requireMatch(
  source,
  /\{pipelineActionPending\s*\?\s*\(\s*<p\s+className=['"]runtime-message compact['"]\s+role=['"]status['"]>\s*\{pipelineActionPendingMessages\[pipelineActionPending\]\}/u,
  'pending action message must render with className="runtime-message compact" and role="status" while pipelineActionPending is set',
);

requireMatch(
  source,
  /<div\s+className=['"]button-row['"]\s+aria-label=['"]Development native pipeline controls['"]/u,
  'native pipeline button row must keep aria-label="Development native pipeline controls"',
);

requireMatch(
  source,
  /const\s+\[stopFeedback,\s*setStopFeedback\]\s*=\s*useState<StopFeedback\s*\|\s*null>\(null\)/u,
  "stopFeedback state must be declared as useState<StopFeedback | null>(null)",
);

requireMatch(
  source,
  /const\s+currentStopFeedback\s*=\s*\n?\s*stopFeedback\s*!==\s*null\s*&&\s*\n?\s*stopFeedback\.nativeTrackerStatus\s*===\s*runtimeStatus\?\.nativeTrackerStatus\s*\n?\s*\?\s*stopFeedback\.message\s*\n?\s*:\s*null/u,
  "currentStopFeedback must null-check stopFeedback and compare nativeTrackerStatus to runtimeStatus?.nativeTrackerStatus",
);

requireMatch(
  source,
  /\{!pipelineActionPending\s*&&\s*currentStopFeedback\s*\?\s*\(\s*<p\s+className=['"]runtime-message compact['"]\s+role=['"]status['"]>\s*\{currentStopFeedback\}/u,
  'stop feedback must render with className="runtime-message compact" and role="status" only when no action is pending',
);

requireMatch(
  source,
  /const\s+startNativePipeline\s*=\s*async[\s\S]*?setStopFeedback\(null\)/u,
  "startNativePipeline must clear stopFeedback",
);

requireMatch(
  source,
  /const\s+startNativePipelineAndOpenPreview\s*=\s*async[\s\S]*?setStopFeedback\(null\)/u,
  "startNativePipelineAndOpenPreview must clear stopFeedback",
);

requireMatch(
  source,
  /const\s+startNativePipeline\s*=\s*async[\s\S]*?setPreviewOpenFeedback\(null\)/u,
  "startNativePipeline must clear previewOpenFeedback before starting",
);

requireMatch(
  source,
  /setStopFeedback\(\{\s*\n?\s*message:\s*['"]Native runtime stopped\.['"]/u,
  'stopNativePipeline must set stopFeedback with "Native runtime stopped." on success',
);

requireMatch(
  source,
  /setStopFeedback\(\{\s*\n?\s*message:[\s\S]*?nativeTrackerStatus:\s*stoppedStatus\.nativeTrackerStatus/u,
  "stopFeedback must record nativeTrackerStatus from the stopped pipeline status",
);

requireMatch(
  source,
  /const\s+\[startFeedback,\s*setStartFeedback\]\s*=\s*useState<StartFeedback\s*\|\s*null>\(null\)/u,
  "startFeedback state must be declared as useState<StartFeedback | null>(null)",
);

requireMatch(
  source,
  /const\s+currentStartFeedback\s*=\s*\n?\s*startFeedback\s*!==\s*null\s*&&\s*\n?\s*startFeedback\.nativeTrackerStatus\s*===\s*runtimeStatus\?\.nativeTrackerStatus\s*\n?\s*\?\s*startFeedback\.message\s*\n?\s*:\s*null/u,
  "currentStartFeedback must null-check startFeedback and compare nativeTrackerStatus to runtimeStatus?.nativeTrackerStatus",
);

requireMatch(
  source,
  /\{!pipelineActionPending\s*&&\s*currentStartFeedback\s*\?\s*\(\s*<p\s+className=['"]runtime-message compact['"]\s+role=['"]status['"]>\s*\{currentStartFeedback\}/u,
  'start feedback must render with className="runtime-message compact" and role="status" only when no action is pending',
);

requireMatch(
  source,
  /setStartFeedback\(\{\s*\n?\s*message:\s*['"]Native runtime started\.['"]/u,
  'startNativePipeline must set startFeedback with "Native runtime started." on success',
);

requireMatch(
  source,
  /setStartFeedback\(\{\s*\n?\s*message:[\s\S]*?nativeTrackerStatus:\s*startedStatus\.nativeTrackerStatus/u,
  "startFeedback in startNativePipeline must record nativeTrackerStatus from the started pipeline status",
);

requireMatch(
  source,
  /setStartFeedback\(\{\s*\n?\s*message:[\s\S]*?nativeTrackerStatus:\s*status\.nativeTrackerStatus/u,
  "startFeedback in startNativePipelineAndOpenPreview must record nativeTrackerStatus from the started pipeline status",
);

requireMatch(
  source,
  /const\s+stopNativePipeline\s*=\s*async[\s\S]*?setStartFeedback\(null\)/u,
  "stopNativePipeline must clear startFeedback",
);

requireMatch(
  source,
  /const\s+\[previewOpenFeedback,\s*setPreviewOpenFeedback\]\s*=\s*useState<PreviewOpenFeedback\s*\|\s*null>\(null\)/u,
  "previewOpenFeedback state must be declared as useState<PreviewOpenFeedback | null>(null)",
);

requireMatch(
  source,
  /const\s+currentPreviewOpenFeedback\s*=\s*\n?\s*previewOpenFeedback\s*!==\s*null\s*&&\s*\n?\s*previewOpenFeedback\.nativeTrackerStatus\s*===\s*runtimeStatus\?\.nativeTrackerStatus\s*\n?\s*\?\s*previewOpenFeedback\.message\s*\n?\s*:\s*null/u,
  "currentPreviewOpenFeedback must null-check previewOpenFeedback and compare nativeTrackerStatus to runtimeStatus?.nativeTrackerStatus",
);

requireMatch(
  source,
  /\{currentPreviewOpenFeedback\s*\?\s*\(\s*<p\s+className=['"]runtime-message compact['"]\s+role=['"]status['"]>\s*\{currentPreviewOpenFeedback\}/u,
  'preview open feedback must render with className="runtime-message compact" and role="status"',
);

requireMatch(
  source,
  /setPreviewOpenFeedback\(\{\s*\n?\s*message:\s*['"]Native preview opened\.['"]/u,
  'preview open action must set previewOpenFeedback with "Native preview opened." on success',
);

requireMatch(
  source,
  /const\s+startNativePipelineAndOpenPreview\s*=\s*async[\s\S]*?setPreviewOpenFeedback\(null\)/u,
  "startNativePipelineAndOpenPreview must clear previewOpenFeedback",
);

requireMatch(
  source,
  /const\s+stopNativePipeline\s*=\s*async[\s\S]*?setPreviewOpenFeedback\(null\)/u,
  "stopNativePipeline must clear previewOpenFeedback",
);

requireMatch(
  source,
  /const\s+openPreviewUrl\s*=\s*async[\s\S]*?setPreviewOpenFeedback\(null\)/u,
  "openPreviewUrl must clear previewOpenFeedback before setting it",
);

requireMatch(
  source,
  /const\s+\[isPreviewOpenPending,\s*setIsPreviewOpenPending\]\s*=\s*useState\(false\)/u,
  "isPreviewOpenPending state must be declared as useState(false)",
);

requireMatch(
  source,
  /const\s+openPreviewUrl\s*=\s*async[\s\S]*?setIsPreviewOpenPending\(true\)\s*\n\s*\n?\s*try/u,
  "openPreviewUrl must set isPreviewOpenPending(true) before the try block",
);

requireMatch(
  source,
  /const\s+openPreviewUrl\s*=\s*async[\s\S]*?finally\s*\{[\s\S]*?setIsPreviewOpenPending\(false\)/u,
  "openPreviewUrl must clear isPreviewOpenPending(false) in finally",
);

requireMatch(
  source,
  /\{isPreviewOpenPending\s*\?\s*\(\s*<p\s+className=['"]runtime-message compact['"]\s+role=['"]status['"]>\s*Opening native preview\.\.\./u,
  'preview open pending message must render with className="runtime-message compact" and role="status" while isPreviewOpenPending is true',
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{.*?openPreviewUrl\(runtimeStatus\.previewDummyUrl\).*?\}[\s\S]*?disabled=\{isPreviewOpenPending\}/u,
  "Dummy source Open button must bind disabled={isPreviewOpenPending}",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{.*?openPreviewUrl\(runtimeStatus\.previewNativeUrl\).*?\}[\s\S]*?disabled=\{isPreviewOpenPending\}/u,
  "Native source Open button must bind disabled={isPreviewOpenPending}",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{.*?openPreviewUrl\(runtimeStatus\.previewObsNativeUrl\).*?\}[\s\S]*?disabled=\{isPreviewOpenPending\}/u,
  "OBS native source Open button must bind disabled={isPreviewOpenPending}",
);

requireMatch(
  source,
  /\{openError\s*\?\s*\(\s*<p[\s\S]*?role=['"]alert['"][\s\S]*?aria-labelledby=['"]preview-open-error-label['"]/u,
  'openError block must have role="alert" and aria-labelledby="preview-open-error-label"',
);

requireMatch(
  source,
  /<strong\s+id=['"]preview-open-error-label['"]\s+className=['"]status-detail-label['"]\s*>\s*Preview open error/u,
  'openError block must include a visible "Preview open error" label with id="preview-open-error-label" and className="status-detail-label"',
);

requireMatch(
  source,
  /const\s+openPreviewUrl\s*=\s*async[\s\S]*?setOpenError\(null\)/u,
  "openPreviewUrl must clear openError before starting a new attempt so stale errors do not persist on retry",
);

requireMatch(
  source,
  /const\s+startNativePipelineAndOpenPreview\s*=\s*async[\s\S]*?setOpenError\(null\)/u,
  "startNativePipelineAndOpenPreview must clear openError before starting so stale preview open errors do not persist",
);

requireMatch(
  source,
  /const\s+startNativePipeline\s*=\s*async[\s\S]*?setOpenError\(null\)/u,
  "startNativePipeline must clear openError so stale preview open errors do not remain visible when the native runtime starts",
);

requireMatch(
  source,
  /const\s+stopNativePipeline\s*=\s*async[\s\S]*?setOpenError\(null\)/u,
  "stopNativePipeline must clear openError so stale preview open errors do not remain visible when the native runtime stops",
);

requireMatch(
  source,
  /const\s+\[isRuntimeStatusRefreshPending,\s*setIsRuntimeStatusRefreshPending\]\s*=\s*useState\(false\)/u,
  "isRuntimeStatusRefreshPending state must be declared as useState(false)",
);

requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async[\s\S]*?setRuntimeStatusRefreshMessage\(null\)[\s\S]*?setIsRuntimeStatusRefreshPending\(true\)/u,
  "refreshRuntimeStatus must clear runtimeStatusRefreshMessage before setting isRuntimeStatusRefreshPending(true)",
);

requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async[\s\S]*?setRuntimeStatusRefreshMessage\(null\)\s*\n\s*setCopyDiagnosticsMessage\(null\)\s*\n\s*setEndpointCopyFeedback\(null\)\s*\n\s*setIsRuntimeStatusRefreshPending\(true\)/u,
  "refreshRuntimeStatus must clear stale copy diagnostics and endpoint copy feedback before setting isRuntimeStatusRefreshPending(true)",
);

requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async[\s\S]*?setIsRuntimeStatusRefreshPending\(true\)\s*\n\s*\n?\s*try/u,
  "refreshRuntimeStatus must set isRuntimeStatusRefreshPending(true) before the try block",
);

requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async[\s\S]*?finally\s*\{[\s\S]*?setIsRuntimeStatusRefreshPending\(false\)/u,
  "refreshRuntimeStatus must clear isRuntimeStatusRefreshPending(false) in finally",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{refreshRuntimeStatus\}[\s\S]*?disabled=\{isRuntimeStatusRefreshPending\}/u,
  "Refresh status button must bind disabled={isRuntimeStatusRefreshPending}",
);

requireMatch(
  source,
  /\{isRuntimeStatusRefreshPending\s*\?\s*\(\s*<span\s+className=['"]status-refresh-feedback['"]\s+role=['"]status['"]>\s*Refreshing status\.\.\./u,
  'runtime status refresh pending message must render with className="status-refresh-feedback" and role="status" while isRuntimeStatusRefreshPending is true',
);

requireMatch(
  source,
  /const\s+refreshRuntimeStatus\s*=\s*async[\s\S]*?if\s*\(\s*isRuntimeStatusRefreshPending\s*\)\s*\{\s*\n\s*return\s*\n\s*\}/u,
  "refreshRuntimeStatus must return early when isRuntimeStatusRefreshPending is already true",
);

requireMatch(
  source,
  /<button[\s\S]*?onClick=\{copyNativeRuntimeDiagnostics\}[\s\S]*?disabled=\{isRuntimeStatusRefreshPending\}/u,
  "Copy diagnostics button must bind disabled={isRuntimeStatusRefreshPending}",
);

requireMatch(
  source,
  /const\s+copyNativeRuntimeDiagnostics\s*=\s*async[\s\S]*?if\s*\(\s*isRuntimeStatusRefreshPending\s*\)\s*\{\s*\n\s*return\s*\n\s*\}/u,
  "copyNativeRuntimeDiagnostics must return early when isRuntimeStatusRefreshPending is true",
);

console.log(
  "Electron lifecycle controls smoke OK: isPipelineBusy checks starting/running/stopping on both " +
    "tracker and bridge; isPipelineActionPending derives from pipelineActionPending !== null; " +
    "canStartNativePipeline requires desktopApi, runtimeStatus, and both busy/pending guards; " +
    "canStopNativePipeline requires !isPipelineActionPending and active tracker or bridge; " +
    "start buttons bind disabled={!canStartNativePipeline}; stop button binds disabled={!canStopNativePipeline}; " +
    "startNativePipeline and stopNativePipeline clear pipelineError before setting pipelineActionPending; " +
    "pending message keeps role=status semantics; button row keeps aria-label; " +
    "stopFeedback state declared; currentStopFeedback staleness-guards on nativeTrackerStatus; " +
    "stop feedback renders with role=status only when no action is pending; " +
    "start actions clear stopFeedback; stopNativePipeline sets stopFeedback with nativeTrackerStatus on success; " +
    "startFeedback state declared; currentStartFeedback staleness-guards on nativeTrackerStatus; " +
    "start feedback renders with role=status only when no action is pending; " +
    "stopNativePipeline clears startFeedback; startNativePipeline and startNativePipelineAndOpenPreview set startFeedback with nativeTrackerStatus on success; " +
    "previewOpenFeedback state declared; currentPreviewOpenFeedback staleness-guards on nativeTrackerStatus; " +
    "preview open feedback renders with role=status; preview open actions set previewOpenFeedback with nativeTrackerStatus on success; " +
    "startNativePipeline clears previewOpenFeedback before starting; " +
    "startNativePipelineAndOpenPreview and stopNativePipeline clear previewOpenFeedback; " +
    "openPreviewUrl clears previewOpenFeedback before setting it; " +
    "isPreviewOpenPending state declared; openPreviewUrl sets isPreviewOpenPending before openExternalUrl and clears in finally; " +
    "preview open pending message renders with role=status while pending; " +
    "all three preview open buttons bind disabled={isPreviewOpenPending}; " +
    "openError block has role=alert, aria-labelledby=preview-open-error-label, and visible Preview open error label; " +
    "openPreviewUrl clears openError before each attempt so stale errors do not persist on retry or after success; " +
    "startNativePipelineAndOpenPreview clears openError before starting; " +
    "startNativePipeline clears openError so stale preview open errors do not remain visible when the native runtime starts; " +
    "stopNativePipeline clears openError so stale preview open errors do not remain visible when the native runtime stops; " +
    "isRuntimeStatusRefreshPending state declared; refreshRuntimeStatus clears runtimeStatusRefreshMessage, copy diagnostics feedback, and endpoint copy feedback before setting pending; " +
    "refreshRuntimeStatus sets isRuntimeStatusRefreshPending(true) before try and clears in finally; " +
    "Refresh status button binds disabled={isRuntimeStatusRefreshPending}; " +
    "runtime status refresh pending message renders with role=status while pending; " +
    "refreshRuntimeStatus returns early when isRuntimeStatusRefreshPending is already true; " +
    "Copy diagnostics button binds disabled={isRuntimeStatusRefreshPending}; " +
    "copyNativeRuntimeDiagnostics returns early when isRuntimeStatusRefreshPending is true.",
);
