#!/usr/bin/env node
// Electron/Desktop NativePipelineManager lifecycle transition checker.
//
// Covers:
//   A. Active-status guard — isActiveStatus set and start() early-return contract.
//   B. Start preflight error transitions — missing bridge, missing tracker, opencv without cascade.
//   C. Successful start transition — isStopping reset, starting status, spawn order, bridge env,
//      stdout pipe, running status.
//   D. Stop transition — early-return guard, isStopping set, stopping status, unpipe,
//      stdin end, Promise.all termination, null refs, exited status, isStopping reset.
//   E. Cleanup-on-quit — isStopping set, unpipe, stdin end, kill, null refs.
//   F. Unexpected exit/error transitions — tracker error, tracker unexpected exit,
//      bridge error, bridge non-zero exit, bridge server-error stderr, stdout not logged.
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

// B1. Missing bridge script → nativeTrackerStatus: 'not_started', motionBridgeStatus: 'error'
requireMatch(
  /existsSync\s*\(\s*bridgeScriptPath\s*\)/u,
  "start() must check existsSync(bridgeScriptPath) for the bridge script",
);

requireMatch(
  /nativeTrackerStatus:\s*['"]not_started['"]/u,
  "start() must set nativeTrackerStatus to 'not_started' when bridge script is missing",
);

// The not_started assignment must appear in a block near the bridge error assignment
const bridgeMissingBlock = src.match(
  /existsSync\s*\(\s*bridgeScriptPath\s*\)[\s\S]{0,600}?nativeTrackerStatus:\s*['"]not_started['"][\s\S]{0,200}?motionBridgeStatus:\s*['"]error['"]/u,
);
if (!bridgeMissingBlock) {
  fail(
    "start() must set nativeTrackerStatus='not_started' and motionBridgeStatus='error' when bridge script is missing",
  );
}

requireMatch(
  /lastError:.*[Dd]evelopment\s+MotionFrame\s+bridge/u,
  "start() lastError must mention the development MotionFrame bridge when bridge script is missing",
);

// B2. Missing tracker executable → nativeTrackerStatus: 'error', motionBridgeStatus: 'manual_dev_tool'
requireMatch(
  /trackerExecutablePath\s*===\s*null/u,
  "start() must check trackerExecutablePath === null for missing tracker executable",
);

// There must be a block that sets nativeTrackerStatus: 'error' and motionBridgeStatus: 'manual_dev_tool'
// when the tracker executable is null
const trackerMissingBlock = src.match(
  /trackerExecutablePath\s*===\s*null[\s\S]{0,600}?nativeTrackerStatus:\s*['"]error['"][\s\S]{0,200}?motionBridgeStatus:\s*['"]manual_dev_tool['"]/u,
);
if (!trackerMissingBlock) {
  fail(
    "start() must set nativeTrackerStatus='error' and motionBridgeStatus='manual_dev_tool' when tracker executable is missing",
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

// B3. OpenCV face detector requested without LVK_FACE_CASCADE_PATH
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

// Pipeline option fields (cameraSource, faceDetector) must be preserved in preflight error blocks
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

// isStopping must be reset to false before spawning
const isStoppingFalseBeforeSpawn = src.match(
  /this\.isStopping\s*=\s*false[\s\S]{0,600}?this\.bridgeProcess\s*=\s*spawn/u,
);
if (!isStoppingFalseBeforeSpawn) {
  fail(
    "start() must set this.isStopping = false before spawning bridge process",
  );
}

// Status must transition to starting before spawn
const startingStatusBeforeSpawn = src.match(
  /nativeTrackerStatus:\s*['"]starting['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]starting['"][\s\S]{0,600}?this\.bridgeProcess\s*=\s*spawn/u,
);
if (!startingStatusBeforeSpawn) {
  fail(
    "start() must set both nativeTrackerStatus and motionBridgeStatus to 'starting' before spawning",
  );
}

requireMatch(
  /lastMessage:.*Starting development native MotionFrame pipeline/u,
  "start() must set lastMessage beginning with 'Starting development native MotionFrame pipeline' before spawning",
);

// Bridge must be spawned before tracker
const bridgeBeforeTracker = src.match(
  /this\.bridgeProcess\s*=\s*spawn[\s\S]{0,400}?this\.trackerProcess\s*=\s*spawn/u,
);
if (!bridgeBeforeTracker) {
  fail("start() must spawn bridge process before tracker process");
}

// Bridge must run nodeProcess.execPath with bridgeScriptPath
requireMatch(
  /spawn\s*\(\s*nodeProcess\.execPath\s*,\s*\[\s*bridgeScriptPath\s*\]/u,
  "start() must spawn bridge using nodeProcess.execPath with [bridgeScriptPath]",
);

// Bridge env must include ELECTRON_RUN_AS_NODE: '1'
requireMatch(
  /ELECTRON_RUN_AS_NODE:\s*['"]1['"]/u,
  "start() bridge spawn env must include ELECTRON_RUN_AS_NODE: '1'",
);

// Tracker must be spawned with trackerExecutablePath and trackerArgs
requireMatch(
  /spawn\s*\(\s*trackerExecutablePath\s*,\s*trackerArgs/u,
  "start() must spawn tracker using trackerExecutablePath and trackerArgs",
);

// Tracker stdout must be piped into bridge stdin
requireMatch(
  /this\.trackerProcess\.stdout\.pipe\s*\(\s*this\.bridgeProcess\.stdin/u,
  "start() must pipe trackerProcess.stdout into bridgeProcess.stdin",
);

// After successful spawn, status must transition to running
const runningStatusAfterSpawn = src.match(
  /this\.trackerProcess\.stdout\.pipe[\s\S]{0,1000}?nativeTrackerStatus:\s*['"]running['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]running['"]/u,
);
if (!runningStatusAfterSpawn) {
  fail(
    "start() must set both nativeTrackerStatus and motionBridgeStatus to 'running' after successful spawn",
  );
}

requireMatch(
  /lastMessage:.*[Dd]evelopment native pipeline started[\s\S]{0,200}?PREVIEW_NATIVE_URL/u,
  "start() running status lastMessage must mention the native pipeline and reference PREVIEW_NATIVE_URL",
);

// ---------------------------------------------------------------------------
// D. Stop transition
// ---------------------------------------------------------------------------

// Early return when no processes and no active statuses
const stopEarlyReturn = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,200}?!\s*this\.trackerProcess[\s\S]{0,100}?!\s*this\.bridgeProcess[\s\S]{0,200}?!\s*isActiveStatus[\s\S]{0,200}?!\s*isActiveStatus[\s\S]{0,200}?return\s+this\.getStatus\s*\(\s*\)/u,
);
if (!stopEarlyReturn) {
  fail(
    "stop() must return this.getStatus() without changes when there are no processes and no active statuses",
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

// stop() must set bridge status to 'stopping' when bridgeProcess exists
requireMatch(
  /motionBridgeStatus:\s*this\.bridgeProcess\s*\?\s*['"]stopping['"]/u,
  "stop() must set motionBridgeStatus to 'stopping' when bridgeProcess exists",
);

requireMatch(
  /lastMessage:\s*['"]Stopping development native MotionFrame pipeline\.['"]/u,
  "stop() must set lastMessage to 'Stopping development native MotionFrame pipeline.'",
);

// Unpipe when both tracker and bridge exist
requireMatch(
  /this\.trackerProcess\s*&&\s*this\.bridgeProcess[\s\S]{0,200}?this\.trackerProcess\.stdout\.unpipe\s*\(\s*this\.bridgeProcess\.stdin\s*\)/u,
  "stop() must unpipe trackerProcess.stdout from bridgeProcess.stdin when both processes exist",
);

// End writable bridge stdin
requireMatch(
  /this\.bridgeProcess\?\.stdin\.writable[\s\S]{0,100}?this\.bridgeProcess\.stdin\.end\s*\(\s*\)/u,
  "stop() must end bridgeProcess.stdin when it is writable",
);

// Terminate both via Promise.all
requireMatch(
  /Promise\.all\s*\(\s*\[\s*\n?\s*this\.terminateProcess\s*\(\s*this\.trackerProcess\s*\)\s*,\s*\n?\s*this\.terminateProcess\s*\(\s*this\.bridgeProcess\s*\)/u,
  "stop() must terminate tracker and bridge via Promise.all",
);

// After termination, both refs must become null
const nullRefsAfterStop = src.match(
  /await\s+Promise\.all[\s\S]{0,200}?this\.trackerProcess\s*=\s*null[\s\S]{0,100}?this\.bridgeProcess\s*=\s*null/u,
);
if (!nullRefsAfterStop) {
  fail(
    "stop() must set both trackerProcess and bridgeProcess to null after Promise.all termination",
  );
}

// Final exited status
const exitedStatusAfterStop = src.match(
  /this\.trackerProcess\s*=\s*null[\s\S]{0,200}?nativeTrackerStatus:\s*['"]exited['"][\s\S]{0,100}?motionBridgeStatus:\s*['"]exited['"]/u,
);
if (!exitedStatusAfterStop) {
  fail(
    "stop() must set nativeTrackerStatus and motionBridgeStatus to 'exited' after nulling process refs",
  );
}

requireMatch(
  /lastMessage:\s*['"]Development native MotionFrame pipeline stopped\.['"]/u,
  "stop() must set lastMessage to 'Development native MotionFrame pipeline stopped.'",
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

// cleanupOnQuit must unpipe when both processes exist
const cleanupUnpipe = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,400}?this\.trackerProcess\s*&&\s*this\.bridgeProcess[\s\S]{0,200}?this\.trackerProcess\.stdout\.unpipe\s*\(\s*this\.bridgeProcess\.stdin\s*\)/u,
);
if (!cleanupUnpipe) {
  fail(
    "cleanupOnQuit() must unpipe trackerProcess.stdout from bridgeProcess.stdin when both exist",
  );
}

// cleanupOnQuit must end writable bridge stdin
const cleanupEndStdin = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,600}?this\.bridgeProcess\?\.stdin\.writable[\s\S]{0,100}?this\.bridgeProcess\.stdin\.end\s*\(\s*\)/u,
);
if (!cleanupEndStdin) {
  fail("cleanupOnQuit() must end bridgeProcess.stdin when it is writable");
}

// cleanupOnQuit must kill both processes
const cleanupKillTracker = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,600}?this\.killProcess\s*\(\s*this\.trackerProcess\s*\)/u,
);
if (!cleanupKillTracker) {
  fail("cleanupOnQuit() must call killProcess for trackerProcess");
}

const cleanupKillBridge = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,800}?this\.killProcess\s*\(\s*this\.bridgeProcess\s*\)/u,
);
if (!cleanupKillBridge) {
  fail("cleanupOnQuit() must call killProcess for bridgeProcess");
}

// cleanupOnQuit must null both refs
const cleanupNullTracker = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,800}?this\.trackerProcess\s*=\s*null/u,
);
if (!cleanupNullTracker) {
  fail("cleanupOnQuit() must set trackerProcess to null");
}

const cleanupNullBridge = src.match(
  /cleanupOnQuit\s*\(\s*\)[\s\S]{0,1000}?this\.bridgeProcess\s*=\s*null/u,
);
if (!cleanupNullBridge) {
  fail("cleanupOnQuit() must set bridgeProcess to null");
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

// Tracker unexpected exit stops the paired bridge
requireMatch(
  /this\.terminateBridgeAfterTrackerExit\s*\(\s*childProcess\s*\)/u,
  "tracker unexpected exit must call terminateBridgeAfterTrackerExit",
);

// Bridge error handler → motionBridgeStatus: 'error'
requireMatch(
  /kind\s*===\s*['"]bridge['"][\s\S]{0,200}?motionBridgeStatus:\s*['"]error['"]/u,
  "bridge 'error' handler must set motionBridgeStatus to 'error'",
);

// Bridge error lastError must use truncated description (in the else branch of the error handler)
requireMatch(
  /describeBridgeProcessError\s*\(\s*error\s*\)/u,
  "bridge 'error' handler must set lastError using describeBridgeProcessError(error)",
);

requireMatch(
  /truncateStatusMessage\s*\(\s*describeBridgeProcessError/u,
  "bridge 'error' handler must wrap describeBridgeProcessError with truncateStatusMessage",
);

// Bridge unexpected non-zero exit → motionBridgeStatus: 'error'
requireMatch(
  /motionBridgeStatus:\s*code\s*===\s*0[\s\S]{0,50}?\|\|\s*bridgeWasStopping\s*\?\s*['"]exited['"]\s*:\s*['"]error['"]/u,
  "bridge 'exit' handler must set motionBridgeStatus to 'exited' on clean exit and 'error' on non-zero exit",
);

// Bridge non-zero exit terminates tracker if running
requireMatch(
  /code\s*!==\s*0\s*&&\s*!bridgeWasStopping\s*&&\s*this\.trackerProcess[\s\S]{0,100}?void\s+this\.terminateProcess\s*\(\s*this\.trackerProcess\s*\)/u,
  "bridge unexpected non-zero exit must terminate trackerProcess when it is still running",
);

// Bridge stderr 'server error' → motionBridgeStatus: 'error', terminates both processes
requireMatch(
  /message\.includes\s*\(\s*['"]server error['"]\s*\)\s*&&\s*!this\.isStopping/u,
  "bridge stderr handler must check for 'server error' in message and guard with !this.isStopping",
);

requireMatch(
  /message\.includes\s*\(\s*['"]server error['"]\s*\)[\s\S]{0,300}?motionBridgeStatus:\s*['"]error['"]/u,
  "bridge stderr 'server error' must set motionBridgeStatus to 'error'",
);

// Bridge server error must terminate both processes
const serverErrorTerminates = src.match(
  /message\.includes\s*\(\s*['"]server error['"]\s*\)[\s\S]{0,500}?void\s+this\.terminateProcess\s*\(\s*this\.trackerProcess\s*\)[\s\S]{0,200}?void\s+this\.terminateProcess\s*\(\s*this\.bridgeProcess\s*\)/u,
);
if (!serverErrorTerminates) {
  fail(
    "bridge 'server error' stderr must terminate both trackerProcess and bridgeProcess",
  );
}

// Electron main must not log raw native MotionFrame stdout from either process
requireMatch(
  /childProcess\.stdout\.on\s*\(\s*['"]data['"]\s*,\s*\(\s*\)\s*=>\s*\{[\s\S]{0,100}?\/\//u,
  "attachProcessHandlers must attach a stdout 'data' handler that intentionally does not log (empty handler with comment)",
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

// stop() must null both process refs before the finally block closes
const nullRefsInsideTry = src.match(
  /async\s+stop\s*\(\s*\)[\s\S]{0,2000}?this\.trackerProcess\s*=\s*null[\s\S]{0,100}?this\.bridgeProcess\s*=\s*null[\s\S]{0,300}?finally/u,
);
if (!nullRefsInsideTry) {
  fail(
    "stop() must null both trackerProcess and bridgeProcess before the finally block",
  );
}

// stop() must set exited status for both processes before the finally block
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
    "  B. Start preflight error transitions — missing bridge sets not_started/error with bridge mention; " +
    "missing tracker sets error/manual_dev_tool with candidate locations; " +
    "opencv without cascade sets error with LVK_FACE_CASCADE_PATH mention; " +
    "pipeline option fields preserved in all preflight error blocks.\n" +
    "  C. Successful start transition — isStopping reset to false; starting status set before spawn; " +
    "bridge spawned before tracker via nodeProcess.execPath with ELECTRON_RUN_AS_NODE=1; " +
    "tracker spawned with trackerExecutablePath and trackerArgs; " +
    "tracker stdout piped to bridge stdin; running status set with native preview URL.\n" +
    "  D. Stop transition — early return when no processes and no active statuses; " +
    "isStopping set to true; stopping status and message set; tracker stdout unpiped from bridge stdin; " +
    "bridge stdin ended when writable; both terminated via Promise.all; " +
    "refs nulled; exited status and stopped message set; isStopping reset to false in finally block.\n" +
    "  E. Cleanup-on-quit — isStopping set; tracker stdout unpiped; bridge stdin ended; " +
    "both processes killed; both refs nulled.\n" +
    "  F. Unexpected exit/error — tracker error sets nativeTrackerStatus='error' with truncated description; " +
    "tracker unexpected exit maps code===0 to 'exited' and non-zero to 'error', stops bridge; " +
    "bridge error sets motionBridgeStatus='error' with truncated description; " +
    "bridge non-zero exit sets 'error' and terminates tracker; " +
    "bridge server-error stderr sets 'error' and terminates both processes; " +
    "stdout handler intentionally empty (native frames not logged from Electron main).\n" +
    "  G. Termination hardening — stop() resets isStopping in finally block; " +
    "process refs nulled and exited status set before finally; " +
    "terminateProcess() uses local settle() helper; settle() clears timeout and removes exit listener; " +
    "SIGTERM sent first; FORCE_KILL_TIMEOUT_MS setTimeout calls killProcess(SIGKILL); " +
    "killProcess() guards null/already-exited before calling kill.",
);
