// v0.13.0 (#570): deterministic, standard-library-only smoke for
// createMediaPipeHelperRouteConfig(). Never spawns a child, touches the
// filesystem beyond a lexical path parse inside the production code under
// test, opens a camera, or uses the network. Every assertion folds into one
// aggregate boolean so no private synthetic path value can ever reach
// stdout/stderr -- only the two fixed generic lines below are ever printed.
#include "mediapipe_helper_route_config.h"

#include <cstdio>
#include <string>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

using lvk::tracker::createMediaPipeHelperRouteConfig;
using lvk::tracker::HelperInvocationMode;
using lvk::tracker::HelperSessionConfig;
using lvk::tracker::HelperStderrPolicy;
using lvk::tracker::kMediaPipeFaceLandmarkerReadySource;
using lvk::tracker::kMediaPipeHelperRoutePathMaxBytes;
using lvk::tracker::kMediaPipeHelperRouteReadyTimeoutMs;
using lvk::tracker::MediaPipeHelperRouteConfigInput;

#ifdef _WIN32
const std::string kValidInterpreter = "C:\\lvk test\\python.exe";
const std::string kValidScript =
    "D:\\lvk helpers\\face_landmarker_helper_session.py";
const std::string kValidModel = "E:\\lvk models\\face landmarker.task";
const std::string kDottedInterpreter = "C:\\lvk test\\.\\sub\\..\\python.exe";
const std::string kDottedScript =
    "D:\\lvk helpers\\.\\sub\\..\\face_landmarker_helper_session.py";
const std::string kDottedModel =
    "E:\\lvk models\\.\\sub\\..\\face landmarker.task";
const std::string kBoundaryAbsolutePrefix = "C:\\";
#else
const std::string kValidInterpreter = "/lvk test/python";
const std::string kValidScript =
    "/lvk helpers/face_landmarker_helper_session.py";
const std::string kValidModel = "/lvk models/face landmarker.task";
const std::string kDottedInterpreter = "/lvk test/./sub/../python";
const std::string kDottedScript =
    "/lvk helpers/./sub/../face_landmarker_helper_session.py";
const std::string kDottedModel =
    "/lvk models/./sub/../face landmarker.task";
const std::string kBoundaryAbsolutePrefix = "/";
#endif

const std::string kRelativePath = "relative/path/example";

std::string makeAbsoluteStringOfSize(std::size_t totalBytes) {
  std::string value = kBoundaryAbsolutePrefix;
  value.append(totalBytes - value.size(), 'a');
  return value;
}

std::string withEmbeddedByte(const std::string& base, char byte) {
  std::string tainted = base;
  tainted.insert(tainted.size() / 2, 1, byte);
  return tainted;
}

bool checkValidConfiguration() {
  MediaPipeHelperRouteConfigInput input{
      kValidInterpreter, kValidScript, kValidModel};
  auto result = createMediaPipeHelperRouteConfig(input);
  if (!result.has_value()) {
    return false;
  }

  const HelperSessionConfig& config = *result;
  bool ok = true;
  ok = ok && (config.executablePath == kValidInterpreter);
  ok = ok && (config.invocationMode == HelperInvocationMode::ExactArguments);
  ok = ok && (config.exactArguments.size() == 4);
  if (config.exactArguments.size() == 4) {
    ok = ok && (config.exactArguments[0] == "-B");
    ok = ok && (config.exactArguments[1] == kValidScript);
    ok = ok && (config.exactArguments[2] == "--model-asset-path");
    ok = ok && (config.exactArguments[3] == kValidModel);
  } else {
    ok = false;
  }
  ok = ok &&
       (config.expectedReadySource == kMediaPipeFaceLandmarkerReadySource);
  ok = ok && (config.enableFrameTransport == true);
  // v0.13.0 (#580): the MediaPipe route is the sole owner that selects the
  // bounded opaque discard stderr policy for genuine native-library
  // diagnostics.
  ok = ok && (config.stderrPolicy == HelperStderrPolicy::BoundedOpaqueDiscard);
  ok = ok && config.extraArgs.empty();
  return ok;
}

// v0.13.0 (#580): a default-constructed HelperSessionConfig must keep the
// strict prefixed-diagnostics policy, proving the route factory explicitly
// overrides the default rather than the default having changed for all
// sessions.
bool checkDefaultStderrPolicyStrict() {
  HelperSessionConfig defaults;
  return defaults.stderrPolicy == HelperStderrPolicy::StrictPrefixedDiagnostics;
}

bool checkDefaultPreservation() {
  MediaPipeHelperRouteConfigInput input{
      kValidInterpreter, kValidScript, kValidModel};
  auto result = createMediaPipeHelperRouteConfig(input);
  if (!result.has_value()) {
    return false;
  }

  // v0.13.0 (#582): readyTimeoutMs is the one deliberate exception -- proven
  // separately by checkReadyTimeoutOverride() below -- every other bounded
  // wait stays byte-for-byte at the generic HelperSessionConfig default.
  const HelperSessionConfig& config = *result;
  HelperSessionConfig defaults;
  bool ok = true;
  ok = ok && (config.resultTimeoutMs == defaults.resultTimeoutMs);
  ok = ok && (config.stopTimeoutMs == defaults.stopTimeoutMs);
  ok = ok && (config.frameTimeoutMs == defaults.frameTimeoutMs);
  ok = ok && (config.frameCancelTimeoutMs == defaults.frameCancelTimeoutMs);
  ok = ok && (config.launchTimeoutMs == defaults.launchTimeoutMs);
  return ok;
}

// v0.13.0 (#582): the route factory is the sole selector of the fixed,
// bounded MediaPipe-route ready timeout; the generic HelperSessionConfig
// default (asserted separately above/elsewhere) must stay unchanged for
// every other caller.
bool checkReadyTimeoutOverride() {
  MediaPipeHelperRouteConfigInput input{
      kValidInterpreter, kValidScript, kValidModel};
  auto result = createMediaPipeHelperRouteConfig(input);
  if (!result.has_value()) {
    return false;
  }

  const HelperSessionConfig& config = *result;
  HelperSessionConfig defaults;
  bool ok = true;
  ok = ok && (config.readyTimeoutMs == kMediaPipeHelperRouteReadyTimeoutMs);
  ok = ok && (config.readyTimeoutMs != defaults.readyTimeoutMs);
  return ok;
}

bool checkMissingValues() {
  bool ok = true;
  ok = ok &&
       !createMediaPipeHelperRouteConfig({"", kValidScript, kValidModel})
            .has_value();
  ok = ok &&
       !createMediaPipeHelperRouteConfig({kValidInterpreter, "", kValidModel})
            .has_value();
  ok = ok &&
       !createMediaPipeHelperRouteConfig({kValidInterpreter, kValidScript, ""})
            .has_value();
  return ok;
}

bool checkRelativeValues() {
  bool ok = true;
  ok = ok && !createMediaPipeHelperRouteConfig(
                 {kRelativePath, kValidScript, kValidModel})
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(
                 {kValidInterpreter, kRelativePath, kValidModel})
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(
                 {kValidInterpreter, kValidScript, kRelativePath})
                  .has_value();
  return ok;
}

bool checkControlBytes() {
  constexpr char kControlBytes[] = {0x00, 0x0D, 0x0A, 0x09, 0x7F};
  bool ok = true;
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(
                   {withEmbeddedByte(kValidInterpreter, byte), kValidScript,
                    kValidModel})
                    .has_value();
  }
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(
                   {kValidInterpreter, withEmbeddedByte(kValidScript, byte),
                    kValidModel})
                    .has_value();
  }
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(
                   {kValidInterpreter, kValidScript,
                    withEmbeddedByte(kValidModel, byte)})
                    .has_value();
  }
  return ok;
}

bool checkExactBound() {
  const std::string big = makeAbsoluteStringOfSize(
      kMediaPipeHelperRoutePathMaxBytes);
  bool ok = true;

  {
    auto result =
        createMediaPipeHelperRouteConfig({big, kValidScript, kValidModel});
    ok = ok && result.has_value();
    ok = ok && result.has_value() && (result->executablePath == big);
  }
  {
    auto result =
        createMediaPipeHelperRouteConfig({kValidInterpreter, big, kValidModel});
    ok = ok && result.has_value();
    ok = ok && result.has_value() && (result->exactArguments.size() == 4);
    ok = ok && result.has_value() && (result->exactArguments.size() == 4) &&
        (result->exactArguments[1] == big);
  }
  {
    auto result = createMediaPipeHelperRouteConfig(
        {kValidInterpreter, kValidScript, big});
    ok = ok && result.has_value();
    ok = ok && result.has_value() && (result->exactArguments.size() == 4);
    ok = ok && result.has_value() && (result->exactArguments.size() == 4) &&
        (result->exactArguments[3] == big);
  }

  return ok;
}

bool checkBoundPlusOne() {
  const std::string tooBig = makeAbsoluteStringOfSize(
      kMediaPipeHelperRoutePathMaxBytes + 1);
  bool ok = true;
  ok = ok &&
       !createMediaPipeHelperRouteConfig({tooBig, kValidScript, kValidModel})
            .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(
                 {kValidInterpreter, tooBig, kValidModel})
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(
                 {kValidInterpreter, kValidScript, tooBig})
                  .has_value();
  return ok;
}

bool checkNoNormalization() {
  auto result = createMediaPipeHelperRouteConfig(
      {kDottedInterpreter, kDottedScript, kDottedModel});
  if (!result.has_value()) {
    return false;
  }

  bool ok = true;
  ok = ok && (result->executablePath == kDottedInterpreter);
  ok = ok && (result->exactArguments.size() == 4);
  if (result->exactArguments.size() == 4) {
    ok = ok && (result->exactArguments[1] == kDottedScript);
    ok = ok && (result->exactArguments[3] == kDottedModel);
  } else {
    ok = false;
  }
  return ok;
}

bool checkNoSyntheticArgv() {
  auto result = createMediaPipeHelperRouteConfig(
      {kValidInterpreter, kValidScript, kValidModel});
  if (!result.has_value()) {
    return false;
  }

  for (const std::string& argument : result->exactArguments) {
    if (argument == "--session" || argument == "--session-frame-mode") {
      return false;
    }
  }
  return true;
}

}  // namespace

int main() {
#ifdef _WIN32
  // Ensures the fixed success/failure lines below stay exactly one literal
  // '\n' byte instead of being translated to CRLF by a text-mode stdout.
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif

  bool ok = true;
  ok = checkValidConfiguration() && ok;
  ok = checkDefaultStderrPolicyStrict() && ok;
  ok = checkDefaultPreservation() && ok;
  ok = checkReadyTimeoutOverride() && ok;
  ok = checkMissingValues() && ok;
  ok = checkRelativeValues() && ok;
  ok = checkControlBytes() && ok;
  ok = checkExactBound() && ok;
  ok = checkBoundPlusOne() && ok;
  ok = checkNoNormalization() && ok;
  ok = checkNoSyntheticArgv() && ok;

  if (ok) {
    std::fputs("mediapipe-helper-route-config smoke OK\n", stdout);
    return 0;
  }

  std::fputs("mediapipe-helper-route-config smoke failed.\n", stderr);
  return 1;
}
