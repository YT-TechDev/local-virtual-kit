#pragma once

#include "camera_source.h"

#include <opencv2/videoio.hpp>

namespace lvk::tracker {

class OpenCvCameraSource final : public CameraSource {
 public:
  OpenCvCameraSource(
      int cameraIndex = 0,
      int requestedWidth = 640,
      int requestedHeight = 480,
      double requestedFps = 60.0);
  ~OpenCvCameraSource() override;

  bool start() override;
  void stop() override;
  bool nextFrame(CameraFrame& frame) override;
  CameraSourceDiagnostics diagnostics() const override;

 private:
  int cameraIndex_;
  int requestedWidth_;
  int requestedHeight_;
  double requestedFps_;
  double effectiveFps_;
  int width_;
  int height_;
  long long emittedFrameCount_ = 0;
  bool isRunning_ = false;
  cv::VideoCapture capture_;
};

}  // namespace lvk::tracker
