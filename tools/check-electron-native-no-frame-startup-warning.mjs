#!/usr/bin/env node
// Electron/Desktop native pipeline no-frame startup warning checker.
//
// Covers:
//   A. Preload API contract — NativePipelineStartupWarning type, startupWarning
//      field on LvkRuntimeStatus.
//   B. Bridge publish contract — publishMotionFrameLine reports whether a frame
//      was actually published so the pipeline manager can detect the first frame.
//   C. NativePipelineManager arming — startup timer armed after tracker spawn,
//      bounded by an explicit timeout constant, distinct from spawn/bridge/exit
//      error paths.
//   D. Clearing on first valid frame — publishMotionFrameLine result gates a
//      handler that clears the timer and warning.
//   E. Cleanup coverage — timer cleared on stop, cleanup-on-quit, tracker exit,
//      tracker spawn error, and bridge server error.
//   F. Renderer UI — a sanitized warning is rendered from runtimeStatus.startupWarning
//      without exposing raw stdout/stderr/paths.
//
// Source-level only. No Electron, no child_process spawn, no transpilation.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const preloadApiPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "preload",
  "api.ts",
);
const nativePipelinePath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "nativePipeline.ts",
);
const motionBridgeServerPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "motionBridgeServer.ts",
);
const appTsxPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "App.tsx",
);

const fail = (message) => {
  console.error(
    `Electron native no-frame startup warning check failed: ${message}`,
  );
  process.exit(1);
};

const preloadSrc = readFileSync(preloadApiPath, "utf8");
const pipelineSrc = readFileSync(nativePipelinePath, "utf8");
const bridgeSrc = readFileSync(motionBridgeServerPath, "utf8");
const appSrc = readFileSync(appTsxPath, "utf8");

const requireMatch = (src, pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

const requireNoMatch = (src, pattern, message) => {
  if (pattern.test(src)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// A. Preload API contract
// ---------------------------------------------------------------------------

requireMatch(
  preloadSrc,
  /export\s+type\s+NativePipelineStartupWarning\s*=\s*['"]none['"]\s*\|\s*['"]no_frame_timeout['"]/u,
  "preload/api.ts must export type NativePipelineStartupWarning = 'none' | 'no_frame_timeout'",
);

requireMatch(
  preloadSrc,
  /startupWarning:\s*NativePipelineStartupWarning/u,
  "LvkRuntimeStatus must include startupWarning: NativePipelineStartupWarning",
);

// ---------------------------------------------------------------------------
// B. Bridge publish contract
// ---------------------------------------------------------------------------

requireMatch(
  bridgeSrc,
  /export\s+function\s+publishMotionFrameLine\s*\(\s*line:\s*string\s*\):\s*boolean/u,
  "motionBridgeServer.ts publishMotionFrameLine must return boolean",
);

requireMatch(
  bridgeSrc,
  /publishMotionFrameLine[\s\S]*?return\s+false/u,
  "publishMotionFrameLine must return false when a line is not a new valid frame",
);

requireMatch(
  bridgeSrc,
  /publishMotionFrameLine[\s\S]*?return\s+true/u,
  "publishMotionFrameLine must return true when a new valid frame is broadcast",
);

// ---------------------------------------------------------------------------
// C. NativePipelineManager arming
// ---------------------------------------------------------------------------

requireMatch(
  pipelineSrc,
  /const\s+NO_FRAME_STARTUP_TIMEOUT_MS\s*=\s*\d/u,
  "nativePipeline.ts must define a bounded NO_FRAME_STARTUP_TIMEOUT_MS constant",
);

requireMatch(
  pipelineSrc,
  /private\s+noFrameStartupTimer:\s*NodeJS\.Timeout\s*\|\s*null\s*=\s*null/u,
  "NativePipelineManager must track a private noFrameStartupTimer field",
);

requireMatch(
  pipelineSrc,
  /private\s+hasReceivedMotionFrameSinceStart\s*=\s*false/u,
  "NativePipelineManager must track whether a valid MotionFrame was received for the current start attempt",
);

requireMatch(
  pipelineSrc,
  /private\s+armNoFrameStartupTimer\s*\(\s*\):\s*void/u,
  "NativePipelineManager must define armNoFrameStartupTimer(): void",
);

// The timer must be armed after the readline/publish wiring, not before spawn.
const armAfterPublish = pipelineSrc.match(
  /publishMotionFrameLine\s*\(\s*line\s*\)[\s\S]{0,300}?this\.armNoFrameStartupTimer\s*\(\s*\)/u,
);
if (!armAfterPublish) {
  fail(
    "start() must call this.armNoFrameStartupTimer() after wiring publishMotionFrameLine(line) on the readline interface",
  );
}

requireMatch(
  pipelineSrc,
  /armNoFrameStartupTimer[\s\S]{0,1200}?setTimeout\s*\([\s\S]{0,1000}?,\s*NO_FRAME_STARTUP_TIMEOUT_MS\s*\)/u,
  "armNoFrameStartupTimer must schedule its callback using NO_FRAME_STARTUP_TIMEOUT_MS",
);

// The timeout callback must not fire the warning if a frame already arrived,
// if stopping, or if the tracker is no longer in an active status.
requireMatch(
  pipelineSrc,
  /armNoFrameStartupTimer[\s\S]{0,800}?hasReceivedMotionFrameSinceStart\s*\|\|\s*this\.isStopping[\s\S]{0,200}?return/u,
  "the no-frame startup timer callback must bail out when a frame already arrived or a stop is in progress",
);

requireMatch(
  pipelineSrc,
  /armNoFrameStartupTimer[\s\S]{0,900}?isActiveStatus\s*\(\s*this\.status\.nativeTrackerStatus\s*\)/u,
  "the no-frame startup timer callback must check isActiveStatus(this.status.nativeTrackerStatus) before warning",
);

requireMatch(
  pipelineSrc,
  /startupWarning:\s*['"]no_frame_timeout['"]/u,
  "the no-frame startup timer callback must set startupWarning: 'no_frame_timeout'",
);

// ---------------------------------------------------------------------------
// D. Clearing on first valid frame
// ---------------------------------------------------------------------------

requireMatch(
  pipelineSrc,
  /if\s*\(\s*publishMotionFrameLine\s*\(\s*line\s*\)\s*\)\s*\{[\s\S]{0,120}?this\.handleValidMotionFrameReceived\s*\(\s*\)/u,
  "start() must call this.handleValidMotionFrameReceived() only when publishMotionFrameLine(line) returns true",
);

requireMatch(
  pipelineSrc,
  /private\s+handleValidMotionFrameReceived\s*\(\s*\):\s*void/u,
  "NativePipelineManager must define handleValidMotionFrameReceived(): void",
);

requireMatch(
  pipelineSrc,
  /handleValidMotionFrameReceived[\s\S]{0,300}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "handleValidMotionFrameReceived must clear the no-frame startup timer",
);

requireMatch(
  pipelineSrc,
  /handleValidMotionFrameReceived[\s\S]{0,400}?startupWarning:\s*['"]none['"]/u,
  "handleValidMotionFrameReceived must clear startupWarning back to 'none'",
);

// ---------------------------------------------------------------------------
// E. Cleanup coverage
// ---------------------------------------------------------------------------

requireMatch(
  pipelineSrc,
  /private\s+clearNoFrameStartupTimer\s*\(\s*\):\s*void/u,
  "NativePipelineManager must define clearNoFrameStartupTimer(): void",
);

requireMatch(
  pipelineSrc,
  /async\s+stop\s*\(\s*\)[\s\S]{0,300}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "stop() must call this.clearNoFrameStartupTimer()",
);

requireMatch(
  pipelineSrc,
  /cleanupOnQuit\s*\(\s*\):\s*void\s*\{[\s\S]{0,200}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "cleanupOnQuit() must call this.clearNoFrameStartupTimer()",
);

requireMatch(
  pipelineSrc,
  /childProcess\.once\s*\(\s*['"]error['"][\s\S]{0,200}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "the tracker spawn error handler must call this.clearNoFrameStartupTimer()",
);

requireMatch(
  pipelineSrc,
  /childProcess\.once\s*\(\s*['"]exit['"][\s\S]{0,300}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "the tracker exit handler must call this.clearNoFrameStartupTimer()",
);

requireMatch(
  pipelineSrc,
  /startMotionBridgeServer\s*\(\s*\(\s*error\s*\)\s*=>\s*\{[\s\S]{0,200}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "the in-process bridge server error callback must call this.clearNoFrameStartupTimer()",
);

// The catch-all start() failure path must also clear the timer before stopping.
requireMatch(
  pipelineSrc,
  /catch\s*\(\s*error\s*\)\s*\{[\s\S]{0,200}?this\.clearNoFrameStartupTimer\s*\(\s*\)/u,
  "start() catch block must call this.clearNoFrameStartupTimer() before stopping",
);

// ---------------------------------------------------------------------------
// F. Renderer UI
// ---------------------------------------------------------------------------

requireMatch(
  appSrc,
  /runtimeStatus\.startupWarning\s*===\s*['"]no_frame_timeout['"]/u,
  "App.tsx must render a warning when runtimeStatus.startupWarning === 'no_frame_timeout'",
);

requireMatch(
  appSrc,
  /No-frame startup warning/u,
  "App.tsx must include a 'No-frame startup warning' label",
);

requireNoMatch(
  appSrc,
  /startupWarning[\s\S]{0,400}\b(stdout|stderr|executablePath|binaryPath|commandDump|screenshots?|rawFrames?)\b/iu,
  "the no-frame startup warning UI must not expose raw stdout/stderr/paths/command dumps/screenshots/raw frames",
);

console.log(
  "Electron native no-frame startup warning check OK:\n" +
    "  A. Preload API — NativePipelineStartupWarning type and startupWarning field present.\n" +
    "  B. Bridge publish contract — publishMotionFrameLine returns boolean for new valid frames.\n" +
    "  C. Arming — timer armed after readline/publish wiring, bounded by NO_FRAME_STARTUP_TIMEOUT_MS, " +
    "guarded by hasReceivedMotionFrameSinceStart/isStopping/isActiveStatus before warning.\n" +
    "  D. Clearing — first valid frame clears the timer and resets startupWarning to 'none'.\n" +
    "  E. Cleanup coverage — timer cleared on stop, cleanup-on-quit, tracker exit, tracker spawn " +
    "error, bridge server error, and the start() catch-all failure path.\n" +
    "  F. Renderer UI — sanitized warning rendered from runtimeStatus.startupWarning with no raw " +
    "stdout/stderr/path/command dump/screenshot/raw frame exposure.",
);
