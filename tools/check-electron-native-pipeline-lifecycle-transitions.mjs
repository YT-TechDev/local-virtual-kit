#!/usr/bin/env node
// Electron/Desktop NativePipelineManager lifecycle transition checker.
//
// Covers:
//   A. Active-status guard — isActiveStatus set and start() early-return contract.
//   B. Start preflight error transitions — missing tracker, opencv without cascade.
//   C. Successful start transition — isStopping reset, starting status, bridge start,
//      tracker spawn, readline setup, publishMotionFrameLine, running status.
//   D. Stop transition — early-return guard, isStopping set, stopping status,
//      readline close, bridge stop, tracker termination, null ref, exited status,
//      isStopping reset.
//   E. Cleanup-on-quit — isStopping set, readline close, kill, null ref, bridge stop.
//   F. Unexpected exit/error transitions — tracker error, tracker unexpected exit,
//      in-process bridge server error, stdout not logged directly.
//   G. Termination hardening — settle helper, SIGTERM/SIGKILL, killProcess guard.
//
// Source-level only. No Electron, no child_process spawn, no transpilation.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const nativePipelinePath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "nativePipeline.ts",
);

const fail = (message) => {
  console.error(
    `Electron native pipeline lifecycle transitions check failed: ${message}`,
  );
  process.exit(1);
};

const src = readFileSync(nativePipelinePath, "utf8");

const requireMatch = (pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// A. Active-status guard
// ---------------------------------------------------------------------------

requireMatch(
  /function\s+isActiveStatus\s*\(\s*status:/u,
  "nativePipeline.ts must define isActiveStatus function",
);

requireMatch(
  /status\s*===\s*['"]starting['"]\s*\|\|\s*status\s*===\s*['"]running['"]\s*\|\|\s*status\s*===\s*['"]stopping['"]/u,
  "isActiveStatus must return true only for 'starting', 'running', and 'stopping'",
);

// start() returns current status when either tracker or bridge is active
requireMatch(
  /isActiveStatus\s*\(\s*this\.status\.nativeTrackerStatus\s*\)\s*\|\|\s*isActiveStatus\s*\(\s*this\.status\.motionBridgeStatus\s*\)/u,
  "start() must guard on isActiveStatus for both nativeTrackerStatus and motionBridgeStatus",
);

// The guard must be followed by an early return of the current status
const activeGuardMatch = src.match(
  /isActiveStatus\s*\(\s*this\.status\.nativeTrackerStatus\s*\)\s*\|\|\s*isActiveStatus\s*\(\s*this\.status\.motionBridgeStatus\s*\)([\s\S]{0,80}?)return\s+this\.getStatus\s*\(\s*\)/u,
);
if (!activeGuardMatch) {
  fail(
    "start() must return this.getStatus() without modification when either status is active",
  );
}

// ---------------------------------------------------------------------------
// B. Start preflight error transitions
// ---------------------------------------------------------------------------

// B1. Missing tracker executable → nativeTrackerStatus: 'error', motionBridgeStatus: 'not_started'
requireMatch(
  /trackerExecutablePath\s*===\s*null/u,
  "start() must check trackerExecutablePath === null for missing tracker executable",
);

const trackerMissingBlock = src.match(
  /trackerExecutablePath\s*===\s*null[\s\S]{0,600}?nativeTrackerStatus:\s*['"]error['"][\s\S]{0,200}?motionBridgeStatus:\s*['"]not_started['"]/u,
);
if (!trackerMissingBlock) {
  fail(
    "start() must set nativeTrackerStatus='error' and motionBridgeStatus='not_started' when tracker executable is missing",
  );
}

requireMatch(
  /lastError:.*[Nn]ative\s+tracker\s+executable/u,
  "start() lastError must mention native tracker executable when tracker executable is missing",
);

requireMatch(
  /trackerExecutableCandidates\.join/u,
  "start() lastError must include candidate locations via trackerExecutableCandidates.join",
);

// B2. OpenCV face detector requested without LVK_FACE_CASCADE_PATH
requireMatch(
  /requestedFaceDetector\s*===\s*['"]opencv['"]\s*&&\s*!\s*faceCascadePath/u,
  "start() must guard against requestedFaceDetector='opencv' without faceCascadePath",
);

const opencvMissingCascadeBlock = src.match(
  /requestedFaceDetector\s*===\s*['"]opencv['"]\s*&&\s*!\s*faceCascadePath[\s\S]{0,400}?nativeTrackerStatus:\s*['"]error['"]/u,
);
if (!opencvMissingCascadeBlock) {
  fail(
    "start() must set nativeTrackerStatus='error' when opencv face detector is requested without LVK_FACE_CASCADE_PATH",
  );
}

requireMatch(
  /LVK_FACE_CASCADE_PATH/u,
  "start() lastError must mention LVK_FACE_CASCADE_PATH when opencv face detector is requested without cascade path",
);

// Pipeline option fields must be preserved in preflight error blocks
requireMatch(
  /pipelineCameraSource:\s*cameraSource/u,
  "start() preflight error status must preserve pipelineCameraSource from the requested options",
);

requireMatch(
  /pipelineFaceDetector:\s*faceDetector/u,
  "start() preflight error status must preserve pipelineFaceDetector from the resolved options",
);

// ---------------------------------------------------------------------------
// C. Successful start transition
// ---------------------------------------------------------------------------

// isStopping must be reset to false before starting the bridge
const isStoppingFalseBeforeStart = src.match(
  /this\.isStopping\s*=\s*false[\s\S]{0,600}?startMotionBridgeServer\s*\(/u,
);
if (!isStoppingFalseBeforeStart) {
  fail(
    "start() must set this.isStopping = false before calling startMotionBridgeServer()",
  );
}

// Status must transition to starting before bridge start
const startingStatusBeforeStart = src.match(
  /nativeTrackerStatus:\s*['"]starting['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]starting['"][\s\S]{0,600}?startMotionBridgeServer\s*\(/u,
);
if (!startingStatusBeforeStart) {
  fail(
    "start() must set both nativeTrackerStatus and motionBridgeStatus to 'starting' before calling startMotionBridgeServer()",
  );
}

requireMatch(
  /lastMessage:.*Starting native MotionFrame pipeline/u,
  "start() must set lastMessage beginning with 'Starting native MotionFrame pipeline' before starting",
);

// startMotionBridgeServer must be called before tracker spawn
const bridgeBeforeTracker = src.match(
  /startMotionBridgeServer\s*\([\s\S]{0,600}?\)\s*[\s\S]{0,400}?this\.trackerProcess\s*=\s*spawn/u,
);
if (!bridgeBeforeTracker) {
  fail(
    "start() must call startMotionBridgeServer() before spawning tracker process",
  );
}

// Tracker must be spawned with trackerExecutablePath and trackerArgs
requireMatch(
  /spawn\s*\(\s*trackerExecutablePath\s*,\s*trackerArgs/u,
  "start() must spawn tracker using trackerExecutablePath and trackerArgs",
);

// Tracker stdout must be consumed by a readline interface
const readlineOnTrackerStdout = src.match(
  /createInterface\s*\(\s*\{[\s\S]{0,200}?input:\s*this\.trackerProcess\.stdout/u,
);
if (!readlineOnTrackerStdout) {
  fail(
    "start() must create a readline interface with input: this.trackerProcess.stdout",
  );
}

// readline lines must be published via publishMotionFrameLine
requireMatch(
  /publishMotionFrameLine\s*\(\s*line\s*\)/u,
  "start() must call publishMotionFrameLine(line) for each readline line",
);

// After successful start, status must transition to running
const runningStatusAfterStart = src.match(
  /publishMotionFrameLine[\s\S]{0,600}?nativeTrackerStatus:\s*['"]running['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]running['"]/u,
);
if (!runningStatusAfterStart) {
  fail(
    "start() must set both nativeTrackerStatus and motionBridgeStatus to 'running' after successful start",
  );
}

requireMatch(
  /lastMessage:.*[Nn]ative pipeline started[\s\S]{0,200}?PREVIEW_NATIVE_URL/u,
  "start() running status lastMessage must mention the native pipeline and reference PREVIEW_NATIVE_URL",
);

// ---------------------------------------------------------------------------
// D. Stop transition
// ---------------------------------------------------------------------------

// Early return when no tracker process and no active statuses
const stopEarlyReturn = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,200}?!\s*this\.trackerProcess[\s\S]{0,200}?!\s*isActiveStatus[\s\S]{0,200}?!\s*isActiveStatus[\s\S]{0,200}?return\s+this\.getStatus\s*\(\s*\)/u,
);
if (!stopEarlyReturn) {
  fail(
    "stop() must return this.getStatus() without changes when there is no tracker process and no active statuses",
  );
}

// stop() must set isStopping = true
const stopSetsIsStopping = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,600}?this\.isStopping\s*=\s*true/u,
);
if (!stopSetsIsStopping) {
  fail("stop() must set this.isStopping = true");
}

// stop() must set tracker status to 'stopping' when trackerProcess exists
requireMatch(
  /nativeTrackerStatus:\s*this\.trackerProcess\s*\?\s*['"]stopping['"]/u,
  "stop() must set nativeTrackerStatus to 'stopping' when trackerProcess exists",
);

// stop() must set bridge status to 'stopping'
requireMatch(
  /motionBridgeStatus:\s*['"]stopping['"]/u,
  "stop() must set motionBridgeStatus to 'stopping'",
);

requireMatch(
  /lastMessage:\s*['"]Stopping native MotionFrame pipeline\.['"]/u,
  "stop() must set lastMessage to 'Stopping native MotionFrame pipeline.'",
);

// stop() must close the readline interface before terminating tracker
const readlineCloseBeforeTerminate = src.match(
  /async\s+stop[\s\S]{0,600}?trackerStdoutReader\?\.close\s*\(\s*\)[\s\S]{0,400}?terminateProcess\s*\(\s*this\.trackerProcess\s*\)/u,
);
if (!readlineCloseBeforeTerminate) {
  fail(
    "stop() must close trackerStdoutReader before terminating the tracker process",
  );
}

// stop() must call stopMotionBridgeServer() after terminating tracker
const stopBridgeAfterTerminate = src.match(
  /await\s+this\.terminateProcess\s*\(\s*this\.trackerProcess\s*\)[\s\S]{0,200}?stopMotionBridgeServer\s*\(\s*\)/u,
);
if (!stopBridgeAfterTerminate) {
  fail(
    "stop() must call stopMotionBridgeServer() after awaiting terminateProcess(this.trackerProcess)",
  );
}

// After termination, tracker ref must become null
const nullRefAfterStop = src.match(
  /await\s+this\.terminateProcess[\s\S]{0,200}?this\.trackerProcess\s*=\s*null/u,
);
if (!nullRefAfterStop) {
  fail("stop() must set trackerProcess to null after terminateProcess");
}

// Final exited status
const exitedStatusAfterStop = src.match(
  /this\.trackerProcess\s*=\s*null[\s\S]{0,200}?nativeTrackerStatus:\s*['"]exited['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]exited['"]/u,
);
if (!exitedStatusAfterStop) {
  fail(
    "stop() must set nativeTrackerStatus and motionBridgeStatus to 'exited' after nulling tracker ref",
  );
}

requireMatch(
  /lastMessage:\s*['"]Native MotionFrame pipeline stopped\.['"]/u,
  "stop() must set lastMessage to 'Native MotionFrame pipeline stopped.'",
);

// isStopping must be reset to false after stopping
const isStoppingFalseAfterStop = src.match(
  /nativeTrackerStatus:\s*['"]exited['"][\s\S]{0,200}?this\.isStopping\s*=\s*false/u,
);
if (!isStoppingFalseAfterStop) {
  fail("stop() must reset this.isStopping = false after setting exited status");
}

// ---------------------------------------------------------------------------
// E. Cleanup on quit
// ---------------------------------------------------------------------------

requireMatch(
  /cleanupOnQuit\s*\(\s*\):\s*void/u,
  "nativePipeline.ts must define cleanupOnQuit(): void",
);

// cleanupOnQuit must set isStopping = true
const cleanupSetsIsStopping = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,200}?this\.isStopping\s*=\s*true/u,
);
if (!cleanupSetsIsStopping) {
  fail("cleanupOnQuit() must set this.isStopping = true");
}

// cleanupOnQuit must close readline interface
const cleanupClosesReader = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,400}?trackerStdoutReader\?\.close\s*\(\s*\)/u,
);
if (!cleanupClosesReader) {
  fail("cleanupOnQuit() must close trackerStdoutReader");
}

// cleanupOnQuit must kill tracker
const cleanupKillTracker = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,600}?this\.killProcess\s*\(\s*this\.trackerProcess\s*\)/u,
);
if (!cleanupKillTracker) {
  fail("cleanupOnQuit() must call killProcess for trackerProcess");
}

// cleanupOnQuit must null tracker ref
const cleanupNullTracker = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,800}?this\.trackerProcess\s*=\s*null/u,
);
if (!cleanupNullTracker) {
  fail("cleanupOnQuit() must set trackerProcess to null");
}

// cleanupOnQuit must stop the in-process bridge
const cleanupStopsBridge = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,800}?stopMotionBridgeServer\s*\(\s*\)/u,
);
if (!cleanupStopsBridge) {
  fail("cleanupOnQuit() must call stopMotionBridgeServer()");
}

// ---------------------------------------------------------------------------
// F. Unexpected exit/error transitions
// ---------------------------------------------------------------------------

// Tracker error handler → nativeTrackerStatus: 'error'
requireMatch(
  /kind\s*===\s*['"]tracker['"][\s\S]{0,200}?nativeTrackerStatus:\s*['"]error['"]/u,
  "tracker 'error' handler must set nativeTrackerStatus to 'error'",
);

// Tracker error lastError must use truncated description
requireMatch(
  /kind\s*===\s*['"]tracker['"][\s\S]{0,300}?truncateStatusMessage\s*\(\s*describeTrackerSpawnError/u,
  "tracker 'error' handler must set lastError using truncateStatusMessage(describeTrackerSpawnError(...))",
);

// Tracker unexpected exit sets status based on exit code
requireMatch(
  /nativeTrackerStatus:\s*code\s*===\s*0\s*\?\s*['"]exited['"]\s*:\s*['"]error['"]/u,
  "tracker 'exit' handler must set nativeTrackerStatus to 'exited' when code===0 and 'error' otherwise",
);

// Tracker unexpected exit stops the bridge
requireMatch(
  /this\.terminateBridgeAfterTrackerExit\s*\(\s*childProcess\s*\)/u,
  "tracker unexpected exit must call terminateBridgeAfterTrackerExit",
);

// terminateBridgeAfterTrackerExit must close readline and stop bridge server
const bridgeStopOnTrackerExit = src.match(
  /terminateBridgeAfterTrackerExit[\s\S]{0,600}?trackerStdoutReader\?\.close[\s\S]{0,400}?stopMotionBridgeServer\s*\(\s*\)/u,
);
if (!bridgeStopOnTrackerExit) {
  fail(
    "terminateBridgeAfterTrackerExit must close trackerStdoutReader and call stopMotionBridgeServer()",
  );
}

// In-process bridge server error must guard with !this.isStopping
requireMatch(
  /startMotionBridgeServer[\s\S]{0,400}?!this\.isStopping/u,
  "startMotionBridgeServer error callback must guard with !this.isStopping",
);

// In-process bridge server error must set motionBridgeStatus: 'error'
const bridgeServerErrorSetsStatus = src.match(
  /startMotionBridgeServer[\s\S]{0,400}?motionBridgeStatus:\s*['"]error['"]/u,
);
if (!bridgeServerErrorSetsStatus) {
  fail(
    "startMotionBridgeServer error callback must set motionBridgeStatus to 'error'",
  );
}

// In-process bridge server error must terminate tracker
const bridgeServerErrorTerminatesTracker = src.match(
  /startMotionBridgeServer[\s\S]{0,600}?void\s+this\.terminateProcess\s*\(\s*this\.trackerProcess\s*\)/u,
);
if (!bridgeServerErrorTerminatesTracker) {
  fail("startMotionBridgeServer error callback must terminate trackerProcess");
}

// tracker stdout must NOT be logged directly (consumed via readline instead)
requireMatch(
  /tracker\s+stdout\s+is\s+consumed\s+by\s+the\s+readline/u,
  "attachProcessHandlers must document that tracker stdout is consumed by the readline interface",
);

// ---------------------------------------------------------------------------
// G. Termination hardening
// ---------------------------------------------------------------------------

// stop() must reset isStopping = false in a finally block
const isStoppingResetInFinally = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,2000}?finally\s*\{[\s\S]{0,200}?this\.isStopping\s*=\s*false/u,
);
if (!isStoppingResetInFinally) {
  fail("stop() must reset this.isStopping = false inside a finally block");
}

// stop() must null tracker ref and set exited status before the finally block
const nullRefInsideTry = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,2000}?this\.trackerProcess\s*=\s*null[\s\S]{0,300}?finally/u,
);
if (!nullRefInsideTry) {
  fail("stop() must null trackerProcess before the finally block");
}

const exitedStatusInsideTry = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,2000}?nativeTrackerStatus:\s*['"]exited['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]exited['"][\s\S]{0,300}?finally/u,
);
if (!exitedStatusInsideTry) {
  fail(
    "stop() must set nativeTrackerStatus='exited' and motionBridgeStatus='exited' before the finally block",
  );
}

// terminateProcess() must define a local settle() helper
const terminateDefinesSettle = src.match(
  /private\s+async\s+terminateProcess[\s\S]{0,400}?const\s+settle\s*=/u,
);
if (!terminateDefinesSettle) {
  fail("terminateProcess() must define a local settle() helper");
}

// settle() helper must call clearTimeout(timeout)
const settleClearsTimeout = src.match(
  /const\s+settle\s*=[\s\S]{0,300}?clearTimeout\s*\(\s*timeout\s*\)/u,
);
if (!settleClearsTimeout) {
  fail("terminateProcess() settle() helper must call clearTimeout(timeout)");
}

// settle() helper must remove the exit listener
const settleRemovesListener = src.match(
  /const\s+settle\s*=[\s\S]{0,300}?removeListener\s*\(\s*['"]exit['"]\s*,\s*settle\s*\)/u,
);
if (!settleRemovesListener) {
  fail(
    "terminateProcess() settle() helper must call removeListener('exit', settle) to clean up",
  );
}

// terminateProcess() must register settle as the exit listener
requireMatch(
  /childProcess\.on\s*\(\s*['"]exit['"]\s*,\s*settle\s*\)/u,
  "terminateProcess() must register settle as the 'exit' listener via childProcess.on('exit', settle)",
);

// terminateProcess() must send SIGTERM first (before the timeout)
const sigtermBeforeTimeout = src.match(
  /private\s+async\s+terminateProcess[\s\S]{0,1200}?this\.killProcess\s*\(\s*childProcess\s*,\s*['"]SIGTERM['"]\s*\)/u,
);
if (!sigtermBeforeTimeout) {
  fail(
    "terminateProcess() must call killProcess(childProcess, 'SIGTERM') to send SIGTERM",
  );
}

// terminateProcess() must use FORCE_KILL_TIMEOUT_MS in setTimeout
requireMatch(
  /setTimeout\s*\([\s\S]{0,300}?FORCE_KILL_TIMEOUT_MS\s*\)/u,
  "terminateProcess() must use FORCE_KILL_TIMEOUT_MS as the setTimeout delay",
);

// The force-kill timeout must call killProcess with SIGKILL
const timeoutSendsKill = src.match(
  /setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,200}?this\.killProcess\s*\(\s*childProcess\s*,\s*['"]SIGKILL['"]\s*\)/u,
);
if (!timeoutSendsKill) {
  fail(
    "terminateProcess() force-kill timeout must call killProcess(childProcess, 'SIGKILL')",
  );
}

// killProcess() must guard null and already-exited processes before calling kill
const killProcessGuards = src.match(
  /private\s+killProcess[\s\S]{0,300}?!\s*childProcess\s*\|\|\s*hasExited\s*\(\s*childProcess\s*\)/u,
);
if (!killProcessGuards) {
  fail(
    "killProcess() must guard with '!childProcess || hasExited(childProcess)' before calling childProcess.kill()",
  );
}

console.log(
  "Electron native pipeline lifecycle transitions OK:\n" +
    "  A. Active-status guard — isActiveStatus checks 'starting'|'running'|'stopping'; " +
    "start() returns getStatus() without modification when either status is active.\n" +
    "  B. Start preflight error transitions — missing tracker sets error/not_started with candidate locations; " +
    "opencv without cascade sets error with LVK_FACE_CASCADE_PATH mention; " +
    "pipeline option fields preserved in all preflight error blocks.\n" +
    "  C. Successful start transition — isStopping reset to false; starting status set before bridge start; " +
    "startMotionBridgeServer() called before tracker spawn; " +
    "tracker spawned with trackerExecutablePath and trackerArgs; " +
    "readline interface reads tracker stdout and calls publishMotionFrameLine(line); " +
    "running status set with native preview URL.\n" +
    "  D. Stop transition — early return when no tracker process and no active statuses; " +
    "isStopping set to true; stopping status and message set; readline closed before terminate; " +
    "tracker terminated via terminateProcess; stopMotionBridgeServer() called after; " +
    "tracker ref nulled; exited status and stopped message set; isStopping reset in finally.\n" +
    "  E. Cleanup-on-quit — isStopping set; readline closed; tracker killed; " +
    "tracker ref nulled; stopMotionBridgeServer() called.\n" +
    "  F. Unexpected exit/error — tracker error sets nativeTrackerStatus='error' with truncated description; " +
    "tracker unexpected exit maps code===0 to 'exited' and non-zero to 'error', calls terminateBridgeAfterTrackerExit; " +
    "terminateBridgeAfterTrackerExit closes readline and calls stopMotionBridgeServer(); " +
    "startMotionBridgeServer error callback guards !isStopping, sets motionBridgeStatus='error', terminates tracker; " +
    "tracker stdout documented as consumed by readline (not logged directly).\n" +
    "  G. Termination hardening — stop() resets isStopping in finally block; " +
    "tracker ref nulled and exited status set before finally; " +
    "terminateProcess() uses local settle() helper; settle() clears timeout and removes exit listener; " +
    "SIGTERM sent first; FORCE_KILL_TIMEOUT_MS setTimeout calls killProcess(SIGKILL); " +
    "killProcess() guards null/already-exited before calling kill.",
);
