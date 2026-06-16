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
  const buf = readFileSync(logPath);
  // UTF-16 LE BOM (FF FE): produced by Windows PowerShell 5.1 stderr redirection (2>).
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    logText = new TextDecoder("utf-16le").decode(buf.slice(2));
  } else {
    // Strip UTF-8 BOM (EF BB BF) if present, then read as UTF-8.
    const start =
      buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
        ? 3
        : 0;
    logText = buf.slice(start).toString("utf8");
  }
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

// Pre-join PowerShell word-wrapped continuation lines. PowerShell 5.1 Out-File
// breaks long stderr lines at the console width without a continuation marker.
// Only lines that follow a tagged "[...]" line are treated as continuations.
const rawLines = logText.split(/\r?\n/);
const joinedLines = [];
let inTaggedLine = false;
for (const rawLine of rawLines) {
  const isTaggedStart = rawLine.startsWith("[");
  const isHeaderLine =
    rawLine === "" ||
    rawLine.startsWith(" ") ||
    rawLine.startsWith("+") ||
    rawLine.startsWith("At line:");

  if (isTaggedStart) {
    joinedLines.push(rawLine);
    inTaggedLine = true;
  } else if (isHeaderLine) {
    joinedLines.push(rawLine);
    inTaggedLine = false;
  } else if (inTaggedLine) {
    // Continuation of a word-wrapped tagged line — append without separator
    // because PowerShell breaks mid-word (e.g. "t\n" + "rackingDurationMs=").
    joinedLines[joinedLines.length - 1] += rawLine;
  } else {
    joinedLines.push(rawLine);
    inTaggedLine = false;
  }
}

for (const rawLine of joinedLines) {
  const pipelineIdx = rawLine.indexOf("[pipeline] periodic:");
  if (pipelineIdx !== -1) {
    const line = rawLine.slice(pipelineIdx);
    pipelineCount += 1;

    for (const metricName of pipelineMetricNames) {
      const value = extractNumber(line, metricName);

      if (value !== null) {
        pipelineValues[metricName].push(value);
      }
    }

    continue;
  }

  const faceIdx = rawLine.indexOf("[face] periodic:");
  if (faceIdx !== -1) {
    const line = rawLine.slice(faceIdx);
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
