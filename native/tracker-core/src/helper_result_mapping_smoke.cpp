// Helper result mapping smoke (H1b).
//
// Exercises createTrackingSampleFromHelperResult with representative synthetic
// helper-style internal results (normal, lost, not-started, out-of-range, and
// NaN/infinity) and:
//   1. asserts the mapped TrackingSample is safe (clamped, finite, neutral
//      where required), returning non-zero on any violation; and
//   2. emits the resulting MotionFrame JSON using the existing writer so the
//      Node checker can confirm the public MotionFrame shape and that no
//      helper-only fields leak.
//
// This is synthetic only: no camera, no model, no raw frames, no process
// spawning, and no live helper stdout parsing. See
// docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.

#include "helper_tracking_result.h"
#include "motion_frame_writer.h"
#include "tracker.h"

#include <cmath>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace {

using lvk::tracker::createTrackingSampleFromHelperResult;
using lvk::tracker::HelperTrackingResult;
using lvk::tracker::HelperTrackingStatus;
using lvk::tracker::TrackingSample;
using lvk::tracker::TrackingStatus;

struct SmokeCase {
  std::string name;
  HelperTrackingResult helperResult;
  TrackingStatus expectedStatus;
};

bool inUnitRange(double value) {
  return std::isfinite(value) && value >= 0.0 && value <= 1.0;
}

bool isNeutralZero(double value) { return std::isfinite(value) && value == 0.0; }

// Validates that a mapped sample is safe regardless of the helper input.
bool validateMappedSample(
    const SmokeCase& smokeCase,
    const TrackingSample& sample,
    std::ostream& diagnostics) {
  const auto failCheck = [&](const std::string& reason) {
    diagnostics << "[mapping-smoke] error: case=" << smokeCase.name
                << ", reason=" << reason << "\n";
    return false;
  };

  if (sample.timestampMs != smokeCase.helperResult.timestampMs) {
    return failCheck("timestamp not preserved");
  }

  if (sample.status != smokeCase.expectedStatus) {
    return failCheck("unexpected mapped tracking status");
  }

  if (!inUnitRange(sample.confidence)) {
    return failCheck("confidence not clamped to [0,1]");
  }

  if (!inUnitRange(sample.leftEyeOpen) || !inUnitRange(sample.rightEyeOpen)) {
    return failCheck("eye openness not clamped to [0,1]");
  }

  if (!inUnitRange(sample.mouthOpen) || !inUnitRange(sample.mouthSmile)) {
    return failCheck("mouth values not clamped to [0,1]");
  }

  if (!std::isfinite(sample.faceRotation.pitch) ||
      !std::isfinite(sample.faceRotation.yaw) ||
      !std::isfinite(sample.faceRotation.roll)) {
    return failCheck("face rotation not finite");
  }

  // Face position and gaze remain neutral for now.
  if (!isNeutralZero(sample.facePosition.x) ||
      !isNeutralZero(sample.facePosition.y) ||
      !isNeutralZero(sample.facePosition.z)) {
    return failCheck("face position expected neutral");
  }

  if (!isNeutralZero(sample.gaze.x) || !isNeutralZero(sample.gaze.y)) {
    return failCheck("gaze expected neutral");
  }

  // Non-tracking statuses must use the safe neutral shape.
  if (smokeCase.expectedStatus != TrackingStatus::Tracking) {
    if (sample.confidence != 0.0 || sample.leftEyeOpen != 1.0 ||
        sample.rightEyeOpen != 1.0 || sample.mouthOpen != 0.0 ||
        sample.mouthSmile != 0.0) {
      return failCheck("non-tracking status expected neutral output shape");
    }
  }

  return true;
}

std::vector<SmokeCase> buildSmokeCases() {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();

  std::vector<SmokeCase> cases;

  HelperTrackingResult normal;
  normal.timestampMs = 0;
  normal.status = HelperTrackingStatus::Tracking;
  normal.confidence = 0.9;
  normal.faceRotation = {0.05, -0.1, 0.0};
  normal.eyes = {0.8, 0.7};
  normal.mouth = {0.3, 0.2};
  normal.inferenceMs = 1.5;
  cases.push_back({"normal-tracking", normal, TrackingStatus::Tracking});

  HelperTrackingResult lost;
  lost.timestampMs = 33;
  lost.status = HelperTrackingStatus::Lost;
  lost.confidence = 0.4;
  cases.push_back({"lost", lost, TrackingStatus::Lost});

  HelperTrackingResult notStarted;
  notStarted.timestampMs = 66;
  notStarted.status = HelperTrackingStatus::NotStarted;
  cases.push_back({"not-started", notStarted, TrackingStatus::NotStarted});

  HelperTrackingResult outOfRange;
  outOfRange.timestampMs = 99;
  outOfRange.status = HelperTrackingStatus::Tracking;
  outOfRange.confidence = 5.0;
  outOfRange.faceRotation = {12.0, -34.0, 56.0};
  outOfRange.eyes = {-1.0, 2.0};
  outOfRange.mouth = {3.0, -0.5};
  cases.push_back({"out-of-range", outOfRange, TrackingStatus::Tracking});

  HelperTrackingResult nonFinite;
  nonFinite.timestampMs = 132;
  nonFinite.status = HelperTrackingStatus::Tracking;
  nonFinite.confidence = nan;
  nonFinite.faceRotation = {nan, inf, -inf};
  nonFinite.eyes = {inf, nan};
  nonFinite.mouth = {nan, inf};
  cases.push_back({"non-finite", nonFinite, TrackingStatus::Tracking});

  return cases;
}

}  // namespace

int main() {
  const std::vector<SmokeCase> cases = buildSmokeCases();

  int emittedCount = 0;
  for (const SmokeCase& smokeCase : cases) {
    const TrackingSample sample =
        createTrackingSampleFromHelperResult(smokeCase.helperResult);

    if (!validateMappedSample(smokeCase, sample, std::cerr)) {
      return 1;
    }

    lvk::tracker::writeMotionFrameJson(std::cout, sample);
    ++emittedCount;
  }

  std::cerr << "[mapping-smoke] shutdown: mappedCaseCount=" << emittedCount
            << "\n";

  return 0;
}
