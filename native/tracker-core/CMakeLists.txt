cmake_minimum_required(VERSION 3.16)

project(lvk_tracker_core LANGUAGES CXX)

# std::thread (used by the durable helper-process cleanup registry and, on
# Windows, the bounded frame writer) requires the platform threads library on
# POSIX toolchains. Harmless on MSVC.
set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)

find_package(OpenCV QUIET COMPONENTS core videoio)
set(LVK_HAS_OPENCV_CAMERA ${OpenCV_FOUND})
if(LVK_HAS_OPENCV_CAMERA)
  set(LVK_OPENCV_CAMERA_INCLUDE_DIRS ${OpenCV_INCLUDE_DIRS})
  set(LVK_OPENCV_CAMERA_LIBS ${OpenCV_LIBS})
endif()

find_package(OpenCV QUIET COMPONENTS core imgproc objdetect)
set(LVK_HAS_OPENCV_FACE_DETECTOR ${OpenCV_FOUND})
if(LVK_HAS_OPENCV_FACE_DETECTOR)
  set(LVK_OPENCV_FACE_DETECTOR_INCLUDE_DIRS ${OpenCV_INCLUDE_DIRS})
  set(LVK_OPENCV_FACE_DETECTOR_LIBS ${OpenCV_LIBS})
endif()

if(LVK_HAS_OPENCV_CAMERA)
  set(LVK_OPENCV_CAMERA_STATUS ON)
else()
  set(LVK_OPENCV_CAMERA_STATUS OFF)
endif()

if(LVK_HAS_OPENCV_FACE_DETECTOR)
  set(LVK_OPENCV_FACE_DETECTOR_STATUS ON)
else()
  set(LVK_OPENCV_FACE_DETECTOR_STATUS OFF)
endif()

message(STATUS "LVK Native Core OpenCV feature summary:")
message(STATUS "  LVK OpenCV camera support: ${LVK_OPENCV_CAMERA_STATUS} (components: core + videoio)")
message(STATUS "  LVK OpenCV face detector support: ${LVK_OPENCV_FACE_DETECTOR_STATUS} (components: core + imgproc + objdetect)")

# v0.7.0 MediaPipe Face Landmarker build feasibility probe boundary (#481).
# Disabled by default and does not add MediaPipe find_package, includes,
# libraries, sources, or set LVK_HAS_MEDIAPIPE_FACE_LANDMARKER=1. See
# docs/TRACKING_BACKEND_V0_7_MEDIAPIPE_FEASIBILITY.md: #480 does not approve
# MediaPipe dependency, task/model assets, runtime downloads, or production
# backend selection, so enabling this option fails configure fast instead of
# pretending support exists.
option(LVK_ENABLE_MEDIAPIPE_FACE_LANDMARKER_PROBE "Enable LVK MediaPipe Face Landmarker feasibility probe (no task/model assets bundled)" OFF)
if(LVK_ENABLE_MEDIAPIPE_FACE_LANDMARKER_PROBE)
  message(FATAL_ERROR "LVK_ENABLE_MEDIAPIPE_FACE_LANDMARKER_PROBE is not implemented in v0.7.0: #480 does not approve MediaPipe dependency, task/model assets, runtime downloads, or production backend selection.")
endif()

add_executable(lvk-tracker-core
  src/camera_source.cpp
  src/face_detector.cpp
  src/face_tracking_pipeline.cpp
  src/frame_preprocessor.cpp
  src/helper_frame_packet.cpp
  src/helper_message.cpp
  src/helper_process_cleanup_registry.cpp
  src/helper_process_session.cpp
  src/helper_process_supervisor.cpp
  src/helper_runtime_smoke.cpp
  src/helper_tracking_result.cpp
  src/main.cpp
  src/mediapipe_helper_route_config.cpp
  src/motion_frame_writer.cpp
  src/tracker.cpp
  src/tracking_backend.cpp
  src/tracking_sample_factory.cpp
)

target_compile_features(lvk-tracker-core PRIVATE cxx_std_17)
target_link_libraries(lvk-tracker-core PRIVATE Threads::Threads)


if(LVK_HAS_OPENCV_CAMERA OR LVK_HAS_OPENCV_FACE_DETECTOR)
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV_IMAGE=1)
else()
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV_IMAGE=0)
endif()

if(LVK_HAS_OPENCV_CAMERA)
  target_sources(lvk-tracker-core PRIVATE src/opencv_camera_source.cpp)
  target_include_directories(lvk-tracker-core PRIVATE ${LVK_OPENCV_CAMERA_INCLUDE_DIRS})
  target_link_libraries(lvk-tracker-core PRIVATE ${LVK_OPENCV_CAMERA_LIBS})
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV_CAMERA=1)
else()
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV_CAMERA=0)
endif()

if(LVK_HAS_OPENCV_FACE_DETECTOR)
  target_sources(lvk-tracker-core PRIVATE src/opencv_face_detector.cpp)
  target_include_directories(lvk-tracker-core PRIVATE ${LVK_OPENCV_FACE_DETECTOR_INCLUDE_DIRS})
  target_link_libraries(lvk-tracker-core PRIVATE ${LVK_OPENCV_FACE_DETECTOR_LIBS})
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV_FACE_DETECTOR=1)
else()
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV_FACE_DETECTOR=0)
endif()

# Windows OpenCV-enabled development runtime DLL adjacency contract (#603).
# Issue #598 showed the built lvk-tracker-core.exe can fail before main() with
# STATUS_DLL_NOT_FOUND (0xC0000135) when the vcpkg/OpenCV runtime directory is
# not already present on the caller's PATH. Two earlier revisions of this
# contract were rejected by real Windows execution evidence:
#   - CMake's own resolved runtime-DLL-closure generator expression
#     ($<TARGET_RUNTIME_DLLS:...>) omitted several vcpkg-built transitive
#     dependency DLLs that are required at runtime.
#   - A configure-time check of VCPKG_APPLOCAL_DEPS's CACHE presence/value
#     cannot prove the vcpkg toolchain or its app-local deployment hook
#     actually engaged: the variable is a caller-controlled, documented
#     vcpkg input, so a non-vcpkg configure can pass `-DVCPKG_APPLOCAL_DEPS=ON`
#     and satisfy that check with no app-local hook attached and no DLLs
#     staged.
#
# The owner-approved mechanism moves mandatory enforcement from configure-time
# toolchain attestation to build-time real execution proof. vcpkg app-local
# deployment remains the supported Windows development staging route, but
# real execution -- not a cache variable -- is the authoritative proof of
# runtime closure. This gate never stages or copies DLLs itself, and never
# reads, compares, normalizes, persists, or prints a toolchain/vcpkg/OpenCV
# path.
#
# Route A (this gate): the default/ALL development build
# (`cmake --build <dir> --config <cfg>` with no explicit --target) is only
# successful if the exact generated lvk-tracker-core.exe configuration
# actually starts and reports OpenCV camera capability from its own output
# directory using only the Windows system DLL search path, with no
# vcpkg/OpenCV runtime directory supplied. The verifier runs as a separate
# `ALL` custom target that depends on lvk-tracker-core (never a same-target
# POST_BUILD command), so it always runs after the executable target --
# including vcpkg's app-local POST_BUILD staging -- has completed, and always
# re-executes on a no-op rebuild because it has no output artifact.
#
# Route B (explicit `--target lvk-tracker-core` builds or a direct IDE
# executable-project build) can bypass this automatic ALL-target gate by
# construction; a Route B build succeeding is INCOMPLETE / UNVERIFIED for
# runtime adjacency on its own. tools/check-native-dev-runtime-adjacency.mjs
# run with an explicit `--config <cfg>` is the required independent Route B
# proof for those routes -- see docs/LOCAL_RUNTIME_CHECKLIST.md.
if(WIN32 AND (LVK_HAS_OPENCV_CAMERA OR LVK_HAS_OPENCV_FACE_DETECTOR))
  if(CMAKE_CROSSCOMPILING)
    message(FATAL_ERROR
      "LVK: Windows OpenCV-enabled Native Core builds require real native "
      "execution to prove runtime DLL adjacency (#603), which is unavailable "
      "while CMAKE_CROSSCOMPILING is set. Configure a native (non-cross-"
      "compiling) Windows toolchain; see docs/LOCAL_RUNTIME_CHECKLIST.md.")
  endif()

  set(LVK_NATIVE_RUNTIME_ADJACENCY_GATE_SCRIPT
    "${CMAKE_CURRENT_BINARY_DIR}/lvk-tracker-core-runtime-adjacency-gate/run-adjacency-gate-$<CONFIG>.cmake")

  # The generated file lives only in the ignored build tree; it is not a
  # committed source file and is regenerated on every configure. The exact
  # $<TARGET_FILE:lvk-tracker-core> generator expression is embedded here so
  # the executable path never appears on the outer build command line -- only
  # inside this private, per-configuration runner.
  file(GENERATE
    OUTPUT "${LVK_NATIVE_RUNTIME_ADJACENCY_GATE_SCRIPT}"
    CONTENT [[
# Generated by native/tracker-core/CMakeLists.txt for #603. Do not edit; this
# file is regenerated on every configure and lives only in the ignored build
# tree. Proves the exact built lvk-tracker-core.exe configuration can start
# and report OpenCV camera capability from its own output directory using
# only the Windows system DLL search path, with no vcpkg/OpenCV runtime
# directory supplied. Never prints an executable or dependency path, PATH
# contents, environment values, argv beyond a fixed label, raw stdout/stderr,
# raw OS error text, PID, or HANDLE.
set(_lvk_exe "$<TARGET_FILE:lvk-tracker-core>")
set(_lvk_workdir "$<TARGET_FILE_DIR:lvk-tracker-core>")

if(DEFINED ENV{SystemRoot} AND NOT "$ENV{SystemRoot}" STREQUAL "")
  set(_lvk_system_root "$ENV{SystemRoot}")
else()
  set(_lvk_system_root "C:/Windows")
endif()
set(ENV{SystemRoot} "${_lvk_system_root}")
set(ENV{PATH} "${_lvk_system_root}\\System32;${_lvk_system_root}")

function(lvk_adjacency_gate_fail category)
  message(FATAL_ERROR "LVK: native runtime adjacency gate failed (category=${category})")
endfunction()

execute_process(
  COMMAND "${_lvk_exe}" --print-runtime-capabilities
  WORKING_DIRECTORY "${_lvk_workdir}"
  RESULT_VARIABLE _lvk_result
  OUTPUT_VARIABLE _lvk_stdout
  ERROR_VARIABLE _lvk_stderr
  TIMEOUT 30
)

if(_lvk_result MATCHES "[Tt]imeout")
  lvk_adjacency_gate_fail("timeout")
endif()

# A loader failure before main() (for example STATUS_DLL_NOT_FOUND /
# 0xC0000135) is a real process exit, not a failure to launch, but CMake
# reports it as "Exit code 0x<hex>" rather than a plain decimal code. Treat
# both forms as an exit result; anything else means the process never
# actually started.
if(_lvk_result MATCHES "^-?[0-9]+$")
  if(NOT _lvk_result EQUAL 0)
    lvk_adjacency_gate_fail("nonzero-exit")
  endif()
elseif(_lvk_result MATCHES "^Exit code 0x[0-9A-Fa-f]+$")
  lvk_adjacency_gate_fail("nonzero-exit")
else()
  lvk_adjacency_gate_fail("spawn-failed")
endif()

string(LENGTH "${_lvk_stdout}" _lvk_stdout_len)
string(LENGTH "${_lvk_stderr}" _lvk_stderr_len)
if(_lvk_stdout_len GREATER 65536 OR _lvk_stderr_len GREATER 65536)
  lvk_adjacency_gate_fail("output-too-large")
endif()

if(NOT _lvk_stdout MATCHES "LVK native runtime capabilities")
  lvk_adjacency_gate_fail("malformed-capabilities")
endif()

if(_lvk_stdout MATCHES "opencvCameraSupport=([a-zA-Z]+)")
  set(_lvk_opencv "${CMAKE_MATCH_1}")
else()
  lvk_adjacency_gate_fail("malformed-capabilities")
endif()

if(_lvk_stdout MATCHES "localOnly=([a-zA-Z]+)")
  set(_lvk_local_only "${CMAKE_MATCH_1}")
else()
  lvk_adjacency_gate_fail("malformed-capabilities")
endif()

if(_lvk_stdout MATCHES "cameraOpened=([a-zA-Z]+)")
  set(_lvk_camera_opened "${CMAKE_MATCH_1}")
else()
  lvk_adjacency_gate_fail("malformed-capabilities")
endif()

if(_lvk_stdout MATCHES "motionFramesEmitted=([a-zA-Z]+)")
  set(_lvk_motion_frames_emitted "${CMAKE_MATCH_1}")
else()
  lvk_adjacency_gate_fail("malformed-capabilities")
endif()

if(NOT _lvk_opencv STREQUAL "true")
  lvk_adjacency_gate_fail("opencv-camera-support-not-enabled")
endif()

if(NOT _lvk_local_only STREQUAL "true")
  lvk_adjacency_gate_fail("local-only-missing")
endif()

if(NOT _lvk_camera_opened STREQUAL "false")
  lvk_adjacency_gate_fail("camera-opened-unexpected")
endif()

if(NOT _lvk_motion_frames_emitted STREQUAL "false")
  lvk_adjacency_gate_fail("motion-frames-emitted-unexpected")
endif()

if(_lvk_stdout MATCHES "\"type\":\"motion_frame\"")
  lvk_adjacency_gate_fail("motionframe-shaped-output-detected")
endif()

message(STATUS "LVK: native runtime adjacency gate passed.")
]]
  )

  add_custom_target(lvk-tracker-core-runtime-adjacency-gate ALL
    COMMAND ${CMAKE_COMMAND} -P "${LVK_NATIVE_RUNTIME_ADJACENCY_GATE_SCRIPT}"
    VERBATIM
    COMMENT "LVK: proving lvk-tracker-core.exe runtime DLL adjacency (#603)"
  )
  add_dependencies(lvk-tracker-core-runtime-adjacency-gate lvk-tracker-core)
endif()

if(MSVC)
  target_compile_options(lvk-tracker-core PRIVATE /W4)
else()
  target_compile_options(lvk-tracker-core PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Synthetic helper contract smoke (H1a), extended with an opt-in bounded
# private frame-transport mode (v0.13.0, #534: --session-frame-mode).
# Standalone, synthetic-only executable used to exercise the internal Native
# Core <-> helper JSON contract. It has no OpenCV dependency, does not access
# a camera, and is not wired into Native Core process supervision. It links
# the pure, OpenCV-independent helper_frame_packet.cpp to decode/validate the
# frame packet header and compute the frameAck checksum, never pixels beyond
# that. See docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md and
# docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md.
add_executable(lvk-synthetic-helper
  src/helper_frame_packet.cpp
  src/synthetic_helper_main.cpp
)

target_compile_features(lvk-synthetic-helper PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-synthetic-helper PRIVATE /W4)
else()
  target_compile_options(lvk-synthetic-helper PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Helper result mapping smoke (H1b). Maps synthetic helper-style internal
# results to the existing TrackingSample / MotionFrame shape. No OpenCV, no
# camera, no process spawning, and no live helper stdout parsing. See
# docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
add_executable(lvk-helper-result-mapping-smoke
  src/helper_result_mapping_smoke.cpp
  src/helper_tracking_result.cpp
  src/motion_frame_writer.cpp
)

target_compile_features(lvk-helper-result-mapping-smoke PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-helper-result-mapping-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-helper-result-mapping-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Strict helper-message parser smoke (v0.13.0, #533). Standalone executable that
# asserts the strict, dependency-free helper contract parser directly on
# hand-built lines. No OpenCV, no camera, no process spawning, no stdin, and no
# MotionFrame output. See docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md.
add_executable(lvk-helper-message-parse-smoke
  src/helper_message_parse_smoke.cpp
  src/helper_message.cpp
)

target_compile_features(lvk-helper-message-parse-smoke PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-helper-message-parse-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-helper-message-parse-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Helper process supervision smoke (H1c). Standalone executable that launches
# lvk-synthetic-helper as a child process, captures its private stdout/stderr
# pipes, and validates normal/failure/timeout lifecycle handling. The supervisor
# is linked only into this smoke target and is NOT wired into the
# lvk-tracker-core runtime. No OpenCV, no camera, no temporary files. See
# docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
add_executable(lvk-helper-process-supervision-smoke
  src/helper_process_supervision_smoke.cpp
  src/helper_process_supervisor.cpp
)

target_compile_features(lvk-helper-process-supervision-smoke PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-helper-process-supervision-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-helper-process-supervision-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# H2 synthetic state-machine smoke (first scoped H2 prototype slice). Standalone
# executable that launches lvk-synthetic-helper under the existing bounded helper
# process supervisor and reconstructs the designed H2 helper lifecycle state path
# (not_started -> launching -> waiting_for_ready -> ready -> running -> exited,
# plus failure/timeout fallback paths) from the supervised run result. Captured
# helper stdout/stderr stay private and are never forwarded to public stdout;
# only safe [h2-state-machine-smoke] diagnostics go to stderr. Synthetic only:
# no OpenCV, no camera, no temporary files, no new dependency, and it is NOT
# wired into the lvk-tracker-core runtime. See
# docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_IMPLEMENTATION_GATE.md and
# docs/TRACKING_HELPER_PROCESS_H2_PROTOTYPE_OWNER_DECISION.md.
add_executable(lvk-helper-h2-state-machine-smoke
  src/helper_h2_state_machine_smoke.cpp
  src/helper_process_supervisor.cpp
)

target_compile_features(lvk-helper-h2-state-machine-smoke PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-helper-h2-state-machine-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-helper-h2-state-machine-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Bounded frame packet smoke (v0.13.0, #534). Standalone, pure executable that
# asserts the OpenCV-independent binary frame packet header codec, bounds
# validation, and BGR24 row normalization directly on hand-built in-memory
# buffers. No OpenCV, no camera, no process/pipe I/O, no MotionFrame. See
# docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md.
add_executable(lvk-helper-frame-packet-smoke
  src/helper_frame_packet.cpp
  src/helper_frame_packet_smoke.cpp
)

target_compile_features(lvk-helper-frame-packet-smoke PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-helper-frame-packet-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-helper-frame-packet-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Bounded frame transport smoke (v0.13.0, #534). Standalone executable that
# drives HelperProcessSession's private frame-transport machinery directly
# against lvk-synthetic-helper (--session --session-frame-mode) using
# in-process synthetic BGR24 buffers. Exists because native-ci.yml never
# installs OpenCV, so the real synthetic-frame-helper runtime backend cannot
# be exercised end-to-end there; this smoke proves the transport itself
# without OpenCV, a camera, or a webcam. Not wired into the lvk-tracker-core
# runtime. See docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md.
add_executable(lvk-helper-frame-transport-smoke
  src/helper_frame_packet.cpp
  src/helper_frame_transport_smoke.cpp
  src/helper_message.cpp
  src/helper_process_cleanup_registry.cpp
  src/helper_process_session.cpp
)

target_compile_features(lvk-helper-frame-transport-smoke PRIVATE cxx_std_17)
target_link_libraries(lvk-helper-frame-transport-smoke PRIVATE Threads::Threads)

# Test-target-only lifecycle fault-injection seam. Defined ONLY here, never on
# lvk-tracker-core, so production binaries contain no fault-injection surface.
target_compile_definitions(lvk-helper-frame-transport-smoke PRIVATE LVK_HELPER_LIFECYCLE_TEST_SEAM=1)

if(MSVC)
  target_compile_options(lvk-helper-frame-transport-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-helper-frame-transport-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# MediaPipe helper route configuration smoke (v0.13.0, #570). Standalone,
# standard-library-only executable that asserts
# createMediaPipeHelperRouteConfig()'s path validation and
# HelperSessionConfig construction directly on hand-built synthetic path
# fixtures. No process spawning, no filesystem access beyond a lexical
# std::filesystem::path parse, no camera, no OpenCV, no MediaPipe, no
# Python, and not wired into the lvk-tracker-core runtime.
add_executable(lvk-mediapipe-helper-route-config-smoke
  src/mediapipe_helper_route_config.cpp
  src/mediapipe_helper_route_config_smoke.cpp
)

target_compile_features(lvk-mediapipe-helper-route-config-smoke PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-mediapipe-helper-route-config-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-mediapipe-helper-route-config-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Native Core-to-Python MediaPipe helper frame bridge smoke (v0.13.0, #571).
# Standalone executable that launches a real Python child (a test-only
# fixture under tests/fixtures, never the production helper directly) through
# the real HelperProcessSession and the merged #568/#570 exact-invocation
# route, proving one real cross-runtime request/frame/result exchange and
# graceful shutdown. No OpenCV, no MediaPipe, no Python library/embed
# linkage, no new dependency; not wired into the lvk-tracker-core runtime.
add_executable(lvk-mediapipe-helper-frame-bridge-smoke
  src/helper_frame_packet.cpp
  src/helper_message.cpp
  src/helper_process_cleanup_registry.cpp
  src/helper_process_session.cpp
  src/mediapipe_helper_route_config.cpp
  src/mediapipe_helper_frame_bridge_smoke.cpp
)

target_compile_features(lvk-mediapipe-helper-frame-bridge-smoke PRIVATE cxx_std_17)
target_link_libraries(lvk-mediapipe-helper-frame-bridge-smoke PRIVATE Threads::Threads)

if(MSVC)
  target_compile_options(lvk-mediapipe-helper-frame-bridge-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-mediapipe-helper-frame-bridge-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Helper-session terminal-failure diagnostic smoke (#587). Standalone
# executable that drives the real production SyntheticHelperTrackingBackend
# (tracking_backend.cpp is otherwise only compiled into lvk-tracker-core, so
# this target exists to exercise it -- and the shared reporter it uses with
# FrameHelperTrackingBackend -- deterministically) against
# lvk-synthetic-helper, proving the exact
# "[helper-session] session failed (category=<label>)" contract: fixed
# category, once per session, triggered only by
# HelperProcessSession::state() == Failed on the track() path. No OpenCV, no
# camera, no real MediaPipe, no network; not wired into the lvk-tracker-core
# runtime.
add_executable(lvk-tracking-backend-terminal-failure-smoke
  src/face_tracking_pipeline.cpp
  src/helper_frame_packet.cpp
  src/helper_message.cpp
  src/helper_process_cleanup_registry.cpp
  src/helper_process_session.cpp
  src/helper_tracking_result.cpp
  src/tracking_backend.cpp
  src/tracking_backend_terminal_failure_smoke.cpp
  src/tracking_sample_factory.cpp
)

target_compile_features(lvk-tracking-backend-terminal-failure-smoke PRIVATE cxx_std_17)
target_link_libraries(lvk-tracking-backend-terminal-failure-smoke PRIVATE Threads::Threads)
target_compile_definitions(lvk-tracking-backend-terminal-failure-smoke PRIVATE LVK_HAS_OPENCV_CAMERA=0)

if(MSVC)
  target_compile_options(lvk-tracking-backend-terminal-failure-smoke PRIVATE /W4)
else()
  target_compile_options(lvk-tracking-backend-terminal-failure-smoke PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Bounded helper result-timeout recovery smoke (v0.13.0, #589). Standalone
# behavioral executable that drives the REAL production owner path
# (MediaPipeFaceLandmarkerHelperTrackingBackend -> FrameHelperTrackingBackend ->
# HelperProcessSession::trackWithFrame()) with a small in-memory synthetic
# cv::Mat, proving the single, bounded, MediaPipe-route-only recovery after a
# terminal result-timeout. Unlike the OpenCV-independent #587 smoke, this target
# compiles the exact production tracking_backend.cpp with OpenCV ENABLED
# (LVK_HAS_OPENCV_CAMERA=1 / LVK_HAS_OPENCV_IMAGE=1) so the FrameHelperTracking
# Backend owner path is present; it therefore only exists when the required
# OpenCV core/camera components are available. It re-execs itself (via the
# existing ExactArguments caller-owned-argv path) as a frame-transport session
# child -- it never opens a camera, loads MediaPipe/Python/a model, or uses the
# network, sockets, temp files, or persisted frames. The existing test-target-
# only lifecycle seam is enabled here (never on lvk-tracker-core) so generation
# cleanup can be asserted through existing observability. Not wired into the
# lvk-tracker-core runtime.
if(LVK_HAS_OPENCV_CAMERA)
  add_executable(lvk-tracking-backend-result-timeout-recovery-smoke
    src/face_tracking_pipeline.cpp
    src/helper_frame_packet.cpp
    src/helper_message.cpp
    src/helper_process_cleanup_registry.cpp
    src/helper_process_session.cpp
    src/helper_tracking_result.cpp
    src/tracking_backend.cpp
    src/tracking_backend_result_timeout_recovery_smoke.cpp
    src/tracking_sample_factory.cpp
  )

  target_compile_features(lvk-tracking-backend-result-timeout-recovery-smoke PRIVATE cxx_std_17)
  target_link_libraries(lvk-tracking-backend-result-timeout-recovery-smoke PRIVATE Threads::Threads ${LVK_OPENCV_CAMERA_LIBS})
  target_include_directories(lvk-tracking-backend-result-timeout-recovery-smoke PRIVATE ${LVK_OPENCV_CAMERA_INCLUDE_DIRS})
  # OpenCV enabled: compile the real FrameHelperTrackingBackend owner path and
  # the matching image capability. Both are set target-wide so every
  # translation unit agrees on the PreprocessedFrame/CameraFrame layout.
  target_compile_definitions(lvk-tracking-backend-result-timeout-recovery-smoke PRIVATE
    LVK_HAS_OPENCV_CAMERA=1
    LVK_HAS_OPENCV_IMAGE=1
    LVK_HELPER_LIFECYCLE_TEST_SEAM=1
  )

  if(MSVC)
    target_compile_options(lvk-tracking-backend-result-timeout-recovery-smoke PRIVATE /W4)
  else()
    target_compile_options(lvk-tracking-backend-result-timeout-recovery-smoke PRIVATE -Wall -Wextra -Wpedantic)
  endif()
endif()
