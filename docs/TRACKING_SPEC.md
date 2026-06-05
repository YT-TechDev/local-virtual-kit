# Tracking Specification

## 1. Purpose

The tracking layer converts local webcam frames into normalized MotionFrame values.

The renderer should not depend on tracking implementation details.

## 2. Pipeline

```txt
Camera Frame
  ↓
Frame Capture
  ↓
Preprocessing
  ↓
Face Detection
  ↓
Landmark / Feature Extraction
  ↓
Head Pose Estimation
  ↓
Eye / Mouth / Expression Estimation
  ↓
Normalization
  ↓
Smoothing
  ↓
MotionFrame Output
```

## 3. Output Categories

MotionFrame should include:

- timestamp
- face
- head
- eyes
- mouth
- emotion

## 4. Normalization

| Value Type | Range |
| --- | --- |
| confidence | `0.0` to `1.0` |
| position | `-1.0` to `1.0` |
| rotation-like values | `-1.0` to `1.0` |
| openness | `0.0` to `1.0` |
| expression score | `0.0` to `1.0` |

## 5. Tracking Lost

When tracking is lost:

- `face.detected` should become `false`.
- Renderer should avoid snapping.
- Avatar should return to neutral smoothly.
- Electron should show tracker status.

## 6. Smoothing

v0.1 may use simple exponential smoothing.

```txt
smoothed = previous * smoothing + current * (1 - smoothing)
```

## 7. Calibration

Calibration is a future feature but should be considered in the design.

Possible calibration targets:

- neutral head pose
- eye open baseline
- mouth closed baseline
- camera framing
- sensitivity values
