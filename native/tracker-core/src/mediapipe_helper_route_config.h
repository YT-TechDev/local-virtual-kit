#pragma once

#include "helper_process_session.h"

#include <cstddef>
#include <optional>
#include <string>

namespace lvk::tracker {

// v0.13.0 (#570): the route-owned conservative byte bound for each of the
// caller-supplied local paths. Distinct from kHelperMaxLineBytes in
// helper_message.h -- this bounds a path configuration value, not a helper
// protocol line. P2-C applies the same bound to the Native Core-derived
// native FNV-1a32 library path.
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

// P2-C: the platform-fixed filename of the lvk-fnv1a32 shared library (see
// fnv1a32_abi.h) that the MediaPipe helper loads for both of its mandatory
// frame checksum computations. The library is never linked into
// lvk-tracker-core; it is only located next to the running executable and
// handed to the helper. Only Windows and Linux are supported: on any other
// platform no filename exists and the MediaPipe route fails closed.
#if defined(_WIN32)
inline constexpr char kMediaPipeHelperNativeFnvLibraryFileName[] =
    "lvk-fnv1a32.dll";
#define LVK_MEDIAPIPE_HELPER_NATIVE_FNV_SUPPORTED 1
#elif defined(__linux__)
inline constexpr char kMediaPipeHelperNativeFnvLibraryFileName[] =
    "liblvk-fnv1a32.so";
#define LVK_MEDIAPIPE_HELPER_NATIVE_FNV_SUPPORTED 1
#else
#define LVK_MEDIAPIPE_HELPER_NATIVE_FNV_SUPPORTED 0
#endif

// The local paths this route validates independently before composing a
// HelperSessionConfig for the MediaPipe Face Landmarker Python helper. The
// first three are caller-supplied. nativeFnvLibraryPath is NOT a caller
// value: Native Core derives it from its own running executable location
// (resolveMediaPipeHelperNativeFnvLibraryPath() below); no CLI flag,
// environment variable, or Electron setting can supply or override it.
struct MediaPipeHelperRouteConfigInput {
  std::string pythonInterpreterPath;
  std::string helperScriptPath;
  std::string modelAssetPath;
  std::string nativeFnvLibraryPath;
};

// Validates all four input paths and, only on success, returns a complete
// HelperSessionConfig wired for HelperInvocationMode::ExactArguments against
// the MediaPipe Face Landmarker Python helper's private startup contract:
//
//   -B <helper-script> --model-asset-path <model>
//       --native-fnv-library-path <library>
//
// nativeFnvLibraryPath must additionally be platform-shaped (Windows:
// drive-qualified, backslash-only; Linux: begins with '/') and name exactly
// kMediaPipeHelperNativeFnvLibraryFileName. Returns std::nullopt on any
// validation failure, and always on an unsupported platform. Never launches
// a process, touches the filesystem beyond a lexical path parse, reads a
// model, or loads the library.
std::optional<HelperSessionConfig> createMediaPipeHelperRouteConfig(
    const MediaPipeHelperRouteConfigInput& input);

// P2-C: pure, lexical derivation of the native FNV-1a32 library path from an
// already-resolved absolute executable path: the executable's own directory
// joined with kMediaPipeHelperNativeFnvLibraryFileName. Performs no OS query
// and no filesystem access.
//
// Windows: takes the UTF-16 path exactly as the OS reports it and splits on
// the last L'\\' in the UTF-16 domain (never in a multibyte code page, where
// a DBCS trail byte can equal 0x5C). It rejects anything other than a plain
// drive-qualified "X:\..." path (UNC, "\\?\" / "\\.\" device, and forward
// slash forms are rejected, matching helper_native_fnv.py), then converts the
// result to the process ANSI code page -- the encoding the existing
// CreateProcessA launch path uses for every argument -- and requires an exact
// lossless round trip, so the child receives the identical UTF-16 path. A
// path not representable in the active code page fails closed.
//
// Linux: takes the raw byte path (no encoding conversion; the child decodes
// and re-encodes it with the filesystem encoding) and requires a leading
// '/'. A kernel " (deleted)" marker fails closed.
#if defined(_WIN32)
std::optional<std::string> deriveMediaPipeHelperNativeFnvLibraryPath(
    const std::wstring& executablePath);
#elif defined(__linux__)
std::optional<std::string> deriveMediaPipeHelperNativeFnvLibraryPath(
    const std::string& executablePath);
#endif

// P2-C: the only OS query in this route boundary. Resolves the path of the
// RUNNING executable image -- GetModuleFileNameW(nullptr) on Windows,
// readlink("/proc/self/exe") on Linux -- and derives the adjacent library
// path through deriveMediaPipeHelperNativeFnvLibraryPath(). Never consults
// argv[0], the working directory, PATH, or any environment variable, and
// never checks whether the library exists or loads it (the helper's loader
// does that, once, before ready). Returns std::nullopt on any failure and
// always on an unsupported platform.
//
// Trust boundary: the executable's directory is trusted exactly as much as
// the executable itself. Linux /proc/self/exe already resolves symbolic
// links, so the library is expected next to the real binary. Windows
// reports the path through which the image was opened without
// canonicalizing it, so a symbolic link or junction in that path is not
// resolved by Native Core: whatever directory the OS reports is the one
// trusted. Adjacency and the helper's ABI/self-test checks establish
// compatibility only; they never authenticate the binary.
std::optional<std::string> resolveMediaPipeHelperNativeFnvLibraryPath();

}  // namespace lvk::tracker
