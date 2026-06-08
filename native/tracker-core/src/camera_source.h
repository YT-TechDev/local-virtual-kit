#pragma once

#include <memory>
#include <string>

#ifndef LVK_HAS_OPENCV
#define LVK_HAS_OPENCV 0
#endif

#if LVK_HAS_OPENCV
#include <opencv2/core/mat.hpp>
#endif

namespace lvk::tracker {

struct CameraFrame {
  int sequenceNumber;
  long long timestampMs;
  int width;
  int height;
  double nominalFps;
#if LVK_HAS_OPENCV
  cv::Mat image;
#endif
};

struct CameraSourceOptions {
  std::string sourceName = "dummy";
  int width = 640;
  int height = 480;
  double nominalFps = 60.0;
  int cameraIndex = 0;
};

struct CameraSourceDiagnostics {
  std::string sourceName;
  bool isRunning;
  int width;
  int height;
  double nominalFps;
  long long emittedFrameCount;
  int cameraIndex;
  long long failedReadCount;
  std::string backendName;
};

class CameraSource {
 public:
  virtual ~CameraSource() = default;

  virtual bool start() = 0;
  virtual void stop() = 0;
  virtual bool nextFrame(CameraFrame& frame) = 0;
  virtual CameraSourceDiagnostics diagnostics() const = 0;
};

std::unique_ptr<CameraSource> createCameraSource(
    const CameraSourceOptions& options);

class DummyCameraSource final : public CameraSource {
 public:
  DummyCameraSource(int width = 640, int height = 480, double nominalFps = 60.0);

  bool start() override;
  void stop() override;
  bool nextFrame(CameraFrame& frame) override;
  CameraSourceDiagnostics diagnostics() const override;

 private:
  int width_;
  int height_;
  double nominalFps_;
  int nextSequenceNumber_ = 0;
  bool isRunning_ = false;
};

}  // namespace lvk::tracker
