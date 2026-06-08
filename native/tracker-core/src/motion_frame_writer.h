#pragma once

#include "tracker.h"

#include <ostream>

namespace lvk::tracker {

void writeMotionFrameJson(std::ostream &output, const TrackingSample &sample);

} // namespace lvk::tracker
