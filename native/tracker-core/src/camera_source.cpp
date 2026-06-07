#include "camera_source.h"

#include <cmath>

namespace lvk::tracker {
namespace {

long long timestampForSequence(int sequenceNumber, double nominalFps) {
  return static_cast<long long>(
      std::llround(static_cast<double>(sequenceNumber) * 1000.0 / nominalFps));
}

}  // namespace

DummyCameraSource::DummyCameraSource(
    int width,
    int height,
    double nominalFps)
    : width_(width), height_(height), nominalFps_(nominalFps) {}

bool DummyCameraSource::start() {
  nextSequenceNumber_ = 0;
  isRunning_ = true;
  return true;
}

void DummyCameraSource::stop() {
  isRunning_ = false;
}

bool DummyCameraSource::nextFrame(CameraFrame& frame) {
  if (!isRunning_) {
    return false;
  }

  frame = CameraFrame{
      nextSequenceNumber_,
      timestampForSequence(nextSequenceNumber_, nominalFps_),
      width_,
      height_,
      nominalFps_,
  };

  ++nextSequenceNumber_;
  return true;
}

}  // namespace lvk::tracker
