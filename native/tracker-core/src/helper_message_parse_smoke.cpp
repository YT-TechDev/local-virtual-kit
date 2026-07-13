// v0.13.0 strict helper-message parser smoke (#533).
//
// Standalone, synthetic-only executable that asserts the strict, dependency-free
// helper contract parser (helper_message.*) directly on hand-built lines. It
// spawns no process, opens no camera, reads no stdin, and emits no MotionFrame.
// It proves the strict-parse rejections the reusable production session relies
// on: missing/duplicate fields, trailing garbage, integer overflow, partial
// numeric tokens, non-finite numbers, and exact schemaVersion matching, while
// confirming finite out-of-range values are accepted (left for the mapper to
// clamp).

#include "helper_message.h"

#include <cmath>
#include <iostream>
#include <string>

namespace {

int gFailures = 0;

void expect(bool condition, const std::string& what) {
  if (!condition) {
    std::cerr << "[helper-message-parse-smoke] FAILED: " << what << "\n";
    ++gFailures;
  }
}

// A complete, valid session result envelope with substitutable confidence text
// so individual malformed variants can be built from one template.
std::string validResult() {
  return "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":7,"
         "\"frameTimestampMs\":123,\"status\":\"tracking\",\"confidence\":0.5,"
         "\"faceRotation\":{\"pitch\":0.1,\"yaw\":-0.2,\"roll\":0.0},"
         "\"eyes\":{\"leftOpen\":0.9,\"rightOpen\":0.8},"
         "\"mouth\":{\"open\":0.3,\"smile\":0.4},"
         "\"diag\":{\"inferenceMs\":1.5}}";
}

void expectReject(const std::string& line, const std::string& what) {
  using lvk::tracker::ParsedHelperResult;
  ParsedHelperResult parsed;
  std::string reason;
  const bool ok =
      lvk::tracker::parseHelperResultEnvelope(line, parsed, reason);
  expect(!ok, what + " should be rejected");
}

}  // namespace

int main() {
  using lvk::tracker::classifyHelperLine;
  using lvk::tracker::HelperLineType;
  using lvk::tracker::parseHelperReadyLine;
  using lvk::tracker::parseHelperResultEnvelope;
  using lvk::tracker::parseHelperStoppedLine;
  using lvk::tracker::ParsedHelperResult;

  // --- Valid result envelope round-trips. ---
  {
    ParsedHelperResult parsed;
    std::string reason;
    const bool ok = parseHelperResultEnvelope(validResult(), parsed, reason);
    expect(ok, "valid result envelope parses");
    expect(parsed.requestId == 7u, "requestId parsed");
    expect(parsed.frameTimestampMs == 123, "frameTimestampMs parsed");
    expect(parsed.payload.timestampMs == 123, "payload timestamp echoes frame");
    expect(
        parsed.payload.status == lvk::tracker::HelperTrackingStatus::Tracking,
        "status parsed");
    expect(std::abs(parsed.payload.confidence - 0.5) < 1e-9, "confidence parsed");
    expect(std::abs(parsed.payload.eyes.leftOpen - 0.9) < 1e-9, "eye parsed");
  }

  // --- Finite out-of-range values are ACCEPTED (mapper clamps later). ---
  {
    const std::string line =
        "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":1,"
        "\"frameTimestampMs\":0,\"status\":\"tracking\",\"confidence\":1.75,"
        "\"faceRotation\":{\"pitch\":4.2,\"yaw\":-3.5,\"roll\":2.0},"
        "\"eyes\":{\"leftOpen\":1.5,\"rightOpen\":-0.5},"
        "\"mouth\":{\"open\":2.0,\"smile\":-1.0}}";
    ParsedHelperResult parsed;
    std::string reason;
    const bool ok = parseHelperResultEnvelope(line, parsed, reason);
    expect(ok, "finite out-of-range values accepted");
    expect(
        std::abs(parsed.payload.confidence - 1.75) < 1e-9,
        "out-of-range confidence preserved for clamping");
  }

  // --- Strict rejections. ---
  expectReject(
      "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":1,"
      "\"frameTimestampMs\":0,\"status\":\"tracking\","
      "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
      "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
      "\"mouth\":{\"open\":0.0,\"smile\":0.0}}",
      "missing confidence field");

  expectReject(
      "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":1,"
      "\"frameTimestampMs\":0,\"status\":\"tracking\",\"confidence\":0.5,"
      "\"confidence\":0.6,"
      "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
      "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
      "\"mouth\":{\"open\":0.0,\"smile\":0.0}}",
      "duplicate confidence field");

  expectReject(validResult() + "trailing-garbage", "trailing garbage");

  expectReject(
      "{\"type\":\"result\",\"schemaVersion\":1,"
      "\"requestId\":99999999999999999999,\"frameTimestampMs\":0,"
      "\"status\":\"tracking\",\"confidence\":0.5,"
      "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
      "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
      "\"mouth\":{\"open\":0.0,\"smile\":0.0}}",
      "requestId integer overflow");

  expectReject(
      "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":1,"
      "\"frameTimestampMs\":0,\"status\":\"tracking\",\"confidence\":1.2.3,"
      "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
      "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
      "\"mouth\":{\"open\":0.0,\"smile\":0.0}}",
      "partial numeric token");

  expectReject(
      "{\"type\":\"result\",\"schemaVersion\":1,\"requestId\":1,"
      "\"frameTimestampMs\":0,\"status\":\"tracking\",\"confidence\":1e400,"
      "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
      "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
      "\"mouth\":{\"open\":0.0,\"smile\":0.0}}",
      "non-finite confidence (1e400)");

  // schemaVersion:10 must not be accepted via a prefix match of schemaVersion:1.
  expectReject(
      "{\"type\":\"result\",\"schemaVersion\":10,\"requestId\":1,"
      "\"frameTimestampMs\":0,\"status\":\"tracking\",\"confidence\":0.5,"
      "\"faceRotation\":{\"pitch\":0.0,\"yaw\":0.0,\"roll\":0.0},"
      "\"eyes\":{\"leftOpen\":1.0,\"rightOpen\":1.0},"
      "\"mouth\":{\"open\":0.0,\"smile\":0.0}}",
      "invalid schemaVersion 10");

  expectReject(
      "{\"type\":\"telemetry\",\"schemaVersion\":1,\"requestId\":1,"
      "\"frameTimestampMs\":0}",
      "unknown message type");

  expectReject("{\"type\":\"result\" not-json", "malformed json");

  // --- Line classification. ---
  expect(
      classifyHelperLine(
          "{\"type\":\"ready\",\"schemaVersion\":1,"
          "\"source\":\"synthetic-helper\"}") == HelperLineType::Ready,
      "classify ready");
  expect(
      classifyHelperLine(validResult()) == HelperLineType::Result,
      "classify result");
  expect(
      classifyHelperLine(
          "{\"type\":\"stopped\",\"schemaVersion\":1,"
          "\"reason\":\"session-stop\"}") == HelperLineType::Stopped,
      "classify stopped");
  expect(
      classifyHelperLine("{ this is not json") == HelperLineType::Unknown,
      "classify malformed as unknown");

  // --- Lifecycle line validators. ---
  {
    std::string reason;
    expect(
        parseHelperReadyLine(
            "{\"type\":\"ready\",\"schemaVersion\":1,"
            "\"source\":\"synthetic-helper\"}",
            reason),
        "valid ready line accepted");
    expect(
        !parseHelperReadyLine(
            "{\"type\":\"ready\",\"schemaVersion\":10,"
            "\"source\":\"synthetic-helper\"}",
            reason),
        "ready with schemaVersion 10 rejected");
    expect(
        parseHelperStoppedLine(
            "{\"type\":\"stopped\",\"schemaVersion\":1,"
            "\"reason\":\"session-stop\"}",
            reason),
        "valid stopped line accepted");
  }

  if (gFailures != 0) {
    std::cerr << "[helper-message-parse-smoke] " << gFailures
              << " assertion(s) failed.\n";
    return 1;
  }
  std::cout << "helper-message parse smoke OK\n";
  return 0;
}
