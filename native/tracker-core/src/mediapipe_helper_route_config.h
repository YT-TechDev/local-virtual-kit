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

// v0.13.0 (#582): the route-owned fixed, bounded startup ready-timeout,
// distinct from HelperSessionConfig::readyTimeoutMs's generic 2000ms
// default. The MediaPipe Face Landmarker child performs a real MediaPipe
// import and Face Landmarker runtime/model creation before emitting its
// ready line -- work the generic 2000ms budget was never sized for.
// Sanitized fresh-process evidence (multiple runs, warm OS cache) observed
// ~1.2-1.7s; prior sanitized cold-start evidence observed ~5s. This fixed
// value is set to roughly 2x that prior cold observation for a genuine
// cross-machine safety margin, while staying a bounded, fail-closed
// constant -- never adaptive, retried, or unbounded. Only
// createMediaPipeHelperRouteConfig() selects this value; every other route
// keeps the generic default unchanged.
inline constexpr int kMediaPipeHelperRouteReadyTimeoutMs = 10000;

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
