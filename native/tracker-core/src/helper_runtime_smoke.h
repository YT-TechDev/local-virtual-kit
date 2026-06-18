#pragma once

#include <iosfwd>
#include <string>

namespace lvk::tracker {

// Smoke-only runtime integration path for H1d. Launches the synthetic helper
// through the existing bounded supervisor, parses only its known compact stdout
// contract, maps helper results through the Native Core-internal mapper, and
// writes existing MotionFrame JSON to motionFrameOutput.
int runHelperRuntimeSmoke(
    const std::string& helperPath,
    int frameCount,
    std::ostream& motionFrameOutput,
    std::ostream& diagnosticsOutput);

}  // namespace lvk::tracker
