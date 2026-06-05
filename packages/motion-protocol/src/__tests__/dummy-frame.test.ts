import { describe, expect, it } from "vitest";
import { createDummyMotionFrame } from "../dummy-frame";

describe("createDummyMotionFrame", () => {
  it("creates a MotionFrame with schema version 1", () => {
    const frame = createDummyMotionFrame(1000);

    expect(frame.schemaVersion).toBe(1);
    expect(frame.source).toBe("dummy");
    expect(frame.timestampMs).toBe(1000);
  });

  it("keeps normalized values within expected range", () => {
    const frame = createDummyMotionFrame(2000);

    expect(frame.tracking.confidence).toBeGreaterThanOrEqual(0);
    expect(frame.tracking.confidence).toBeLessThanOrEqual(1);

    expect(frame.eyes.leftOpen).toBeGreaterThanOrEqual(0);
    expect(frame.eyes.leftOpen).toBeLessThanOrEqual(1);

    expect(frame.eyes.rightOpen).toBeGreaterThanOrEqual(0);
    expect(frame.eyes.rightOpen).toBeLessThanOrEqual(1);

    expect(frame.mouth.open).toBeGreaterThanOrEqual(0);
    expect(frame.mouth.open).toBeLessThanOrEqual(1);

    expect(frame.mouth.smile).toBeGreaterThanOrEqual(0);
    expect(frame.mouth.smile).toBeLessThanOrEqual(1);
  });
});
