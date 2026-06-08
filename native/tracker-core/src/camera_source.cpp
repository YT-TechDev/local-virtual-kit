#include "camera_source.h"

#ifndef LVK_HAS_OPENCV_CAMERA
#define LVK_HAS_OPENCV_CAMERA 0
#endif

#ifndef LVK_HAS_OPENCV_IMAGE
#define LVK_HAS_OPENCV_IMAGE 0
#endif

#if LVK_HAS_OPENCV_CAMERA
#include "opencv_camera_source.h"
#endif

#include <cmath>

namespace lvk::tracker {
namespace {

long long timestampForSequence(int sequenceNumber, double nominalFps) {
  return static_cast<long long>(
      std::llround(static_cast<double>(sequenceNumber) * 1000.0 / nominalFps));
}

}  // namespace

std::unique_ptr<CameraSource> createCameraSource(
    const CameraSourceOptions& options) {
  if (options.sourceName == "dummy") {
    return std::make_unique<DummyCameraSource>(
        options.width, options.height, options.nominalFps);
  }

  if (options.sourceName == "opencv") {
#if LVK_HAS_OPENCV_CAMERA
    return std::make_unique<OpenCvCameraSource>(
        options.cameraIndex, options.width, options.height, options.nominalFps);
#else
    return nullptr;
#endif
  }

  return nullptr;
}

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

CameraSourceDiagnostics DummyCameraSource::diagnostics() const {
  return CameraSourceDiagnostics{
      "dummy-camera-source",
      isRunning_,
      width_,
      height_,
      nominalFps_,
      nextSequenceNumber_,
      -1,
      0,
      "dummy",
  };
}

bool DummyCameraSource::nextFrame(CameraFrame& frame) {
  if (!isRunning_) {
    return false;
  }

#if LVK_HAS_OPENCV_IMAGE
  frame = CameraFrame{
      nextSequenceNumber_,
      timestampForSequence(nextSequenceNumber_, nominalFps_),
      width_,
      height_,
      nominalFps_,
      cv::Mat{},
  };
#else
  frame = CameraFrame{
      nextSequenceNumber_,
      timestampForSequence(nextSequenceNumber_, nominalFps_),
      width_,
      height_,
      nominalFps_,
  };
#endif

  ++nextSequenceNumber_;
  return true;
}

}  // namespace lvk::tracker
