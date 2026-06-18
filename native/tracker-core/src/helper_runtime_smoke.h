#pragma once

#include <iosfwd>
#include <string>

namespace lvk::tracker {

enum class HelperRuntimeSmokeCase {
  Normal,
  LaunchFailure,
  NonzeroExit,
  Timeout,
};

struct HelperRuntimeSmokeOptions {
  std::string helperPath;
  int frameCount = 3;
  HelperRuntimeSmokeCase smokeCase = HelperRuntimeSmokeCase::Normal;
};

// Smoke-only runtime integration path for H1d/H1e. Launches the synthetic helper
// through the existing bounded supervisor, parses only its known compact stdout
// contract in the normal case, maps helper results through the Native
// Core-internal mapper, and writes existing MotionFrame JSON to
// motionFrameOutput. Expected failure smoke cases return 0 after emitting one
// safe fallback MotionFrame; unexpected normal-mode failures remain non-zero.
int runHelperRuntimeSmoke(
    const HelperRuntimeSmokeOptions& options,
    std::ostream& motionFrameOutput,
    std::ostream& diagnosticsOutput);

}  // namespace lvk::tracker
