# Tracking Specification

This document describes native tracking output intent. The exact shared schema is defined in `docs/MOTION_PROTOCOL.md` and `packages/motion-protocol`.

---

## 1. Purpose

The tracking layer converts local webcam frames into normalized MotionFrame-compatible values.

The renderer should consume MotionFrame data and must not depend on tracking implementation details.

---

## 2. Pipeline

```txt
Camera Frame
  ↓
Frame Capture
  ↓
Preprocessing
  ↓
Face Detection / Landmark or Feature Extraction
  ↓
Head Pose Estimation
  ↓
Eye / Gaze / Mouth Value Estimation
  ↓
Normalization
  ↓
Smoothing
  ↓
MotionFrame Output
```

---

## 3. Output Categories

The tracker should produce values that can fill the current MotionFrame shape:

| Category | Current MotionFrame field |
| --- | --- |
| schema version | `schemaVersion` |
| timestamp | `timestampMs` |
| source | `source` |
| tracking state | `tracking.status` |
| confidence | `tracking.confidence` |
| face position | `face.position.x/y/z` |
| head rotation | `face.rotation.pitch/yaw/roll` |
| eye openness | `eyes.leftOpen/rightOpen` |
| gaze | `eyes.gaze.x/y` |
| mouth values | `mouth.open/smile` |

Do not use older field names such as `face.detected`, `head.yaw`, or `eyes.blink` unless the protocol is intentionally changed in the same PR.

---

## 4. Normalization

| Value type | Expected range |
| --- | --- |
| confidence | `0.0` to `1.0` |
| face position | usually `-1.0` to `1.0` |
| rotation-like values | renderer-defined normalized radians or stable small-angle values |
| eye openness | `0.0` to `1.0` |
| gaze | usually `-1.0` to `1.0` |
| mouth values | `0.0` to `1.0` |

The producer should clamp values when practical. The renderer should still tolerate out-of-range values.

---

## 5. Tracking Status

Use `tracking.status`:

| Status | Meaning |
| --- | --- |
| `not_started` | tracking has not started |
| `tracking` | face is currently tracked |
| `lost` | tracking was active but the face is currently lost |

When tracking is lost:

- set `tracking.status` to `lost`
- lower `tracking.confidence`
- keep emitting safe MotionFrame-shaped data if possible
- let the renderer hold or smooth the last valid pose
- let Electron display tracker status

---

## 6. Smoothing

v0.1 may use simple exponential smoothing:

```txt
smoothed = previous * smoothing + current * (1 - smoothing)
```

Smoothing may be applied in the tracker, renderer, or both. Avoid hiding raw protocol issues behind excessive smoothing.

---

## 7. Calibration

Calibration is a future feature but should be considered in design.

Possible calibration targets:

- neutral head pose
- eye open baseline
- mouth closed baseline
- camera framing
- sensitivity values

Do not block early dummy preview or native skeleton work on calibration.
