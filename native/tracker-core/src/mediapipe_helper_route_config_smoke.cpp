// v0.13.0 (#570): deterministic, standard-library-only smoke for
// createMediaPipeHelperRouteConfig(). Never spawns a child, touches the
// filesystem beyond a lexical path parse inside the production code under
// test, opens a camera, or uses the network. P2-C adds the native FNV
// library path checks; the only OS query is the running-executable path
// lookup inside resolveMediaPipeHelperNativeFnvLibraryPath() (never a load
// or existence check of the library). Every assertion folds into one
// aggregate boolean so no private synthetic path value can ever reach
// stdout/stderr -- only the two fixed generic lines below are ever printed.
#include "mediapipe_helper_route_config.h"

#include <cstdio>
#include <optional>
#include <string>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
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
const std::string kValidLibrary = "F:\\lvk build\\Release\\lvk-fnv1a32.dll";
const std::string kDottedInterpreter = "C:\\lvk test\\.\\sub\\..\\python.exe";
const std::string kDottedScript =
    "D:\\lvk helpers\\.\\sub\\..\\face_landmarker_helper_session.py";
const std::string kDottedModel =
    "E:\\lvk models\\.\\sub\\..\\face landmarker.task";
const std::string kBoundaryAbsolutePrefix = "C:\\";
const std::string kLibrarySuffix = "\\lvk-fnv1a32.dll";
#else
const std::string kValidInterpreter = "/lvk test/python";
const std::string kValidScript =
    "/lvk helpers/face_landmarker_helper_session.py";
const std::string kValidModel = "/lvk models/face landmarker.task";
const std::string kValidLibrary = "/lvk build/liblvk-fnv1a32.so";
const std::string kDottedInterpreter = "/lvk test/./sub/../python";
const std::string kDottedScript =
    "/lvk helpers/./sub/../face_landmarker_helper_session.py";
const std::string kDottedModel =
    "/lvk models/./sub/../face landmarker.task";
const std::string kBoundaryAbsolutePrefix = "/";
const std::string kLibrarySuffix = "/liblvk-fnv1a32.so";
#endif

const std::string kRelativePath = "relative/path/example";

// P2-C: every input carries an explicit native FNV library path; a test that
// omits it would only ever exercise the empty-library rejection.
MediaPipeHelperRouteConfigInput makeInput(
    const std::string& interpreter,
    const std::string& script,
    const std::string& model,
    const std::string& library = kValidLibrary) {
  MediaPipeHelperRouteConfigInput input;
  input.pythonInterpreterPath = interpreter;
  input.helperScriptPath = script;
  input.modelAssetPath = model;
  input.nativeFnvLibraryPath = library;
  return input;
}

std::string makeAbsoluteStringOfSize(std::size_t totalBytes) {
  std::string value = kBoundaryAbsolutePrefix;
  value.append(totalBytes - value.size(), 'a');
  return value;
}

// An absolute, correctly named library path of exactly totalBytes bytes.
std::string makeLibraryPathOfSize(std::size_t totalBytes) {
  std::string value = kBoundaryAbsolutePrefix;
  value.append(totalBytes - value.size() - kLibrarySuffix.size(), 'a');
  value += kLibrarySuffix;
  return value;
}

std::string withEmbeddedByte(const std::string& base, char byte) {
  std::string tainted = base;
  tainted.insert(tainted.size() / 2, 1, byte);
  return tainted;
}

bool checkValidConfiguration() {
  MediaPipeHelperRouteConfigInput input = makeInput(kValidInterpreter, kValidScript, kValidModel);
  auto result = createMediaPipeHelperRouteConfig(input);
  if (!result.has_value()) {
    return false;
  }

  const HelperSessionConfig& config = *result;
  bool ok = true;
  ok = ok && (config.executablePath == kValidInterpreter);
  ok = ok && (config.invocationMode == HelperInvocationMode::ExactArguments);
  ok = ok && (config.exactArguments.size() == 6);
  if (config.exactArguments.size() == 6) {
    ok = ok && (config.exactArguments[0] == "-B");
    ok = ok && (config.exactArguments[1] == kValidScript);
    ok = ok && (config.exactArguments[2] == "--model-asset-path");
    ok = ok && (config.exactArguments[3] == kValidModel);
    ok = ok && (config.exactArguments[4] == "--native-fnv-library-path");
    ok = ok && (config.exactArguments[5] == kValidLibrary);
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
  MediaPipeHelperRouteConfigInput input = makeInput(kValidInterpreter, kValidScript, kValidModel);
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

// v0.13.0 (#582 review correction): locks the exact generic
// HelperSessionConfig::readyTimeoutMs default (2000ms) independently from
// the deliberate MediaPipe-route override proven by
// checkReadyTimeoutOverride() below. checkDefaultPreservation() above
// intentionally excludes readyTimeoutMs from its equality checks -- this is
// the dedicated proof that the excluded default itself has not silently
// drifted.
bool checkGenericReadyTimeoutDefault() {
  HelperSessionConfig defaults;
  return defaults.readyTimeoutMs == 2000;
}

// v0.13.0 (#582): the route factory is the sole selector of the fixed,
// bounded MediaPipe-route ready timeout; the generic HelperSessionConfig
// default (asserted separately above/elsewhere) must stay unchanged for
// every other caller.
bool checkReadyTimeoutOverride() {
  MediaPipeHelperRouteConfigInput input = makeInput(kValidInterpreter, kValidScript, kValidModel);
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
       !createMediaPipeHelperRouteConfig(makeInput("", kValidScript, kValidModel))
            .has_value();
  ok = ok &&
       !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, "", kValidModel))
            .has_value();
  ok = ok &&
       !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kValidScript, ""))
            .has_value();
  return ok;
}

bool checkRelativeValues() {
  bool ok = true;
  ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kRelativePath, kValidScript, kValidModel))
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kRelativePath, kValidModel))
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kValidScript, kRelativePath))
                  .has_value();
  return ok;
}

bool checkControlBytes() {
  constexpr char kControlBytes[] = {0x00, 0x0D, 0x0A, 0x09, 0x7F};
  bool ok = true;
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(makeInput(withEmbeddedByte(kValidInterpreter, byte), kValidScript, kValidModel))
                    .has_value();
  }
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, withEmbeddedByte(kValidScript, byte), kValidModel))
                    .has_value();
  }
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kValidScript, withEmbeddedByte(kValidModel, byte)))
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
        createMediaPipeHelperRouteConfig(makeInput(big, kValidScript, kValidModel));
    ok = ok && result.has_value();
    ok = ok && result.has_value() && (result->executablePath == big);
  }
  {
    auto result =
        createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, big, kValidModel));
    ok = ok && result.has_value();
    ok = ok && result.has_value() && (result->exactArguments.size() == 6);
    ok = ok && result.has_value() && (result->exactArguments.size() == 6) &&
        (result->exactArguments[1] == big);
  }
  {
    auto result = createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kValidScript, big));
    ok = ok && result.has_value();
    ok = ok && result.has_value() && (result->exactArguments.size() == 6);
    ok = ok && result.has_value() && (result->exactArguments.size() == 6) &&
        (result->exactArguments[3] == big);
  }

  return ok;
}

bool checkBoundPlusOne() {
  const std::string tooBig = makeAbsoluteStringOfSize(
      kMediaPipeHelperRoutePathMaxBytes + 1);
  bool ok = true;
  ok = ok &&
       !createMediaPipeHelperRouteConfig(makeInput(tooBig, kValidScript, kValidModel))
            .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, tooBig, kValidModel))
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kValidScript, tooBig))
                  .has_value();
  return ok;
}

bool checkNoNormalization() {
  auto result = createMediaPipeHelperRouteConfig(makeInput(kDottedInterpreter, kDottedScript, kDottedModel));
  if (!result.has_value()) {
    return false;
  }

  bool ok = true;
  ok = ok && (result->executablePath == kDottedInterpreter);
  ok = ok && (result->exactArguments.size() == 6);
  if (result->exactArguments.size() == 6) {
    ok = ok && (result->exactArguments[1] == kDottedScript);
    ok = ok && (result->exactArguments[3] == kDottedModel);
  } else {
    ok = false;
  }
  return ok;
}

bool checkNoSyntheticArgv() {
  auto result = createMediaPipeHelperRouteConfig(makeInput(kValidInterpreter, kValidScript, kValidModel));
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

// --- P2-C: native FNV-1a32 library path --------------------------------------

bool checkNativeFnvLibraryMissingRelativeControl() {
  bool ok = true;
  ok = ok && !createMediaPipeHelperRouteConfig(
                 makeInput(kValidInterpreter, kValidScript, kValidModel, ""))
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(
                 makeInput(kValidInterpreter, kValidScript, kValidModel,
                           kRelativePath))
                  .has_value();
  ok = ok && !createMediaPipeHelperRouteConfig(
                 makeInput(kValidInterpreter, kValidScript, kValidModel,
                           kLibrarySuffix.substr(1)))
                  .has_value();
  constexpr char kControlBytes[] = {0x00, 0x0D, 0x0A, 0x09, 0x7F};
  for (char byte : kControlBytes) {
    ok = ok && !createMediaPipeHelperRouteConfig(
                   makeInput(kValidInterpreter, kValidScript, kValidModel,
                             withEmbeddedByte(kValidLibrary, byte)))
                    .has_value();
  }
  return ok;
}

bool checkNativeFnvLibraryBound() {
  bool ok = true;
  const std::string exact =
      makeLibraryPathOfSize(kMediaPipeHelperRoutePathMaxBytes);
  auto result = createMediaPipeHelperRouteConfig(
      makeInput(kValidInterpreter, kValidScript, kValidModel, exact));
  ok = ok && result.has_value() && (result->exactArguments.size() == 6) &&
       (result->exactArguments[5] == exact);

  const std::string tooBig =
      makeLibraryPathOfSize(kMediaPipeHelperRoutePathMaxBytes + 1);
  ok = ok && !createMediaPipeHelperRouteConfig(
                 makeInput(kValidInterpreter, kValidScript, kValidModel, tooBig))
                  .has_value();
  return ok;
}

// The library must be named exactly by the platform-fixed filename and be
// shaped the way the helper's loader accepts it.
bool checkNativeFnvLibraryShape() {
#ifdef _WIN32
  const std::string rejected[] = {
      "F:\\lvk build\\Release\\other.dll",
      "F:\\lvk build\\Release\\xlvk-fnv1a32.dll",
      "F:\\lvk build\\Release\\lvk-fnv1a32.dll.bak",
      "F:\\lvk build\\Release\\LVK-FNV1A32.DLL",
      "F:\\lvk build\\Release\\liblvk-fnv1a32.so",
      "F:/lvk build/Release/lvk-fnv1a32.dll",
      "F:\\lvk build/Release\\lvk-fnv1a32.dll",
      "\\\\server\\share\\lvk-fnv1a32.dll",
      "\\\\?\\F:\\lvk build\\lvk-fnv1a32.dll",
      "\\\\.\\F:\\lvk build\\lvk-fnv1a32.dll",
      "\\lvk build\\lvk-fnv1a32.dll",
      "F:lvk-fnv1a32.dll",
      "1:\\lvk build\\lvk-fnv1a32.dll",
  };
  const std::string accepted[] = {
      "C:\\lvk-fnv1a32.dll",
      "f:\\lvk build\\Debug\\lvk-fnv1a32.dll",
  };
#else
  const std::string rejected[] = {
      "/lvk build/other.so",
      "/lvk build/xliblvk-fnv1a32.so",
      "/lvk build/liblvk-fnv1a32.so.1",
      "/lvk build/lvk-fnv1a32.dll",
      "/lvk build/LIBLVK-FNV1A32.SO",
      "/lvk build/liblvk-fnv1a32.so/",
  };
  const std::string accepted[] = {
      "/liblvk-fnv1a32.so",
      "/lvk build/Debug/liblvk-fnv1a32.so",
  };
#endif
  bool ok = true;
  for (const std::string& value : rejected) {
    ok = ok && !createMediaPipeHelperRouteConfig(
                   makeInput(kValidInterpreter, kValidScript, kValidModel, value))
                    .has_value();
  }
  for (const std::string& value : accepted) {
    auto result = createMediaPipeHelperRouteConfig(
        makeInput(kValidInterpreter, kValidScript, kValidModel, value));
    ok = ok && result.has_value() && (result->exactArguments.size() == 6) &&
         (result->exactArguments[5] == value);
  }
  return ok;
}

#ifdef _WIN32

// Independent reference conversion (ACP -> UTF-16) used only to prove that a
// derived narrow path decodes back to the exact expected UTF-16 path, i.e.
// that CreateProcessA hands the child the identical path.
std::optional<std::wstring> decodeActiveCodePage(const std::string& narrow) {
  const int length = MultiByteToWideChar(
      CP_ACP, MB_ERR_INVALID_CHARS, narrow.data(),
      static_cast<int>(narrow.size()), nullptr, 0);
  if (length <= 0) {
    return std::nullopt;
  }
  std::wstring wide(static_cast<std::size_t>(length), L'\0');
  if (MultiByteToWideChar(CP_ACP, MB_ERR_INVALID_CHARS, narrow.data(),
                          static_cast<int>(narrow.size()), wide.data(),
                          length) != length) {
    return std::nullopt;
  }
  return wide;
}

bool derivesExactly(const std::wstring& executable, const std::string& expected) {
  const auto derived =
      lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(executable);
  return derived.has_value() && *derived == expected;
}

// When derivation succeeds, its narrow result must round-trip to exactly the
// expected UTF-16 library path.
bool derivedRoundTripsOrFailsClosed(const std::wstring& executable,
                                    const std::wstring& expectedLibrary,
                                    bool& derivedOut) {
  const auto derived =
      lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(executable);
  derivedOut = derived.has_value();
  if (!derived.has_value()) {
    return true;
  }
  const auto decoded = decodeActiveCodePage(*derived);
  return decoded.has_value() && *decoded == expectedLibrary;
}

bool checkNativeFnvLibraryDerivation() {
  bool ok = true;
  ok = ok && derivesExactly(L"C:\\lvk build\\Release\\lvk-tracker-core.exe",
                            "C:\\lvk build\\Release\\lvk-fnv1a32.dll");
  ok = ok && derivesExactly(L"C:\\lvk-tracker-core.exe", "C:\\lvk-fnv1a32.dll");
  ok = ok && derivesExactly(L"d:\\a\\b c\\d\\any-name.exe",
                            "d:\\a\\b c\\d\\lvk-fnv1a32.dll");

  const std::wstring rejected[] = {
      L"",
      L"lvk-tracker-core.exe",
      L"C:lvk-tracker-core.exe",
      L"\\lvk build\\lvk-tracker-core.exe",
      L"\\\\server\\share\\lvk-tracker-core.exe",
      L"\\\\?\\C:\\lvk build\\lvk-tracker-core.exe",
      L"\\\\.\\C:\\lvk build\\lvk-tracker-core.exe",
      L"C:/lvk build/lvk-tracker-core.exe",
      L"C:\\lvk build/Release\\lvk-tracker-core.exe",
      L"C:\\lvk build\\",
      L"C:\\lvk\tbuild\\lvk-tracker-core.exe",
      L"C:\\lvk\nbuild\\lvk-tracker-core.exe",
  };
  for (const std::wstring& value : rejected) {
    ok = ok &&
         !lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(value)
              .has_value();
  }

  // Unicode: U+30BD (KATAKANA SO) encodes as 0x83 0x5C in CP932 -- its trail
  // byte equals '\\'. Splitting in the UTF-16 domain keeps it intact.
  bool sawKatakana = false;
  ok = ok && derivedRoundTripsOrFailsClosed(
                 L"C:\\lvk \u30BD build\\Release\\lvk-tracker-core.exe",
                 L"C:\\lvk \u30BD build\\Release\\lvk-fnv1a32.dll", sawKatakana);
  // U+00E9 has a CP932 best-fit mapping to 'e'; no best-fit is allowed.
  bool sawAcute = false;
  ok = ok && derivedRoundTripsOrFailsClosed(
                 L"C:\\caf\u00E9\\lvk-tracker-core.exe",
                 L"C:\\caf\u00E9\\lvk-fnv1a32.dll", sawAcute);
  // U+1F600 (surrogate pair) is representable only in a UTF-8 ANSI code
  // page.
  bool sawEmoji = false;
  ok = ok && derivedRoundTripsOrFailsClosed(
                 L"C:\\lvk \U0001F600\\lvk-tracker-core.exe",
                 L"C:\\lvk \U0001F600\\lvk-fnv1a32.dll", sawEmoji);
  // An unpaired surrogate is never representable.
  ok = ok && !lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(
                  std::wstring(L"C:\\lvk \xD800\\lvk-tracker-core.exe"))
                  .has_value();

  const UINT codePage = GetACP();
  if (codePage == CP_UTF8) {
    ok = ok && sawKatakana && sawAcute && sawEmoji;
  } else {
    ok = ok && !sawEmoji;
  }
  if (codePage == 932) {
    ok = ok && sawKatakana && !sawAcute;
    const auto derived = lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(
        L"C:\\\u30BD\\lvk-tracker-core.exe");
    ok = ok && derived.has_value() &&
         *derived == std::string("C:\\\x83\x5C\\lvk-fnv1a32.dll");
  }
  if (codePage == 1252) {
    ok = ok && sawAcute && !sawKatakana;
  }
  return ok;
}

#elif defined(__linux__)

bool derivesExactly(const std::string& executable, const std::string& expected) {
  const auto derived =
      lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(executable);
  return derived.has_value() && *derived == expected;
}

bool checkNativeFnvLibraryDerivation() {
  bool ok = true;
  ok = ok && derivesExactly("/opt/lvk build/lvk-tracker-core",
                            "/opt/lvk build/liblvk-fnv1a32.so");
  ok = ok && derivesExactly("/lvk-tracker-core", "/liblvk-fnv1a32.so");
  // Raw bytes pass through unchanged (UTF-8 U+30BD).
  ok = ok && derivesExactly("/opt/\xE3\x82\xBD/lvk-tracker-core",
                            "/opt/\xE3\x82\xBD/liblvk-fnv1a32.so");

  std::string tooLong = "/";
  tooLong.append(kMediaPipeHelperRoutePathMaxBytes, 'a');
  const std::string rejected[] = {
      "",
      "lvk-tracker-core",
      "relative/lvk-tracker-core",
      "/opt/lvk build/",
      "/opt/lvk build/lvk-tracker-core (deleted)",
      "/opt/lvk\tbuild/lvk-tracker-core",
      tooLong,
  };
  for (const std::string& value : rejected) {
    ok = ok &&
         !lvk::tracker::deriveMediaPipeHelperNativeFnvLibraryPath(value)
              .has_value();
  }
  return ok;
}

#else

bool checkNativeFnvLibraryDerivation() {
  return !lvk::tracker::resolveMediaPipeHelperNativeFnvLibraryPath()
              .has_value();
}

#endif

// The real OS query for this running smoke executable: must succeed on a
// supported platform, name the fixed filename, and satisfy the factory.
// (The bridge smoke separately proves the resolved path is the actually
// built library by loading it in a real helper child.)
bool checkNativeFnvLibraryResolution() {
#if LVK_MEDIAPIPE_HELPER_NATIVE_FNV_SUPPORTED
  const auto resolved =
      lvk::tracker::resolveMediaPipeHelperNativeFnvLibraryPath();
  if (!resolved.has_value()) {
    return false;
  }
  bool ok = true;
  ok = ok && resolved->size() > kLibrarySuffix.size();
  ok = ok && resolved->compare(resolved->size() - kLibrarySuffix.size(),
                               kLibrarySuffix.size(), kLibrarySuffix) == 0;
  auto result = createMediaPipeHelperRouteConfig(
      makeInput(kValidInterpreter, kValidScript, kValidModel, *resolved));
  ok = ok && result.has_value() && (result->exactArguments.size() == 6) &&
       (result->exactArguments[5] == *resolved);
  return ok;
#else
  return !lvk::tracker::resolveMediaPipeHelperNativeFnvLibraryPath()
              .has_value();
#endif
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
  ok = checkGenericReadyTimeoutDefault() && ok;
  ok = checkReadyTimeoutOverride() && ok;
  ok = checkMissingValues() && ok;
  ok = checkRelativeValues() && ok;
  ok = checkControlBytes() && ok;
  ok = checkExactBound() && ok;
  ok = checkBoundPlusOne() && ok;
  ok = checkNoNormalization() && ok;
  ok = checkNoSyntheticArgv() && ok;
  ok = checkNativeFnvLibraryMissingRelativeControl() && ok;
  ok = checkNativeFnvLibraryBound() && ok;
  ok = checkNativeFnvLibraryShape() && ok;
  ok = checkNativeFnvLibraryDerivation() && ok;
  ok = checkNativeFnvLibraryResolution() && ok;

  if (ok) {
    std::fputs("mediapipe-helper-route-config smoke OK\n", stdout);
    return 0;
  }

  std::fputs("mediapipe-helper-route-config smoke failed.\n", stderr);
  return 1;
}
