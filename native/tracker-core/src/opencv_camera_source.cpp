#include "opencv_camera_source.h"

#include <cmath>
#include <opencv2/core.hpp>
#include <opencv2/core/utils/logger.hpp>
#include <opencv2/core/version.hpp>
#include <opencv2/videoio.hpp>

namespace lvk::tracker {
namespace {

constexpr double kFallbackFps = 30.0;

long long timestampForSequence(long long sequenceNumber, double nominalFps) {
  return static_cast<long long>(
      std::llround(static_cast<double>(sequenceNumber) * 1000.0 / nominalFps));
}

double validFpsOrFallback(double fps, double requestedFps) {
  if (std::isfinite(fps) && fps > 0.0) {
    return fps;
  }

  if (std::isfinite(requestedFps) && requestedFps > 0.0) {
    return requestedFps;
  }

  return kFallbackFps;
}

int validDimensionOrFallback(double dimension, int fallback) {
  if (std::isfinite(dimension) && dimension > 0.0) {
    return static_cast<int>(std::llround(dimension));
  }

  return fallback;
}

std::string backendNameOrFallback(cv::VideoCapture& capture) {
#if defined(CV_VERSION_MAJOR) && CV_VERSION_MAJOR >= 4
  if (capture.isOpened()) {
    try {
      const std::string backendName = capture.getBackendName();
      if (!backendName.empty()) {
        return backendName;
      }
    } catch (const cv::Exception&) {
      return "opencv";
    }
  }
#endif

  return "opencv";
}

}  // namespace

OpenCvCameraSource::OpenCvCameraSource(
    int cameraIndex,
    int requestedWidth,
    int requestedHeight,
    double requestedFps)
    : cameraIndex_(cameraIndex),
      requestedWidth_(requestedWidth),
      requestedHeight_(requestedHeight),
      requestedFps_(requestedFps),
      effectiveFps_(validFpsOrFallback(0.0, requestedFps)),
      width_(requestedWidth),
      height_(requestedHeight) {}

OpenCvCameraSource::~OpenCvCameraSource() {
  stop();
}

bool OpenCvCameraSource::start() {
  stop();

  cv::utils::logging::setLogLevel(cv::utils::logging::LOG_LEVEL_WARNING);

  emittedFrameCount_ = 0;
  failedReadCount_ = 0;
  backendName_ = "opencv";
  width_ = requestedWidth_;
  height_ = requestedHeight_;
  effectiveFps_ = validFpsOrFallback(0.0, requestedFps_);

  if (!capture_.open(cameraIndex_)) {
    isRunning_ = false;
    return false;
  }

  capture_.set(cv::CAP_PROP_FRAME_WIDTH, requestedWidth_);
  capture_.set(cv::CAP_PROP_FRAME_HEIGHT, requestedHeight_);
  capture_.set(cv::CAP_PROP_FPS, requestedFps_);

  if (!capture_.isOpened()) {
    stop();
    return false;
  }

  width_ = validDimensionOrFallback(
      capture_.get(cv::CAP_PROP_FRAME_WIDTH), requestedWidth_);
  height_ = validDimensionOrFallback(
      capture_.get(cv::CAP_PROP_FRAME_HEIGHT), requestedHeight_);
  effectiveFps_ = validFpsOrFallback(
      capture_.get(cv::CAP_PROP_FPS), requestedFps_);
  backendName_ = backendNameOrFallback(capture_);
  isRunning_ = true;
  return true;
}

void OpenCvCameraSource::stop() {
  if (capture_.isOpened()) {
    capture_.release();
  }

  isRunning_ = false;
}

bool OpenCvCameraSource::nextFrame(CameraFrame& frame) {
  if (!isRunning_ || !capture_.isOpened()) {
    return false;
  }

  cv::Mat frameMat;
  if (!capture_.read(frameMat) || frameMat.empty()) {
    ++failedReadCount_;
    return false;
  }

  width_ = frameMat.cols;
  height_ = frameMat.rows;
  effectiveFps_ = validFpsOrFallback(
      capture_.get(cv::CAP_PROP_FPS), effectiveFps_);

  frame = CameraFrame{
      static_cast<int>(emittedFrameCount_),
      timestampForSequence(emittedFrameCount_, effectiveFps_),
      width_,
      height_,
      effectiveFps_,
      frameMat,
  };

  ++emittedFrameCount_;
  return true;
}

CameraSourceDiagnostics OpenCvCameraSource::diagnostics() const {
  return CameraSourceDiagnostics{
      "opencv-camera-source",
      isRunning_ && capture_.isOpened(),
      width_,
      height_,
      effectiveFps_,
      emittedFrameCount_,
      cameraIndex_,
      failedReadCount_,
      backendName_,
  };
}

}  // namespace lvk::tracker
