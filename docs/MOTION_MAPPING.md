# Motion Mapping Design

## 1. Purpose

Motion mapping defines how MotionFrame values are converted into avatar motion.

Tracking emits normalized values. The renderer decides how those values affect the avatar.

## 2. Mapping Pipeline

```txt
MotionFrame
  ↓
Validation / clamping
  ↓
Sensitivity adjustment
  ↓
Deadzone
  ↓
Smoothing
  ↓
Avatar-specific mapping
  ↓
R3F scene update
```

## 3. Head Mapping

```txt
head.yaw   → avatar head rotation Y
head.pitch → avatar head rotation X
head.roll  → avatar head rotation Z
```

## 4. Eye Mapping

```txt
eyes.leftOpen  → left eyelid / morph target
eyes.rightOpen → right eyelid / morph target
eyes.blink     → combined blink expression
```

## 5. Mouth Mapping

```txt
mouth.open  → jaw open / mouth shape
mouth.smile → smile shape / happy expression blend
```

## 6. Tracking Lost Mapping

When `face.detected` is false:

- enter tracking-lost state
- hold last valid pose briefly
- return to neutral smoothly
- avoid snapping

## 7. Flow Avatar Example Policy

The future `examples/flow-avatar` may use the user's R3F flow library to manage avatar states such as:

- booting
- calibrating
- idle
- talking
- trackingLost
- streaming
- surprised

This must remain optional until the flow library is public and stable.
