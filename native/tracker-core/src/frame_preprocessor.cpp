#include "frame_preprocessor.h"

namespace lvk::tracker {

PreprocessedFrame NoopFramePreprocessor::process(const CameraFrame& frame) {
#if LVK_HAS_OPENCV
  return PreprocessedFrame{
      frame,
      frame.width,
      frame.height,
      frame.image,
  };
#else
  return PreprocessedFrame{
      frame,
      frame.width,
      frame.height,
  };
#endif
}

}  // namespace lvk::tracker
