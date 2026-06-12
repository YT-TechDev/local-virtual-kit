import { describe, expect, it } from "vitest";
import {
  isMotionFrame,
  isNativeMotionFrame,
  parseNativeMotionFrameJson,
} from "../motion-frame-validation.js";
import type { MotionFrame } from "../motion-frame";

const validNativeMotionFrame: MotionFrame = {
  schemaVersion: 1,
  timestampMs: 1000,
  source: "native",
  tracking: {
    status: "tracking",
    confidence: 0.9,
  },
  face: {
    position: { x: 0.1, y: -0.2, z: 0.3 },
    rotation: { pitch: 0.4, yaw: -0.5, roll: 0.6 },
  },
  eyes: {
    leftOpen: 0.7,
    rightOpen: 0.8,
    gaze: { x: -0.1, y: 0.2 },
  },
  mouth: {
    open: 0.3,
    smile: 0.4,
  },
};

const cloneFrame = (): MotionFrame => structuredClone(validNativeMotionFrame);

describe("MotionFrame runtime validation", () => {
  it("accepts a valid v0.1 native MotionFrame", () => {
    const frame = cloneFrame();

    expect(isMotionFrame(frame)).toBe(true);
    expect(isNativeMotionFrame(frame)).toBe(true);
    expect(parseNativeMotionFrameJson(JSON.stringify(frame))).toEqual(frame);
  });

  it("accepts each v0.1 tracking status", () => {
    expect(
      ["not_started", "tracking", "lost"].every((status) => {
        const frame = cloneFrame();
        frame.tracking.status = status as MotionFrame["tracking"]["status"];
        return isNativeMotionFrame(frame);
      }),
    ).toBe(true);
  });

  it("rejects native bridge input that is not source native", () => {
    const frame = cloneFrame();
    frame.source = "dummy";

    expect(isMotionFrame(frame)).toBe(true);
    expect(isNativeMotionFrame(frame)).toBe(false);
    expect(parseNativeMotionFrameJson(JSON.stringify(frame))).toBeNull();
  });

  it("rejects non-finite required numbers", () => {
    const frame = cloneFrame();
    frame.tracking.confidence = Number.NaN;

    expect(isNativeMotionFrame(frame)).toBe(false);
  });

  it("rejects stale fields as replacements for tracking and face pose fields", () => {
    expect(
      isNativeMotionFrame({
        ...cloneFrame(),
        tracking: undefined,
        face: { detected: true },
      }),
    ).toBe(false);

    expect(
      isNativeMotionFrame({
        ...cloneFrame(),
        face: { position: { x: 0, y: 0, z: 0 } },
        head: { pitch: 0, yaw: 0, roll: 0 },
      }),
    ).toBe(false);
  });

  it("rejects stale eyes and emotion fields as replacements", () => {
    expect(
      isNativeMotionFrame({
        ...cloneFrame(),
        eyes: { blink: 0 },
      }),
    ).toBe(false);

    expect(
      isNativeMotionFrame({
        ...cloneFrame(),
        mouth: undefined,
        emotion: { smile: 1 },
      }),
    ).toBe(false);
  });

  it("rejects invalid JSON and non-string native frame payloads", () => {
    expect(parseNativeMotionFrameJson("{not-json")).toBeNull();
    expect(parseNativeMotionFrameJson(cloneFrame())).toBeNull();
  });
});
