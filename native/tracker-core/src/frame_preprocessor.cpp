#include "frame_preprocessor.h"

namespace lvk::tracker {

PreprocessedFrame NoopFramePreprocessor::process(const CameraFrame& frame) {
  return PreprocessedFrame{
      frame,
      frame.width,
      frame.height,
  };
}

}  // namespace lvk::tracker
