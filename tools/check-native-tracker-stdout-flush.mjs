#!/usr/bin/env node
// Native Core MotionFrame stdout flush regression (#584).
//
// Proves that a complete MotionFrame NDJSON line becomes readable from a pipe
// promptly after being written -- independent of whether --realtime is set --
// rather than being withheld until the C++ stdio buffer fills (a few KiB) or
// the process exits. This is a behavioral, non-timing-fragile distinction:
//
//   - Scenario A (no --realtime) uses the synthetic-helper tracking backend
//     with the deterministic, test-only --session-result-delay-ms flag on
//     lvk-synthetic-helper. That flag inserts a real, bounded, non-sleep-in-
//     the-test wait entirely on the child helper side, so each of a small
//     number of finite frames becomes available only after its own delay
//     elapses -- giving an observable window, well before process exit, in
//     which a fixed implementation must expose that frame's bytes and a
//     buffered implementation cannot yet have flushed anything. The
//     assertions below check categorical properties (arrival order, per-line
//     chunk size, and inter-arrival spacing tracking the configured delay),
//     not tight wall-clock thresholds.
//   - Scenario B (--realtime, default dummy backend, low --camera-fps) proves
//     --realtime pacing itself is unaffected by decoupling stdout visibility
//     from it: frames still arrive spaced by roughly 1000/fps ms apart.
//
// Both scenarios assert every stdout line is valid MotionFrame v1 JSON with
// source "native" and nothing else reaches stdout. Synthetic/local-only, no
// camera, no webcam, no MediaPipe, no long sleeps (bounded by a small
// configured per-result delay, not by waiting out a stale/timeout window).
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const trackerPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const helperPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

const fail = (message) => {
  console.error(`Native tracker stdout flush check failed: ${message}`);
  process.exit(1);
};

if (!trackerPath || !helperPath) {
  fail(
    "expected the lvk-tracker-core executable path as the first argument " +
      "and the lvk-synthetic-helper executable path as the second argument",
  );
}

const killAndWait = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolveWait) => {
    let killTimer = null;

    const finishExit = () => {
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      resolveWait();
    };

    child.once("exit", finishExit);
    child.kill();

    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1000);
    killTimer.unref();
  });
};

// Runs `trackerPath` with `args`, collecting each stdout line's arrival wall
// clock time (relative to spawn) alongside the raw byte length of the OS-level
// chunk it arrived in, and every stderr chunk for diagnostics on failure.
// Resolves once `expectedLineCount` valid MotionFrame lines have been parsed
// and the process has exited 0, or rejects on any parse/validation/timeout
// failure. Always waits for and reports the process exit.
const runAndCollect = async (label, args, expectedLineCount, timeoutMs) => {
  const child = spawn(trackerPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const startedAt = Date.now();

  const lines = [];
  let buffer = "";
  let stderrText = "";
  let settled = false;
  let exitInfo = null;

  const result = await new Promise((resolveRun, rejectRun) => {
    const finishOk = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveRun();
    };

    const finishFail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    };

    const timer = setTimeout(() => {
      finishFail(
        new Error(
          `[${label}] timed out after ${timeoutMs}ms waiting for ${expectedLineCount} ` +
            `MotionFrame lines (received ${lines.length})`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const arrivedAtMs = Date.now() - startedAt;
      buffer += chunk.toString("utf8");

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (rawLine.trim().length === 0) {
          continue;
        }

        const frame = parseNativeMotionFrameJson(rawLine);
        if (frame === null) {
          finishFail(
            new Error(
              `[${label}] stdout carried non-MotionFrame content: ${rawLine}`,
            ),
          );
          return;
        }
        if (frame.source !== "native") {
          finishFail(
            new Error(
              `[${label}] expected source "native", got "${frame.source}"`,
            ),
          );
          return;
        }

        lines.push({ arrivedAtMs, chunkBytes: chunk.length, frame });
        if (lines.length > expectedLineCount) {
          finishFail(
            new Error(
              `[${label}] received more than the expected ${expectedLineCount} MotionFrame lines`,
            ),
          );
          return;
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrText += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      finishFail(
        new Error(
          `[${label}] could not start ${trackerPath}: ${error.message}`,
        ),
      );
    });

    // Wait for the process's own natural exit (--frames is finite and
    // bounded) rather than killing it as soon as the target line count is
    // reached, so the exit code reflects genuine, unforced completion.
    child.on("exit", (code, signal) => {
      exitInfo = { code, signal };
      if (lines.length < expectedLineCount) {
        finishFail(
          new Error(
            `[${label}] exited before ${expectedLineCount} MotionFrame lines were received ` +
              `(code ${code}, signal ${signal}, received ${lines.length})` +
              (stderrText ? `; stderr: ${stderrText.trim()}` : ""),
          ),
        );
        return;
      }
      finishOk();
    });
  })
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, error }));

  // Safety net only: on success the process has already exited naturally by
  // the time finishOk() fires; on failure/timeout this ensures no child is
  // left running.
  await killAndWait(child);

  if (!result.ok) {
    throw result.error;
  }

  if (exitInfo === null || exitInfo.code !== 0) {
    throw new Error(
      `[${label}] exited with status ${exitInfo ? exitInfo.code : "unknown"}` +
        (stderrText ? `; stderr: ${stderrText.trim()}` : ""),
    );
  }

  return lines;
};

const assertOrdered = (label, lines) => {
  let previousTimestampMs = null;
  for (const [index, { frame }] of lines.entries()) {
    if (!Number.isFinite(frame.timestampMs)) {
      throw new Error(
        `[${label}] line ${index + 1} has a non-finite timestampMs`,
      );
    }
    if (
      previousTimestampMs !== null &&
      frame.timestampMs < previousTimestampMs
    ) {
      throw new Error(
        `[${label}] line ${index + 1} timestampMs ${frame.timestampMs} is earlier than ` +
          `previous timestampMs ${previousTimestampMs}`,
      );
    }
    previousTimestampMs = frame.timestampMs;
  }
};

// Scenario A: no --realtime. Per-result delay lives entirely on the
// synthetic-helper child, independent of the tracker's own --realtime flag.
const SESSION_RESULT_DELAY_MS = 300;
const SCENARIO_A_FRAME_COUNT = 3;
const SCENARIO_A_TIMEOUT_MS = 8000;
// The configured per-result delay applies to every request, including the
// first, so line 1 is expected at roughly one delay period plus process/IPC
// startup overhead -- NOT near-zero. A fixed implementation must still expose
// it well before a second delay period could have elapsed (which is when
// line 2 would first become possible); an unfixed, block-buffered
// implementation instead withholds all lines until process exit, i.e. close
// to SCENARIO_A_FRAME_COUNT delay periods. This threshold sits clearly
// between those two signatures with margin for CI jitter.
const MAX_FIRST_LINE_ARRIVAL_MS = SESSION_RESULT_DELAY_MS * 1.8;
// A single MotionFrame line is a few hundred bytes; several lines' worth
// would be multiple KiB. This threshold sits well below both.
const MAX_FIRST_CHUNK_BYTES = 900;
// Consecutive lines must be spaced close to the configured delay, not
// clustered together (which would mean they arrived as one late burst).
const MIN_INTER_LINE_GAP_MS = SESSION_RESULT_DELAY_MS * 0.4;

const runScenarioA = async () => {
  const label = "no --realtime, synthetic-helper";
  const lines = await runAndCollect(
    label,
    [
      "--camera-source",
      "dummy",
      "--face-detector",
      "noop",
      "--tracking-backend",
      "synthetic-helper",
      "--helper-executable",
      helperPath,
      "--helper-arg",
      "--session-result-delay-ms",
      "--helper-arg",
      String(SESSION_RESULT_DELAY_MS),
      "--frames",
      String(SCENARIO_A_FRAME_COUNT),
    ],
    SCENARIO_A_FRAME_COUNT,
    SCENARIO_A_TIMEOUT_MS,
  );

  if (lines.length !== SCENARIO_A_FRAME_COUNT) {
    throw new Error(
      `[${label}] expected exactly ${SCENARIO_A_FRAME_COUNT} MotionFrame lines, got ${lines.length}`,
    );
  }

  assertOrdered(label, lines);

  const [first, ...rest] = lines;

  if (first.arrivedAtMs > MAX_FIRST_LINE_ARRIVAL_MS) {
    throw new Error(
      `[${label}] first MotionFrame line took ${first.arrivedAtMs}ms to become readable ` +
        `(expected under ${MAX_FIRST_LINE_ARRIVAL_MS}ms); stdout appears to be withheld ` +
        "rather than flushed promptly",
    );
  }

  if (first.chunkBytes > MAX_FIRST_CHUNK_BYTES) {
    throw new Error(
      `[${label}] the chunk containing the first line was ${first.chunkBytes} bytes ` +
        `(expected under ${MAX_FIRST_CHUNK_BYTES} bytes); this looks like a multi-line ` +
        "block-buffer flush rather than a single prompt line",
    );
  }

  let previousArrivalMs = first.arrivedAtMs;
  for (const entry of rest) {
    const gapMs = entry.arrivedAtMs - previousArrivalMs;
    if (gapMs < MIN_INTER_LINE_GAP_MS) {
      throw new Error(
        `[${label}] consecutive MotionFrame lines arrived only ${gapMs}ms apart ` +
          `(expected at least ${MIN_INTER_LINE_GAP_MS}ms, tracking the configured ` +
          `${SESSION_RESULT_DELAY_MS}ms per-result delay); lines appear to have arrived in a ` +
          "single late burst rather than incrementally",
      );
    }
    previousArrivalMs = entry.arrivedAtMs;
  }

  console.log(
    `Scenario A passed: ${lines.length} MotionFrame lines delivered incrementally without ` +
      `--realtime (first line at ${first.arrivedAtMs}ms, each in its own small chunk).`,
  );
};

// Scenario B: --realtime pacing must remain intact and unaffected by
// decoupling stdout visibility from it. Low --camera-fps keeps the expected
// spacing comfortably larger than scheduling/process jitter without a long
// overall run.
const SCENARIO_B_CAMERA_FPS = 10;
const SCENARIO_B_FRAME_COUNT = 3;
const SCENARIO_B_TIMEOUT_MS = 8000;
const SCENARIO_B_EXPECTED_GAP_MS = 1000 / SCENARIO_B_CAMERA_FPS;
const SCENARIO_B_MIN_GAP_MS = SCENARIO_B_EXPECTED_GAP_MS * 0.4;

const runScenarioB = async () => {
  const label = "--realtime pacing";
  const lines = await runAndCollect(
    label,
    [
      "--camera-source",
      "dummy",
      "--face-detector",
      "noop",
      "--realtime",
      "--camera-fps",
      String(SCENARIO_B_CAMERA_FPS),
      "--frames",
      String(SCENARIO_B_FRAME_COUNT),
    ],
    SCENARIO_B_FRAME_COUNT,
    SCENARIO_B_TIMEOUT_MS,
  );

  if (lines.length !== SCENARIO_B_FRAME_COUNT) {
    throw new Error(
      `[${label}] expected exactly ${SCENARIO_B_FRAME_COUNT} MotionFrame lines, got ${lines.length}`,
    );
  }

  assertOrdered(label, lines);

  let previousArrivalMs = lines[0].arrivedAtMs;
  for (const entry of lines.slice(1)) {
    const gapMs = entry.arrivedAtMs - previousArrivalMs;
    if (gapMs < SCENARIO_B_MIN_GAP_MS) {
      throw new Error(
        `[${label}] consecutive MotionFrame lines arrived only ${gapMs}ms apart ` +
          `(expected at least ${SCENARIO_B_MIN_GAP_MS}ms, tracking ~${SCENARIO_B_EXPECTED_GAP_MS}ms ` +
          `pacing at ${SCENARIO_B_CAMERA_FPS} fps); --realtime pacing appears broken`,
      );
    }
    previousArrivalMs = entry.arrivedAtMs;
  }

  console.log(
    `Scenario B passed: ${lines.length} MotionFrame lines paced by --realtime at ` +
      `${SCENARIO_B_CAMERA_FPS} fps (unaffected by the stdout flush fix).`,
  );
};

try {
  await runScenarioA();
  await runScenarioB();
  console.log(
    "Native tracker stdout flush check passed: MotionFrame lines are flushed promptly " +
      "independent of --realtime, and --realtime pacing itself is unaffected.",
  );
} catch (error) {
  fail(error.message);
}
