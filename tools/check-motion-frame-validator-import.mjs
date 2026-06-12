#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

assert.equal(
  typeof parseNativeMotionFrameJson,
  "function",
  "parseNativeMotionFrameJson should be importable from source JS",
);

const validNativeMotionFrame = {
  schemaVersion: 1,
  timestampMs: 0,
  source: "native",
  tracking: {
    status: "tracking",
    confidence: 1,
  },
  face: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
  },
  eyes: {
    leftOpen: 1,
    rightOpen: 1,
    gaze: { x: 0, y: 0 },
  },
  mouth: {
    open: 0,
    smile: 0,
  },
};

assert.deepEqual(
  parseNativeMotionFrameJson(JSON.stringify(validNativeMotionFrame)),
  validNativeMotionFrame,
  "valid native MotionFrame JSON should be accepted",
);

assert.equal(
  parseNativeMotionFrameJson("{not-json"),
  null,
  "invalid JSON should be rejected",
);

assert.equal(
  parseNativeMotionFrameJson(
    JSON.stringify({ ...validNativeMotionFrame, source: "dummy" }),
  ),
  null,
  "dummy-source MotionFrame JSON should be rejected for native bridge input",
);

console.log("MotionFrame validator source import smoke check passed.");
