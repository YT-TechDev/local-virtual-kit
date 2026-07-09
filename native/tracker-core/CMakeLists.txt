cmake_minimum_required(VERSION 3.16)

project(lvk_tracker_core LANGUAGES CXX)

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

add_executable(lvk-tracker-core
  src/camera_source.cpp
  src/face_detector.cpp
  src/face_tracking_pipeline.cpp
  src/frame_preprocessor.cpp
  src/helper_process_supervisor.cpp
  src/helper_runtime_smoke.cpp
  src/helper_tracking_result.cpp
  src/main.cpp
  src/motion_frame_writer.cpp
  src/tracker.cpp
  src/tracking_backend.cpp
  src/tracking_sample_factory.cpp
)

target_compile_features(lvk-tracker-core PRIVATE cxx_std_17)


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

# Synthetic helper contract smoke (H1a). Standalone, synthetic-only executable
# used to exercise the internal Native Core <-> helper JSON contract. It has no
# OpenCV dependency, does not access a camera, and is not wired into Native Core
# process supervision. See docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
add_executable(lvk-synthetic-helper
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
