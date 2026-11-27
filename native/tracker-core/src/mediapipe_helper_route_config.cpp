#include "mediapipe_helper_route_config.h"

#include "helper_message.h"

#include <climits>
#include <cstdint>
#include <filesystem>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#elif defined(__linux__)
#include <unistd.h>
#endif

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

bool endsWith(const std::string& value, const std::string& suffix) {
  return value.size() >= suffix.size() &&
         value.compare(value.size() - suffix.size(), suffix.size(), suffix) ==
             0;
}

// P2-C: lexical validation of the Native Core-derived library path, applied
// on top of the generic route path rules. Mirrors the shape the helper's
// loader (helper_native_fnv.py) accepts, so a path that passes here is never
// rejected there for its form alone.
bool isValidNativeFnvLibraryPath(const std::string& value) {
#if LVK_MEDIAPIPE_HELPER_NATIVE_FNV_SUPPORTED
  if (!isValidHelperRoutePath(value)) {
    return false;
  }
#if defined(_WIN32)
  // Drive-qualified and backslash-only ("X:\..."). '/' (0x2F) is never a
  // DBCS trail byte, so this byte scan is exact in every ANSI code page.
  if (value.size() < 3) {
    return false;
  }
  const unsigned char drive = static_cast<unsigned char>(value[0]);
  const bool driveIsLetter =
      (drive >= 'A' && drive <= 'Z') || (drive >= 'a' && drive <= 'z');
  if (!driveIsLetter || value[1] != ':' || value[2] != '\\') {
    return false;
  }
  if (value.find('/') != std::string::npos) {
    return false;
  }
  const std::string suffix =
      std::string("\\") + kMediaPipeHelperNativeFnvLibraryFileName;
#else
  if (value[0] != '/') {
    return false;
  }
  const std::string suffix =
      std::string("/") + kMediaPipeHelperNativeFnvLibraryFileName;
#endif
  return endsWith(value, suffix);
#else
  (void)value;
  return false;
#endif
}

#if defined(_WIN32)

// The Windows maximum path length in UTF-16 code units (UNICODE_STRING
// bound). GetModuleFileNameW is retried with a doubling buffer up to this
// bound and fails closed beyond it.
constexpr DWORD kMaxExecutablePathWideChars = 32768;

bool isPlainDriveQualifiedWidePath(const std::wstring& path) {
  if (path.size() < 4 || path.size() >= kMaxExecutablePathWideChars) {
    return false;
  }
  const wchar_t drive = path[0];
  const bool driveIsLetter =
      (drive >= L'A' && drive <= L'Z') || (drive >= L'a' && drive <= L'z');
  if (!driveIsLetter || path[1] != L':' || path[2] != L'\\') {
    return false;
  }
  for (const wchar_t unit : path) {
    if (unit == L'/' || unit <= 0x1F || unit == 0x7F) {
      return false;
    }
  }
  return true;
}

// Converts to the process ANSI code page -- the encoding CreateProcessA (the
// existing helper launch path) applies to every argument -- and requires an
// exact lossless round trip. No best-fit mapping, no default character.
std::optional<std::string> toActiveCodePageLossless(const std::wstring& wide) {
  if (wide.empty() || wide.size() > static_cast<std::size_t>(INT_MAX)) {
    return std::nullopt;
  }
  const int wideLength = static_cast<int>(wide.size());
  const bool utf8CodePage = GetACP() == CP_UTF8;
  // CP_UTF8 rejects WC_NO_BEST_FIT_CHARS and a default-character query;
  // WC_ERR_INVALID_CHARS instead fails on any unpaired surrogate.
  const DWORD flags = utf8CodePage ? WC_ERR_INVALID_CHARS : WC_NO_BEST_FIT_CHARS;

  BOOL usedDefaultChar = FALSE;
  BOOL* usedDefaultCharOut = utf8CodePage ? nullptr : &usedDefaultChar;
  const int narrowLength =
      WideCharToMultiByte(CP_ACP, flags, wide.data(), wideLength, nullptr, 0,
                          nullptr, usedDefaultCharOut);
  if (narrowLength <= 0 ||
      static_cast<std::size_t>(narrowLength) > kMediaPipeHelperRoutePathMaxBytes) {
    return std::nullopt;
  }
  if (usedDefaultChar) {
    return std::nullopt;
  }

  std::string narrow(static_cast<std::size_t>(narrowLength), '\0');
  usedDefaultChar = FALSE;
  if (WideCharToMultiByte(CP_ACP, flags, wide.data(), wideLength,
                          narrow.data(), narrowLength, nullptr,
                          usedDefaultCharOut) != narrowLength) {
    return std::nullopt;
  }
  if (usedDefaultChar) {
    return std::nullopt;
  }

  const int roundTripLength = MultiByteToWideChar(
      CP_ACP, MB_ERR_INVALID_CHARS, narrow.data(), narrowLength, nullptr, 0);
  if (roundTripLength != wideLength) {
    return std::nullopt;
  }
  std::wstring roundTrip(static_cast<std::size_t>(roundTripLength), L'\0');
  if (MultiByteToWideChar(CP_ACP, MB_ERR_INVALID_CHARS, narrow.data(),
                          narrowLength, roundTrip.data(),
                          roundTripLength) != roundTripLength) {
    return std::nullopt;
  }
  if (roundTrip != wide) {
    return std::nullopt;
  }
  return narrow;
}

std::optional<std::wstring> queryRunningExecutablePathWide() {
  for (DWORD capacity = 512; capacity <= kMaxExecutablePathWideChars;
       capacity *= 2) {
    std::wstring buffer(static_cast<std::size_t>(capacity), L'\0');
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), capacity);
    if (length == 0) {
      return std::nullopt;
    }
    if (length < capacity) {
      buffer.resize(static_cast<std::size_t>(length));
      return buffer;
    }
    // length == capacity: the path was truncated; retry larger.
  }
  return std::nullopt;
}

#elif defined(__linux__)

// " (deleted)" is appended by the kernel when the running image was
// unlinked; the adjacent directory can then no longer be trusted to hold the
// matching library, so derivation fails closed.
constexpr char kLinuxDeletedImageMarker[] = " (deleted)";

std::optional<std::string> queryRunningExecutablePath() {
  // One extra byte detects truncation: readlink never NUL-terminates and
  // silently truncates to the buffer size.
  std::string buffer(kMediaPipeHelperRoutePathMaxBytes + 1, '\0');
  const ssize_t length =
      ::readlink("/proc/self/exe", buffer.data(), buffer.size());
  if (length <= 0) {
    return std::nullopt;
  }
  if (static_cast<std::size_t>(length) >= buffer.size()) {
    return std::nullopt;
  }
  buffer.resize(static_cast<std::size_t>(length));
  return buffer;
}

#endif

}  // namespace

#if defined(_WIN32)

std::optional<std::string> deriveMediaPipeHelperNativeFnvLibraryPath(
    const std::wstring& executablePath) {
  if (!isPlainDriveQualifiedWidePath(executablePath)) {
    return std::nullopt;
  }
  const std::size_t separator = executablePath.find_last_of(L'\\');
  if (separator == std::wstring::npos || separator < 2 ||
      separator + 1 >= executablePath.size()) {
    return std::nullopt;
  }

  std::wstring libraryPath = executablePath.substr(0, separator + 1);
  for (const char* cursor = kMediaPipeHelperNativeFnvLibraryFileName;
       *cursor != '\0'; ++cursor) {
    libraryPath.push_back(static_cast<wchar_t>(*cursor));
  }

  std::optional<std::string> narrow = toActiveCodePageLossless(libraryPath);
  if (!narrow.has_value() || !isValidNativeFnvLibraryPath(*narrow)) {
    return std::nullopt;
  }
  return narrow;
}

std::optional<std::string> resolveMediaPipeHelperNativeFnvLibraryPath() {
  const std::optional<std::wstring> executablePath =
      queryRunningExecutablePathWide();
  if (!executablePath.has_value()) {
    return std::nullopt;
  }
  return deriveMediaPipeHelperNativeFnvLibraryPath(*executablePath);
}

#elif defined(__linux__)

std::optional<std::string> deriveMediaPipeHelperNativeFnvLibraryPath(
    const std::string& executablePath) {
  if (executablePath.empty() ||
      executablePath.size() > kMediaPipeHelperRoutePathMaxBytes) {
    return std::nullopt;
  }
  if (executablePath[0] != '/' || hasRejectedControlByte(executablePath)) {
    return std::nullopt;
  }
  if (endsWith(executablePath, kLinuxDeletedImageMarker)) {
    return std::nullopt;
  }
  const std::size_t separator = executablePath.find_last_of('/');
  if (separator == std::string::npos ||
      separator + 1 >= executablePath.size()) {
    return std::nullopt;
  }

  std::string libraryPath = executablePath.substr(0, separator + 1);
  libraryPath += kMediaPipeHelperNativeFnvLibraryFileName;
  if (!isValidNativeFnvLibraryPath(libraryPath)) {
    return std::nullopt;
  }
  return libraryPath;
}

std::optional<std::string> resolveMediaPipeHelperNativeFnvLibraryPath() {
  const std::optional<std::string> executablePath =
      queryRunningExecutablePath();
  if (!executablePath.has_value()) {
    return std::nullopt;
  }
  return deriveMediaPipeHelperNativeFnvLibraryPath(*executablePath);
}

#else

std::optional<std::string> resolveMediaPipeHelperNativeFnvLibraryPath() {
  return std::nullopt;
}

#endif

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
  if (!isValidNativeFnvLibraryPath(input.nativeFnvLibraryPath)) {
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
      // P2-C: private, Native Core-derived; see
      // resolveMediaPipeHelperNativeFnvLibraryPath().
      "--native-fnv-library-path",
      input.nativeFnvLibraryPath,
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
