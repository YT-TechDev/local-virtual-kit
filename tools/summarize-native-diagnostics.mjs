#!/usr/bin/env node
import { readFileSync } from "node:fs";

const logPath = process.argv[2];

if (!logPath) {
  console.error(
    "Usage: node tools/summarize-native-diagnostics.mjs <stderr-log-path>",
  );
  process.exit(1);
}

let logText;

try {
  logText = readFileSync(logPath, "utf8");
} catch (error) {
  console.error(
    `Unable to read diagnostics log at ${JSON.stringify(logPath)}: ${error.message}`,
  );
  process.exit(1);
}

const pipelineMetricNames = [
  "captureDurationMs",
  "preprocessDurationMs",
  "trackingDurationMs",
  "writeDurationMs",
  "totalFrameDurationMs",
];
const faceMetricNames = ["detectionDurationMs"];

const pipelineValues = Object.fromEntries(
  pipelineMetricNames.map((metricName) => [metricName, []]),
);
const faceValues = Object.fromEntries(
  faceMetricNames.map((metricName) => [metricName, []]),
);

let pipelineCount = 0;
let faceCount = 0;
let hasFaceCount = 0;
let lostOrNoFaceCount = 0;
const detectorCounts = new Map();

function extractNumber(line, fieldName) {
  const match = line.match(
    new RegExp(
      `(?:^|[, ])${fieldName}=(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?)(?=,|$)`,
    ),
  );

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseBooleanField(line, fieldName) {
  const match = line.match(
    new RegExp(`(?:^|[, ])${fieldName}=(true|false)(?=,|$)`),
  );
  return match ? match[1] === "true" : null;
}

function parseSafeTextField(line, fieldName) {
  const match = line.match(
    new RegExp(`(?:^|[, ])${fieldName}=([A-Za-z0-9._-]+)(?=,|$)`),
  );
  return match ? match[1] : null;
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function countDetector(detectorName) {
  detectorCounts.set(detectorName, (detectorCounts.get(detectorName) ?? 0) + 1);
}

function parseDetectorName(line) {
  return (
    parseSafeTextField(line, "detectorName") ??
    parseSafeTextField(line, "detector") ??
    "unknown"
  );
}

function rateForCount(count, total) {
  return total > 0 ? roundMetric(count / total) : null;
}

function summarizeNumbers(values) {
  if (values.length === 0) {
    return null;
  }

  let min = values[0];
  let max = values[0];
  let sum = 0;

  for (const value of values) {
    if (value < min) {
      min = value;
    }

    if (value > max) {
      max = value;
    }

    sum += value;
  }

  return {
    min: roundMetric(min),
    avg: roundMetric(sum / values.length),
    max: roundMetric(max),
  };
}

for (const line of logText.split(/\r?\n/)) {
  if (line.startsWith("[pipeline] periodic:")) {
    pipelineCount += 1;

    for (const metricName of pipelineMetricNames) {
      const value = extractNumber(line, metricName);

      if (value !== null) {
        pipelineValues[metricName].push(value);
      }
    }

    continue;
  }

  if (line.startsWith("[face] periodic:")) {
    faceCount += 1;

    for (const metricName of faceMetricNames) {
      const value = extractNumber(line, metricName);

      if (value !== null) {
        faceValues[metricName].push(value);
      }
    }

    countDetector(parseDetectorName(line));

    const hasFace = parseBooleanField(line, "hasFace");

    if (hasFace === true) {
      hasFaceCount += 1;
    } else if (hasFace === false) {
      lostOrNoFaceCount += 1;
    }
  }
}

const summary = {
  pipeline: {
    count: pipelineCount,
    captureDurationMs: summarizeNumbers(pipelineValues.captureDurationMs),
    preprocessDurationMs: summarizeNumbers(pipelineValues.preprocessDurationMs),
    trackingDurationMs: summarizeNumbers(pipelineValues.trackingDurationMs),
    writeDurationMs: summarizeNumbers(pipelineValues.writeDurationMs),
    totalFrameDurationMs: summarizeNumbers(pipelineValues.totalFrameDurationMs),
  },
  face: {
    count: faceCount,
    detectionDurationMs: summarizeNumbers(faceValues.detectionDurationMs),
    hasFaceCount,
    lostOrNoFaceCount,
    hasFaceRate: rateForCount(hasFaceCount, faceCount),
    lostOrNoFaceRate: rateForCount(lostOrNoFaceCount, faceCount),
    detectors: Object.fromEntries([...detectorCounts.entries()].sort()),
  },
};

console.log(JSON.stringify(summary, null, 2));
