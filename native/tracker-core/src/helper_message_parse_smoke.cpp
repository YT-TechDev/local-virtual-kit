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
//
// v0.13.0 (#535): also supports one opt-in, test-only cross-runtime parity
// mode ("--parse-result-frame-line <json-content>") that feeds a real
// Python-serialized frame-mode result line through the actual production
// parseHelperResultEnvelope()/parseHelperFrameAck() and checks it against a
// known synthetic fixture. The JSON content is passed as a bounded
// command-line argument only (no stdin), and is never echoed to stdout or
// stderr. This does not alter production parser semantics; it only exercises
// the existing strict parser from this same smoke executable.

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

// The pre-existing, byte-for-byte-compatible default smoke (no arguments).
int runDefaultSmoke() {
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

  // --- Bounded line-framing boundaries (scanBoundedLine). ---
  using lvk::tracker::HelperLineScan;
  using lvk::tracker::kHelperMaxLineBytes;
  using lvk::tracker::scanBoundedLine;
  {
    // Exactly kHelperMaxLineBytes of content plus a newline: accepted.
    std::string buffer(kHelperMaxLineBytes, 'a');
    buffer.push_back('\n');
    std::string out;
    const HelperLineScan scan = scanBoundedLine(buffer, out);
    expect(scan == HelperLineScan::Line, "exact-limit line accepted");
    expect(out.size() == kHelperMaxLineBytes, "exact-limit line length preserved");
  }
  {
    // kHelperMaxLineBytes + 1 of content plus a newline: rejected.
    std::string buffer(kHelperMaxLineBytes + 1, 'a');
    buffer.push_back('\n');
    std::string out;
    expect(
        scanBoundedLine(buffer, out) == HelperLineScan::Oversized,
        "limit+1 terminated line rejected");
  }
  {
    // Unterminated partial run larger than the limit: rejected during
    // accumulation (before any newline arrives).
    std::string buffer(kHelperMaxLineBytes + 1, 'a');
    std::string out;
    expect(
        scanBoundedLine(buffer, out) == HelperLineScan::Oversized,
        "unterminated over-limit run rejected during accumulation");
  }
  {
    // Unterminated run exactly at the limit: still needs a newline, not yet
    // oversized.
    std::string buffer(kHelperMaxLineBytes, 'a');
    std::string out;
    expect(
        scanBoundedLine(buffer, out) == HelperLineScan::NeedMore,
        "unterminated at-limit run needs more");
  }

  if (gFailures != 0) {
    std::cerr << "[helper-message-parse-smoke] " << gFailures
              << " assertion(s) failed.\n";
    return 1;
  }
  std::cout << "helper-message parse smoke OK\n";
  return 0;
}

// Opt-in, test-only cross-runtime parity mode. Feeds a real Python-serialized
// frame-mode result line (passed as `line`, content only, no trailing
// newline) through the actual production parseHelperResultEnvelope() and
// parseHelperFrameAck(), then checks the parsed values against the one known
// synthetic contract fixture shared with test_helper_result_json.py
// (--emit-cpp-parity-line). Never echoes `line` to stdout or stderr. Returns
// 0 and prints only the safe marker on success; returns non-zero and prints
// only a generic diagnostic on any failure.
int runResultFrameLineParityCheck(const std::string& line) {
  using lvk::tracker::classifyHelperLine;
  using lvk::tracker::HelperLineType;
  using lvk::tracker::HelperTrackingStatus;
  using lvk::tracker::parseHelperFrameAck;
  using lvk::tracker::parseHelperResultEnvelope;
  using lvk::tracker::ParsedFrameAck;
  using lvk::tracker::ParsedHelperResult;

  if (line.find('\r') != std::string::npos ||
      line.find('\n') != std::string::npos) {
    std::cerr << "[helper-message-parse-smoke] parity check rejected: "
                 "embedded CR/LF in argument\n";
    return 1;
  }

  if (classifyHelperLine(line) != HelperLineType::Result) {
    std::cerr << "[helper-message-parse-smoke] parity check failed: "
                 "line not classified as Result\n";
    return 1;
  }

  ParsedHelperResult parsedResult;
  std::string resultReason;
  if (!parseHelperResultEnvelope(line, parsedResult, resultReason)) {
    std::cerr << "[helper-message-parse-smoke] parity check failed: "
                 "result envelope rejected\n";
    return 1;
  }

  ParsedFrameAck parsedAck;
  std::string ackReason;
  if (!parseHelperFrameAck(line, parsedAck, ackReason)) {
    std::cerr << "[helper-message-parse-smoke] parity check failed: "
                 "frameAck rejected\n";
    return 1;
  }

  // Known synthetic contract fixture, shared with
  // test_helper_result_json.py's --emit-cpp-parity-line mode. Synthetic
  // metadata only: no image/frame/model/private-path data.
  constexpr double kTolerance = 1e-9;
  bool matches = true;
  matches = matches && parsedResult.requestId == 7ull;
  matches = matches && parsedResult.frameTimestampMs == 123;
  matches = matches &&
      parsedResult.payload.status == HelperTrackingStatus::Tracking;
  matches = matches &&
      std::abs(parsedResult.payload.confidence - 1.0) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.faceRotation.pitch - 0.25) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.faceRotation.yaw - (-0.5)) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.faceRotation.roll - 0.75) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.eyes.leftOpen - 0.8) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.eyes.rightOpen - 0.6) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.mouth.open - 0.4) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.mouth.smile - 0.2) < kTolerance;
  matches = matches &&
      std::abs(parsedResult.payload.inferenceMs - 1.5) < kTolerance;
  matches = matches && parsedAck.sequence == 7ull;
  matches = matches && parsedAck.payloadBytes == 3ull;
  matches = matches && parsedAck.checksum == 123456789u;

  if (!matches) {
    std::cerr << "[helper-message-parse-smoke] parity check failed: "
                 "fixture value mismatch\n";
    return 1;
  }

  std::cout << "helper-message serializer parity OK\n";
  return 0;
}

int main(int argc, char** argv) {
  if (argc == 1) {
    return runDefaultSmoke();
  }
  if (argc == 3 && std::string(argv[1]) == "--parse-result-frame-line") {
    return runResultFrameLineParityCheck(std::string(argv[2]));
  }
  std::cerr << "[helper-message-parse-smoke] unknown arguments\n";
  return 1;
}
