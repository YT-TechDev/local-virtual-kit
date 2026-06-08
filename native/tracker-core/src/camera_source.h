#pragma once

#include <string>

namespace lvk::tracker {

struct CameraFrame {
  int sequenceNumber;
  long long timestampMs;
  int width;
  int height;
  double nominalFps;
};

struct CameraSourceDiagnostics {
  std::string sourceName;
  bool isRunning;
  int width;
  int height;
  double nominalFps;
  long long emittedFrameCount;
};

class CameraSource {
 public:
  virtual ~CameraSource() = default;

  virtual bool start() = 0;
  virtual void stop() = 0;
  virtual bool nextFrame(CameraFrame& frame) = 0;
  virtual CameraSourceDiagnostics diagnostics() const = 0;
};

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
