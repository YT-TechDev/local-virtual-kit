# MotionFrame Protocol

## 1. Purpose

MotionFrame is the shared protocol between the C++ Native Tracking Core and the R3F Avatar Preview.

It must remain small, normalized, framework-independent, and transport-friendly.

## 2. TypeScript Definition

```ts
export type MotionFrame = {
  timestamp: number;

  face: {
    detected: boolean;
    confidence: number;
    x: number;
    y: number;
    z: number;
  };

  head: {
    yaw: number;
    pitch: number;
    roll: number;
  };

  eyes: {
    leftOpen: number;
    rightOpen: number;
    blink: number;
  };

  mouth: {
    open: number;
    smile: number;
  };

  emotion: {
    neutral: number;
    happy: number;
    surprised: number;
    angry: number;
  };
};
```

## 3. C++ Structure Draft

```cpp
struct MotionFrame {
  double timestamp;

  bool faceDetected;
  float faceConfidence;
  float faceX;
  float faceY;
  float faceZ;

  float headYaw;
  float headPitch;
  float headRoll;

  float leftEyeOpen;
  float rightEyeOpen;
  float blink;

  float mouthOpen;
  float smile;

  float emotionNeutral;
  float emotionHappy;
  float emotionSurprised;
  float emotionAngry;
};
```

## 4. Transport

v0.1 uses WebSocket + JSON.

The renderer should tolerate missing frames, disconnects, out-of-range values, and `face.detected = false`.

## 5. Dummy MotionFrame

`motion-protocol` should provide dummy frames for renderer development without native tracking.

## 6. Compatibility Policy

Avoid breaking MotionFrame after the first working MVP. If a breaking change is needed, update protocol version, docs, dummy frames, renderer mapping, and native serializer together.
