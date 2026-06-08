#pragma once

#include "camera_source.h"

namespace lvk::tracker {

struct Vector2 {
  double x;
  double y;
};

struct Vector3 {
  double x;
  double y;
  double z;
};

struct EulerRotation {
  double pitch;
  double yaw;
  double roll;
};

struct TrackingSample {
  long long timestampMs;
  Vector3 facePosition;
  EulerRotation faceRotation;
  double leftEyeOpen;
  double rightEyeOpen;
  Vector2 gaze;
  double mouthOpen;
  double mouthSmile;
};

class MotionTracker {
public:
  virtual ~MotionTracker() = default;

  virtual TrackingSample track(const CameraFrame &frame) = 0;
};

class DummyMotionTracker final : public MotionTracker {
public:
  TrackingSample track(const CameraFrame &frame) override;
};

} // namespace lvk::tracker
