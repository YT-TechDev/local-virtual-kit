#include "tracker.h"

#include <algorithm>
#include <cmath>

namespace lvk::tracker {
namespace {

double clamp(double value, double minValue, double maxValue) {
  return std::max(minValue, std::min(value, maxValue));
}

double wave(double base, double amplitude, double speed, double seconds,
            double phase = 0.0) {
  return base + std::sin((seconds * speed) + phase) * amplitude;
}

} // namespace

TrackingSample DummyMotionTracker::track(const PreprocessedFrame &frame) {
  const auto timestampMs = frame.cameraFrame.timestampMs;
  const double seconds = static_cast<double>(timestampMs) / 1000.0;

  return TrackingSample{
      timestampMs,
      TrackingStatus::Tracking,
      1.0,
      Vector3{
          wave(0.0, 0.05, 0.8, seconds),
          wave(0.0, 0.04, 0.6, seconds),
          0.0,
      },
      EulerRotation{
          wave(0.0, 0.12, 0.7, seconds),
          wave(0.0, 0.18, 0.9, seconds),
          wave(0.0, 0.08, 0.5, seconds),
      },
      clamp(wave(0.85, 0.15, 3.0, seconds), 0.0, 1.0),
      clamp(wave(0.85, 0.15, 3.0, seconds, 0.2), 0.0, 1.0),
      Vector2{
          wave(0.0, 0.25, 0.9, seconds),
          wave(0.0, 0.15, 0.7, seconds),
      },
      clamp(wave(0.25, 0.20, 4.0, seconds), 0.0, 1.0),
      clamp(wave(0.35, 0.15, 0.8, seconds), 0.0, 1.0),
  };
}

} // namespace lvk::tracker
