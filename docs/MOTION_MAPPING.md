# Motion Mapping

This document defines how renderer code should map MotionFrame values into avatar-specific motion. It should not redefine the MotionFrame schema.

---

## 1. Purpose

Tracking emits normalized MotionFrame values. The renderer decides how those values affect a specific avatar.

Keep this layer readable and typed. Avoid compressed one-line mapping code for core avatar behavior.

---

## 2. Mapping Pipeline

```txt
MotionFrame
  ↓
validation / clamping
  ↓
sensitivity adjustment
  ↓
deadzone
  ↓
smoothing
  ↓
avatar-specific mapping
  ↓
R3F scene update
```

Early v0.1 code may implement only a subset of this pipeline, but the boundary should remain clear.

---

## 3. Current Field Mapping

| MotionFrame field | Renderer meaning |
| --- | --- |
| `tracking.status` | tracking state such as active/lost/not started |
| `tracking.confidence` | confidence-based visibility or smoothing strength |
| `face.position.x/y/z` | avatar root/head position offset |
| `face.rotation.pitch` | avatar head rotation X |
| `face.rotation.yaw` | avatar head rotation Y |
| `face.rotation.roll` | avatar head rotation Z |
| `eyes.leftOpen` | left eyelid or morph target |
| `eyes.rightOpen` | right eyelid or morph target |
| `eyes.gaze.x/y` | eye target or pupil offset |
| `mouth.open` | jaw open or mouth morph |
| `mouth.smile` | smile/happy morph blend |

Do not map from older field names such as `face.detected`, `head.yaw`, or `eyes.blink` unless the protocol is intentionally changed.

---

## 4. Blink Policy

v0.1 does not require a separate `eyes.blink` protocol field.

If blink is needed, derive it in the renderer or mapping layer from eye openness, for example:

```txt
blink = 1 - min(eyes.leftOpen, eyes.rightOpen)
```

The exact formula may be avatar-specific.

---

## 5. Tracking Lost Mapping

When `tracking.status` is `lost`:

- enter tracking-lost state
- hold the last valid pose briefly when possible
- return toward neutral smoothly
- avoid snapping
- optionally lower avatar responsiveness based on confidence

When `tracking.status` is `not_started`:

- show neutral or idle avatar state
- do not assume camera failure

---

## 6. Type Policy

Renderer mapping should use explicit types.

Prefer clear output names such as:

```ts
export type AvatarMotionState = {
  position: [number, number, number];
  rotation: [number, number, number];
  eyeOpen: {
    left: number;
    right: number;
  };
  gaze: [number, number];
  mouth: {
    open: number;
    smile: number;
  };
};
```

Avoid opaque names such as `p`, `r`, `e`, `g`, and `m` in shared mapping code.

---

## 7. Flow Avatar Example Policy

The future `examples/flow-avatar` may use the user's R3F flow library to manage avatar states such as:

- booting
- calibrating
- idle
- talking
- trackingLost
- streaming

This must remain optional until the flow library is public and stable.
