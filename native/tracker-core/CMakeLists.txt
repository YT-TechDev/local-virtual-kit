cmake_minimum_required(VERSION 3.16)

project(lvk_tracker_core LANGUAGES CXX)

find_package(OpenCV QUIET COMPONENTS core videoio)

add_executable(lvk-tracker-core
  src/camera_source.cpp
  src/main.cpp
  src/motion_frame_writer.cpp
  src/tracker.cpp
)

target_compile_features(lvk-tracker-core PRIVATE cxx_std_17)

if(OpenCV_FOUND)
  target_sources(lvk-tracker-core PRIVATE src/opencv_camera_source.cpp)
  target_include_directories(lvk-tracker-core PRIVATE ${OpenCV_INCLUDE_DIRS})
  target_link_libraries(lvk-tracker-core PRIVATE ${OpenCV_LIBS})
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV=1)
else()
  target_compile_definitions(lvk-tracker-core PRIVATE LVK_HAS_OPENCV=0)
endif()

if(MSVC)
  target_compile_options(lvk-tracker-core PRIVATE /W4)
else()
  target_compile_options(lvk-tracker-core PRIVATE -Wall -Wextra -Wpedantic)
endif()
