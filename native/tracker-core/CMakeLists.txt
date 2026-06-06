cmake_minimum_required(VERSION 3.16)

project(lvk_tracker_core LANGUAGES CXX)

add_executable(lvk-tracker-core src/main.cpp)

target_compile_features(lvk-tracker-core PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(lvk-tracker-core PRIVATE /W4)
else()
  target_compile_options(lvk-tracker-core PRIVATE -Wall -Wextra -Wpedantic)
endif()
