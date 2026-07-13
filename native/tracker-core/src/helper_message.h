#pragma once

#include "helper_tracking_result.h"

#include <cstddef>
#include <cstdint>
#include <string>

namespace lvk::tracker {

// v0.13.0 reusable Native Core helper IPC message boundary (#533).
//
// This is the single strict, dependency-free parser for the private, newline-
// delimited helper contract used by the reusable production helper session
// (helper_process_session.*). It is Native Core-internal: the parsed result is
// mapped into MotionFrame by createTrackingSampleFromHelperResult, is NOT
// MotionFrame, and is NOT part of packages/motion-protocol. It adds no JSON
// dependency.
//
// The smoke-only helper_runtime_smoke.cpp keeps its established substring-based
// parser unchanged: those H2 smoke checkers assert its specific tolerant
// behavior and diagnostic strings, so reusing this stricter parser there would
// change smoke semantics. This strict parser is therefore the production/session
// parser only (documented in the PR).

// One explicit maximum size (bytes) for a single newline-delimited helper
// message line on any private helper stream (parent->child stdin control lines,
// child->parent stdout lifecycle/result lines, child->parent stderr
// diagnostics). The session enforces this bound WHILE accumulating a partial
// line, so a pathological unterminated line can never grow a read buffer without
// bound. It sits comfortably above the compact result envelope (a few hundred
// bytes) and below any multi-KB payload, so an oversized line is genuinely
// rejected.
constexpr std::size_t kHelperMaxLineBytes = 2048;

enum class HelperLineType {
  Ready,
  Result,
  Stopping,
  Stopped,
  Unknown,
};

// Result of scanning a bounded newline-delimited line out of an accumulation
// buffer. Oversized is reported as soon as the un-terminated run exceeds
// kHelperMaxLineBytes (i.e. during accumulation, before any newline arrives),
// so a pathological unterminated line can never grow a read buffer without
// bound.
enum class HelperLineScan {
  Line,
  NeedMore,
  Oversized,
};

// Extracts one bounded line (content only, trailing "\r" stripped) from the
// front of `buffer`, erasing it through the newline. Returns:
//   - Line: a complete line no longer than kHelperMaxLineBytes was extracted;
//   - NeedMore: no newline yet and the buffered run is within the bound;
//   - Oversized: the line content exceeds kHelperMaxLineBytes (whether or not a
//     newline has arrived) -- caller must reject and stop reading.
HelperLineScan scanBoundedLine(std::string& buffer, std::string& lineOut);

// Transport-level result envelope for the session request/result exchange. The
// requestId correlates a result with the outstanding request; requestId and
// frameTimestampMs are helper-IPC-internal transport concerns and never enter
// MotionFrame or HelperTrackingResult. The payload is the unchanged Native
// Core-internal result mapped by createTrackingSampleFromHelperResult.
struct ParsedHelperResult {
  std::uint64_t requestId = 0;
  long long frameTimestampMs = 0;
  HelperTrackingResult payload;
};

// Classify a helper stdout line by its "type" field using the strict parser.
// Returns Unknown for any malformed line or unrecognized/absent type.
HelperLineType classifyHelperLine(const std::string& line);

// Strictly parse a "ready" lifecycle line. Requires an object with exactly a
// recognized shape: type=="ready", schemaVersion==1, and
// source=="synthetic-helper". Returns false + reason on any deviation.
bool parseHelperReadyLine(const std::string& line, std::string& reason);

// Strictly parse a "stopped" lifecycle line: type=="stopped" and
// schemaVersion==1. Returns false + reason on any deviation.
bool parseHelperStoppedLine(const std::string& line, std::string& reason);

// Strictly parse a session "result" envelope line and its tracking payload.
// Requires type=="result", exact schemaVersion==1, a non-negative integer
// requestId, an integer frameTimestampMs, and a complete tracking payload
// (status, confidence, faceRotation{pitch,yaw,roll}, eyes{leftOpen,rightOpen},
// mouth{open,smile}; optional diag{inferenceMs}). All numeric payload fields
// must be finite: a non-finite (NaN/Infinity) value REJECTS the result (it never
// becomes a neutralized tracking sample). Finite out-of-range values are left
// for createTrackingSampleFromHelperResult to clamp. The payload timestampMs is
// set from the echoed frameTimestampMs. Returns false + reason on any deviation.
bool parseHelperResultEnvelope(
    const std::string& line, ParsedHelperResult& out, std::string& reason);

}  // namespace lvk::tracker
