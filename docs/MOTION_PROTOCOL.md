# MotionFrame Protocol

This document is the schema reference for MotionFrame. Keep it focused on the data contract. Do not add renderer behavior or agent workflow here.

---

## 1. Purpose

`MotionFrame` is the shared contract between the C++ Native Core and the Web Preview renderer.

It must remain:

- small
- normalized
- framework-independent
- transport-friendly
- independent from React, Three.js, R3F, Electron, OpenCV, MediaPipe, and native platform APIs

MotionFrame is a data contract, not a rendering contract.

---

## 2. Source of Truth

The implementation source of truth is:

```txt
packages/motion-protocol/src/motion-frame.ts
```

When changing the schema, update all affected producers and consumers in the same PR:

- `packages/motion-protocol`
- dummy frame generator
- renderer mapping
- native serializer draft or implementation
- this document

---

## 3. Current TypeScript Shape

```ts
export type MotionFrameSource = "dummy" | "native";

export type TrackingStatus = "not_started" | "tracking" | "lost";

export type Vector2 = {
  x: number;
  y: number;
};

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type EulerRotation = {
  pitch: number;
  yaw: number;
  roll: number;
};

export type MotionFrame = {
  schemaVersion: 1;
  timestampMs: number;
  source: MotionFrameSource;
  tracking: {
    status: TrackingStatus;
    confidence: number;
  };
  face: {
    position: Vector3;
    rotation: EulerRotation;
  };
  eyes: {
    leftOpen: number;
    rightOpen: number;
    gaze: Vector2;
  };
  mouth: {
    open: number;
    smile: number;
  };
};
```

---

## 4. Field Rules

| Field | Rule |
| --- | --- |
| `schemaVersion` | v0.1 uses `1`. Increment only for breaking schema changes. |
| `timestampMs` | milliseconds from producer perspective; monotonic when possible. |
| `source` | `dummy` for TypeScript dummy frames, `native` for Native Core output. |
| `tracking.status` | `not_started`, `tracking`, or `lost`. Replaces older `face.detected` boolean style. |
| `tracking.confidence` | normalized `0.0` to `1.0`. |
| `face.position.x/y/z` | normalized face position values. |
| `face.rotation.pitch/yaw/roll` | normalized or stable small-angle head rotation values. |
| `eyes.leftOpen/rightOpen` | normalized eye openness, `0.0` closed to `1.0` open. |
| `eyes.gaze.x/y` | normalized gaze direction. |
| `mouth.open` | normalized mouth opening, `0.0` to `1.0`. |
| `mouth.smile` | normalized smile value, `0.0` to `1.0`. |

Do not add `face.detected`, `head.*`, `eyes.blink`, or `emotion` fields in v0.1 unless the protocol is intentionally changed in the same PR.

---

## 5. JSON Example

```json
{
  "schemaVersion": 1,
  "timestampMs": 0,
  "source": "native",
  "tracking": {
    "status": "tracking",
    "confidence": 1
  },
  "face": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "pitch": 0, "yaw": 0, "roll": 0 }
  },
  "eyes": {
    "leftOpen": 1,
    "rightOpen": 1,
    "gaze": { "x": 0, "y": 0 }
  },
  "mouth": {
    "open": 0,
    "smile": 0
  }
}
```

---

## 6. Transport Policy

v0.1 uses local WebSocket + JSON.

The renderer should tolerate:

- missing frames
- disconnects
- reconnects
- delayed frames
- out-of-order frames
- out-of-range values
- `tracking.status = "not_started"`
- `tracking.status = "lost"`

The renderer should clamp values or fall back to safe defaults.

---

## 7. Dummy MotionFrame

`@lvk/motion-protocol` should provide dummy frames for renderer development without native tracking.

Dummy frames should:

- use `schemaVersion: 1`
- use `source: "dummy"`
- normally use `tracking.status: "tracking"`
- animate face position and rotation
- animate eye openness and gaze
- animate mouth open and smile

Dummy frames are protocol development tools. They must not become renderer-specific.

---

## 8. Renderer-Derived Values

The renderer may derive values such as:

- blink from `eyes.leftOpen/rightOpen`
- smoothed rotation
- idle motion
- avatar-specific bones
- avatar-specific morph target weights

Do not add derived renderer-only values to MotionFrame unless they are required shared protocol data.

---

## 9. Compatibility Policy

Avoid breaking MotionFrame after the first working MVP.

If a breaking change is necessary:

1. increment `schemaVersion`
2. update all producers and consumers in the same PR
3. include migration notes in this document
