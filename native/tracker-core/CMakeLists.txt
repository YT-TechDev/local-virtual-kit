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
