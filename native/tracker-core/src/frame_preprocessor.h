#pragma once

#include "camera_source.h"

namespace lvk::tracker {

struct PreprocessedFrame {
  CameraFrame cameraFrame;
  int width;
  int height;
#if LVK_HAS_OPENCV_IMAGE
  cv::Mat image;
#endif
};

class FramePreprocessor {
 public:
  virtual ~FramePreprocessor() = default;

  virtual PreprocessedFrame process(const CameraFrame& frame) = 0;
};

class NoopFramePreprocessor final : public FramePreprocessor {
 public:
  PreprocessedFrame process(const CameraFrame& frame) override;
};

}  // namespace lvk::tracker
