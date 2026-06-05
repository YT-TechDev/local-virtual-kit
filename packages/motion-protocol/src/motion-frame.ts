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

export type TrackingQuality = {
  status: TrackingStatus;
  confidence: number;
};

export type FacePose = {
  position: Vector3;
  rotation: EulerRotation;
};

export type EyeState = {
  leftOpen: number;
  rightOpen: number;
  gaze: Vector2;
};

export type MouthState = {
  open: number;
  smile: number;
};

export type MotionFrame = {
  schemaVersion: 1;
  timestampMs: number;
  source: MotionFrameSource;
  tracking: TrackingQuality;
  face: FacePose;
  eyes: EyeState;
  mouth: MouthState;
};
