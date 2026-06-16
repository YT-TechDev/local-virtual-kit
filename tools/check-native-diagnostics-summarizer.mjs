#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const checkerDir = dirname(fileURLToPath(import.meta.url));
const summarizerPath = join(checkerDir, "summarize-native-diagnostics.mjs");
const tempDir = mkdtempSync(join(tmpdir(), "lvk-native-diagnostics-"));
const tempLogPath = join(tempDir, "stderr.log");

function fail(message) {
  throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, received ${JSON.stringify(actual)}`);
  }
}

function assertNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(
      `${label}: expected a finite number, received ${JSON.stringify(value)}`,
    );
  }
}

function assertMetricSummary(value, label) {
  if (!value || typeof value !== "object") {
    fail(
      `${label}: expected a metric summary object, received ${JSON.stringify(value)}`,
    );
  }

  assertNumber(value.min, `${label}.min`);
  assertNumber(value.avg, `${label}.avg`);
  assertNumber(value.max, `${label}.max`);
}

function readSummary(label) {
  const result = spawnSync(process.execPath, [summarizerPath, tempLogPath], {
    encoding: "utf8",
  });

  if (result.error) {
    fail(
      `failed to run diagnostics summarizer for ${label}: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    fail(
      `diagnostics summarizer for ${label} exited with status ${result.status}
stdout:
${result.stdout}
stderr:
${result.stderr}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(
      `diagnostics summarizer for ${label} did not print valid JSON: ${error.message}
stdout:
${result.stdout}`,
    );
  }
}

try {
  writeFileSync(
    tempLogPath,
    [
      "[camera] status: source=opencv, frame=1",
      "[pipeline] periodic: frame=1, captureDurationMs=1.5, preprocessDurationMs=0.25, trackingDurationMs=2.75, writeDurationMs=0.1, totalFrameDurationMs=4.6",
      "[face] periodic: detectorName=opencv, hasFace=true, confidence=0.91, detectionDurationMs=3.25",
      "[pipeline] periodic: frame=2, captureDurationMs=2.5, preprocessDurationMs=0.5, trackingDurationMs=3.25, writeDurationMs=0.2, totalFrameDurationMs=6.45",
      "[face] periodic: detectorName=opencv, hasFace=false, confidence=0, detectionDurationMs=1.75",
      "[face] periodic: hasFace=false, confidence=0, detectionDurationMs=2.25",
      "[motion] emitted frame=2",
      "",
    ].join("\n"),
    "utf8",
  );

  const summary = readSummary("diagnostics fixture");

  assertEqual(summary?.pipeline?.count, 2, "pipeline.count");
  assertEqual(summary?.face?.count, 3, "face.count");
  assertEqual(summary?.face?.hasFaceCount, 1, "face.hasFaceCount");
  assertEqual(summary?.face?.lostOrNoFaceCount, 2, "face.lostOrNoFaceCount");
  assertEqual(summary?.face?.hasFaceRate, 0.333333, "face.hasFaceRate");
  assertEqual(
    summary?.face?.lostOrNoFaceRate,
    0.666667,
    "face.lostOrNoFaceRate",
  );
  assertEqual(summary?.face?.detectors?.opencv, 2, "face.detectors.opencv");
  assertEqual(summary?.face?.detectors?.unknown, 1, "face.detectors.unknown");
  assertMetricSummary(
    summary?.pipeline?.totalFrameDurationMs,
    "pipeline.totalFrameDurationMs",
  );
  assertMetricSummary(
    summary?.face?.detectionDurationMs,
    "face.detectionDurationMs",
  );

  writeFileSync(tempLogPath, "", "utf8");
  const emptySummary = readSummary("empty fixture");
  assertEqual(emptySummary?.face?.count, 0, "empty.face.count");
  assertEqual(emptySummary?.face?.hasFaceRate, null, "empty.face.hasFaceRate");
  assertEqual(
    emptySummary?.face?.lostOrNoFaceRate,
    null,
    "empty.face.lostOrNoFaceRate",
  );

  // Windows PowerShell 5.1 regression: stderr 2> redirection writes UTF-16 LE (BOM FF FE)
  // and Out-File word-wraps long lines at the console width without a continuation marker.
  // The first native stderr line also receives a NativeCommandError prefix.
  // Subsequent tagged lines are plain text but may be split mid-word across two file lines.
  const windowsLines = [
    // First stderr line: NativeCommandError prefix + header block
    ".\\lvk-tracker-core.exe : [camera] startup: sourceName=opencv-camera-source, isRunning=true",
    "At line:1 char:49",
    "    + CategoryInfo          : NotSpecified: (...) [], RemoteException",
    "    + FullyQualifiedErrorId : NativeCommandError",
    "",
    // Plain [pipeline] periodic — fits on one line (no wrap needed here)
    "[pipeline] periodic: emittedFrameCount=10, captureDurationMs=31.5, preprocessDurationMs=0.0002, trackingDurationMs=0.0016, writeDurationMs=0.1095, totalFrameDurationMs=31.611",
    // [face] periodic word-wrapped mid-field at ~97 chars
    "[face] periodic: detectorName=noop, hasFace=false, confidence=0, bounds={x=0, y=0, width=0, height=",
    "0}, detectionDurationMs=0.0005, usedFallbackTracking=true",
    // Second [pipeline] periodic word-wrapped mid-word ("t\nrackingDurationMs")
    "[pipeline] periodic: emittedFrameCount=20, captureDurationMs=28.5, preprocessDurationMs=0.0003, t",
    "rackingDurationMs=0.0022, writeDurationMs=0.158, totalFrameDurationMs=28.69",
    // Second [face] periodic — fits on one line
    "[face] periodic: detectorName=noop, hasFace=false, confidence=0, detectionDurationMs=0.0004",
    "[camera] shutdown: sourceName=opencv-camera-source, effectiveFps=27.0",
    "",
  ].join("\r\n");
  const bom = Buffer.from([0xff, 0xfe]);
  const utf16Buf = Buffer.from(windowsLines, "utf16le");
  writeFileSync(tempLogPath, Buffer.concat([bom, utf16Buf]));

  const windowsSummary = readSummary("Windows PowerShell UTF-16 LE fixture");
  assertEqual(windowsSummary?.pipeline?.count, 2, "windows.pipeline.count");
  assertEqual(windowsSummary?.face?.count, 2, "windows.face.count");
  assertEqual(
    windowsSummary?.face?.lostOrNoFaceCount,
    2,
    "windows.face.lostOrNoFaceCount",
  );
  assertEqual(
    windowsSummary?.face?.hasFaceCount,
    0,
    "windows.face.hasFaceCount",
  );
  assertMetricSummary(
    windowsSummary?.pipeline?.totalFrameDurationMs,
    "windows.pipeline.totalFrameDurationMs",
  );
  assertMetricSummary(
    windowsSummary?.face?.detectionDurationMs,
    "windows.face.detectionDurationMs",
  );

  console.log("native diagnostics summarizer smoke check passed");
} catch (error) {
  console.error(
    `native diagnostics summarizer smoke check failed: ${error.message}`,
  );
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
