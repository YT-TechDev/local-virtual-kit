#include "mediapipe_helper_route_config.h"

#include "helper_message.h"

#include <cstdint>
#include <filesystem>

namespace lvk::tracker {

namespace {

bool hasRejectedControlByte(const std::string& value) {
  for (unsigned char byte : value) {
    if (byte <= 0x1F || byte == 0x7F) {
      return true;
    }
  }
  return false;
}

// Lexical-only: never calls filesystem::absolute/canonical or touches the
// filesystem. Fails closed on any exception from path construction.
bool isLexicallyAbsolute(const std::string& value) {
  try {
    return std::filesystem::path(value).is_absolute();
  } catch (...) {
    return false;
  }
}

bool isValidHelperRoutePath(const std::string& value) {
  if (value.empty()) {
    return false;
  }
  if (value.size() > kMediaPipeHelperRoutePathMaxBytes) {
    return false;
  }
  if (hasRejectedControlByte(value)) {
    return false;
  }
  if (!isLexicallyAbsolute(value)) {
    return false;
  }
  return true;
}

}  // namespace

std::optional<HelperSessionConfig> createMediaPipeHelperRouteConfig(
    const MediaPipeHelperRouteConfigInput& input) {
  if (!isValidHelperRoutePath(input.pythonInterpreterPath)) {
    return std::nullopt;
  }
  if (!isValidHelperRoutePath(input.helperScriptPath)) {
    return std::nullopt;
  }
  if (!isValidHelperRoutePath(input.modelAssetPath)) {
    return std::nullopt;
  }

  HelperSessionConfig config;
  config.executablePath = input.pythonInterpreterPath;
  config.invocationMode = HelperInvocationMode::ExactArguments;
  config.exactArguments = {
      "-B",
      input.helperScriptPath,
      "--model-asset-path",
      input.modelAssetPath,
  };
  config.expectedReadySource = kMediaPipeFaceLandmarkerReadySource;
  config.enableFrameTransport = true;
  // v0.13.0 (#582): the MediaPipe Face Landmarker child imports MediaPipe and
  // constructs the Face Landmarker runtime/model before emitting ready; the
  // generic 2000ms default is not sized for that cold-start cost. This is the
  // sole route factory allowed to override readyTimeoutMs -- every generic
  // helper session keeps the 2000ms default. See kMediaPipeHelperRouteReadyTimeoutMs
  // for the evidence-based rationale.
  config.readyTimeoutMs = kMediaPipeHelperRouteReadyTimeoutMs;
  // v0.13.0 (#580): the MediaPipe Face Landmarker child inherits a compiled
  // third-party native library that writes its own unprefixed diagnostic lines
  // directly to the stderr file descriptor. Select the bounded opaque discard
  // policy so those genuine diagnostics do not fail the session closed, while
  // still never being parsed, forwarded, or persisted. This is the sole route
  // factory allowed to select the non-default policy; every generic helper
  // session keeps the strict prefixed-diagnostics default.
  config.stderrPolicy = HelperStderrPolicy::BoundedOpaqueDiscard;

  return config;
}

}  // namespace lvk::tracker
