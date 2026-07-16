#pragma once

#include "helper_process_session.h"

#include <cstddef>
#include <optional>
#include <string>

namespace lvk::tracker {

// v0.13.0 (#570): the route-owned conservative byte bound for each of the
// three caller-supplied local paths. Distinct from kHelperMaxLineBytes in
// helper_message.h -- this bounds a path configuration value, not a helper
// protocol line.
inline constexpr std::size_t kMediaPipeHelperRoutePathMaxBytes = 4096;

// The three caller-supplied local paths this route validates independently
// before composing a HelperSessionConfig for the MediaPipe Face Landmarker
// Python helper.
struct MediaPipeHelperRouteConfigInput {
  std::string pythonInterpreterPath;
  std::string helperScriptPath;
  std::string modelAssetPath;
};

// Validates all three input paths and, only on success, returns a complete
// HelperSessionConfig wired for HelperInvocationMode::ExactArguments against
// the MediaPipe Face Landmarker Python helper's
// "--model-asset-path <path>" CLI contract. Returns std::nullopt on any
// validation failure; never launches a process, touches the filesystem
// beyond a lexical path parse, or reads a model.
std::optional<HelperSessionConfig> createMediaPipeHelperRouteConfig(
    const MediaPipeHelperRouteConfigInput& input);

}  // namespace lvk::tracker
