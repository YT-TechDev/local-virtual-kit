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
  /setStopFeedback\(\{\s*\n?\s*message:\s*['"]Native runtime stopped\.['"]/u,
  'stopNativePipeline must set stopFeedback with "Native runtime stopped." on success',
);

requireMatch(
  source,
  /setStopFeedback\(\{\s*\n?\s*message:[\s\S]*?nativeTrackerStatus:\s*stoppedStatus\.nativeTrackerStatus/u,
  "stopFeedback must record nativeTrackerStatus from the stopped pipeline status",
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
    "start actions clear stopFeedback; stopNativePipeline sets stopFeedback with nativeTrackerStatus on success.",
);
