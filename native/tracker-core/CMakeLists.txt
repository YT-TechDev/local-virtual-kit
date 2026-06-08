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

add_executable(lvk-tracker-core
  src/camera_source.cpp
  src/face_detector.cpp
  src/face_tracking_pipeline.cpp
  src/frame_preprocessor.cpp
  src/main.cpp
  src/motion_frame_writer.cpp
  src/tracker.cpp
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
