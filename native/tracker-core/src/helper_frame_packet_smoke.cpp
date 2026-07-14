// Bounded frame packet smoke (v0.13.0, #534).
//
// Standalone, pure executable that asserts the OpenCV-independent binary
// frame packet header codec, bounds validation, and BGR24 row normalization
// directly on hand-built in-memory buffers. No OpenCV, no camera, no
// process/pipe I/O, no MotionFrame. Deterministic and CI-safe with zero
// OpenCV installed. See docs/TRACKING_HELPER_PROCESS_H2_PIPE_FRAMING_CONTRACT.md.
//
// v0.13.0 (#535): also supports one opt-in, test-only fixture mode
// ("--emit-python-frame-input-fixture") that emits one tiny synthetic
// request/header/payload fixture built from the actual current
// encodeFramePacketHeader() and fnv1a32(), so a separate Python decoder can
// be proven to interoperate with the real C++ encoder/checksum. It performs
// no camera, file, network, or temp-file I/O, and never prints the fixture
// values through any other path. This does not alter the default no-argument
// smoke behavior.

#include "helper_frame_packet.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

int gFailures = 0;

void expect(bool condition, const std::string& what) {
  if (!condition) {
    ++gFailures;
    std::cerr << "[helper-frame-packet-smoke] FAILED: " << what << "\n";
  }
}

using lvk::tracker::FramePacketDecodeStatus;
using lvk::tracker::FramePacketHeader;
using lvk::tracker::FrameNormalizeStatus;
using lvk::tracker::kFramePacketFormatBgr24;
using lvk::tracker::kFramePacketHeaderBytes;
using lvk::tracker::kFramePacketMaxPayloadBytes;
using lvk::tracker::kFramePacketVersion;

FramePacketHeader makeValidHeader(
    std::uint32_t width, std::uint32_t height, std::uint64_t sequence = 1,
    long long timestampMs = 1000) {
  FramePacketHeader header;
  header.sequence = sequence;
  header.frameTimestampMs = timestampMs;
  header.width = width;
  header.height = height;
  header.rowStrideBytes = width * 3u;
  header.pixelFormat = kFramePacketFormatBgr24;
  header.payloadBytes =
      static_cast<std::uint64_t>(header.rowStrideBytes) * height;
  return header;
}

FramePacketDecodeStatus decodeStatusOf(const FramePacketHeader& header) {
  std::uint8_t bytes[kFramePacketHeaderBytes];
  lvk::tracker::encodeFramePacketHeader(header, bytes);
  FramePacketHeader decoded;
  return lvk::tracker::decodeFramePacketHeader(
      bytes, kFramePacketHeaderBytes, decoded);
}

void testValidPacketRoundTrip() {
  const FramePacketHeader header = makeValidHeader(4, 3, 42, 123456);
  std::uint8_t bytes[kFramePacketHeaderBytes];
  lvk::tracker::encodeFramePacketHeader(header, bytes);

  FramePacketHeader decoded;
  const FramePacketDecodeStatus status =
      lvk::tracker::decodeFramePacketHeader(
          bytes, kFramePacketHeaderBytes, decoded);
  expect(status == FramePacketDecodeStatus::Ok, "valid packet decodes Ok");
  expect(decoded.sequence == 42, "valid packet: sequence round-trips");
  expect(
      decoded.frameTimestampMs == 123456,
      "valid packet: frameTimestampMs round-trips");
  expect(decoded.width == 4, "valid packet: width round-trips");
  expect(decoded.height == 3, "valid packet: height round-trips");
  expect(
      decoded.rowStrideBytes == 12, "valid packet: rowStrideBytes == width*3");
  expect(
      decoded.pixelFormat == kFramePacketFormatBgr24,
      "valid packet: pixelFormat round-trips");
  expect(
      decoded.payloadBytes == 36,
      "valid packet: payloadBytes == rowStride*height (exact payload length)");
}

void testExactHeaderSize() {
  expect(
      kFramePacketHeaderBytes == 48,
      "kFramePacketHeaderBytes is exactly 48 bytes");
}

void testMaxPayloadBoundaryWithoutLargeAllocation() {
  // Largest representable valid BGR24 payload at or below the 32 MiB cap:
  // width=7680, height=1456 -> 23040 * 1456 = 33,546,240 bytes (<= cap).
  // decodeFramePacketHeader never allocates, so this proves the boundary is
  // handled purely via header arithmetic without a 32 MiB buffer.
  const FramePacketHeader atCap = makeValidHeader(7680, 1456);
  expect(
      atCap.payloadBytes == 33546240ull,
      "max-payload boundary: 7680x1456 BGR24 == 33,546,240 bytes");
  expect(
      atCap.payloadBytes <= kFramePacketMaxPayloadBytes,
      "max-payload boundary: largest representable payload is <= cap");
  expect(
      decodeStatusOf(atCap) == FramePacketDecodeStatus::Ok,
      "max-payload boundary: largest valid payload at/below cap is accepted");

  // Next representable valid payload above the cap: height=1457 ->
  // 23040 * 1457 = 33,569,280 bytes (> cap). 33,554,432 (the raw 32 MiB cap)
  // is not divisible by 3, so no exact-32-MiB BGR24 payload can exist; this
  // is the correct boundary case, not an exact-cap accept.
  const FramePacketHeader aboveCap = makeValidHeader(7680, 1457);
  expect(
      aboveCap.payloadBytes == 33569280ull,
      "max-payload boundary: 7680x1457 BGR24 == 33,569,280 bytes");
  expect(
      aboveCap.payloadBytes > kFramePacketMaxPayloadBytes,
      "max-payload boundary: next representable payload exceeds cap");
  expect(
      decodeStatusOf(aboveCap) == FramePacketDecodeStatus::PayloadTooLarge,
      "max-payload boundary: next representable payload above cap is "
      "rejected as PayloadTooLarge");

  // A header that declares payloadBytes == 33,554,432 (the raw cap value,
  // which cannot equal any real width*height*3) together with a valid
  // width/height must be rejected as LengthMismatch, not treated as a valid
  // boundary case.
  FramePacketHeader exactCapDeclared = makeValidHeader(4, 3);
  exactCapDeclared.payloadBytes = kFramePacketMaxPayloadBytes;
  expect(
      decodeStatusOf(exactCapDeclared) == FramePacketDecodeStatus::LengthMismatch,
      "max-payload boundary: exact-cap payloadBytes disagreeing with "
      "width*height*3 is rejected as LengthMismatch");
}

void testZeroDimensions() {
  expect(
      decodeStatusOf(makeValidHeader(0, 3)) ==
          FramePacketDecodeStatus::DimensionOutOfRange,
      "zero width is rejected as DimensionOutOfRange");
  expect(
      decodeStatusOf(makeValidHeader(4, 0)) ==
          FramePacketDecodeStatus::DimensionOutOfRange,
      "zero height is rejected as DimensionOutOfRange");
}

void testWidthHeightLimits() {
  expect(
      decodeStatusOf(makeValidHeader(7680, 1)) ==
          FramePacketDecodeStatus::Ok,
      "width at the 7680 max is accepted (small height keeps payload in "
      "bounds)");
  expect(
      decodeStatusOf(makeValidHeader(7681, 1)) ==
          FramePacketDecodeStatus::DimensionOutOfRange,
      "width one past the 7680 max is rejected as DimensionOutOfRange");
  expect(
      decodeStatusOf(makeValidHeader(1, 4320)) ==
          FramePacketDecodeStatus::Ok,
      "height at the 4320 max is accepted (small width keeps payload in "
      "bounds)");
  expect(
      decodeStatusOf(makeValidHeader(1, 4321)) ==
          FramePacketDecodeStatus::DimensionOutOfRange,
      "height one past the 4320 max is rejected as DimensionOutOfRange");
}

void testStrideMismatch() {
  FramePacketHeader header = makeValidHeader(4, 3);
  header.rowStrideBytes = 13;  // should be 12 (width * 3)
  expect(
      decodeStatusOf(header) == FramePacketDecodeStatus::StrideMismatch,
      "rowStrideBytes != width*3 is rejected as StrideMismatch");
}

void testMultiplicationOverflowSafety() {
  // rowStrideBytes at UINT32_MAX must not wrap when compared against
  // width*3; it must be rejected as an ordinary stride mismatch, not crash
  // or be silently accepted via 32-bit wraparound.
  FramePacketHeader strideHeader = makeValidHeader(7680, 1);
  strideHeader.rowStrideBytes = 4294967295u;
  expect(
      decodeStatusOf(strideHeader) == FramePacketDecodeStatus::StrideMismatch,
      "near-UINT32_MAX rowStrideBytes is safely rejected as StrideMismatch "
      "(no silent overflow wraparound)");

  // payloadBytes at UINT64_MAX must not wrap when compared against
  // rowStride*height; it must be rejected as an ordinary length mismatch.
  FramePacketHeader payloadHeader = makeValidHeader(7680, 4320);
  payloadHeader.payloadBytes = 18446744073709551615ull;  // UINT64_MAX
  expect(
      decodeStatusOf(payloadHeader) == FramePacketDecodeStatus::LengthMismatch,
      "UINT64_MAX payloadBytes is safely rejected as LengthMismatch (no "
      "silent overflow wraparound)");
}

void testOversizedDeclaration() {
  const FramePacketHeader header = makeValidHeader(7680, 4320);
  expect(
      header.payloadBytes == 99532800ull,
      "oversized declaration: 7680x4320 BGR24 == 99,532,800 bytes");
  expect(
      decodeStatusOf(header) == FramePacketDecodeStatus::PayloadTooLarge,
      "oversized declaration: consistent but over-cap payload is rejected "
      "as PayloadTooLarge");
}

void testBadMagicVersionHeaderSizeFormat() {
  const FramePacketHeader header = makeValidHeader(4, 3);
  std::uint8_t bytes[kFramePacketHeaderBytes];
  FramePacketHeader decoded;

  lvk::tracker::encodeFramePacketHeader(header, bytes);
  std::uint8_t badMagic[kFramePacketHeaderBytes];
  std::copy(bytes, bytes + kFramePacketHeaderBytes, badMagic);
  badMagic[0] = static_cast<std::uint8_t>('X');
  expect(
      lvk::tracker::decodeFramePacketHeader(
          badMagic, kFramePacketHeaderBytes, decoded) ==
          FramePacketDecodeStatus::BadMagic,
      "corrupted magic bytes rejected as BadMagic");

  std::uint8_t badVersion[kFramePacketHeaderBytes];
  std::copy(bytes, bytes + kFramePacketHeaderBytes, badVersion);
  badVersion[4] = 2;  // version LE low byte
  badVersion[5] = 0;
  expect(
      lvk::tracker::decodeFramePacketHeader(
          badVersion, kFramePacketHeaderBytes, decoded) ==
          FramePacketDecodeStatus::BadVersion,
      "version != 1 rejected as BadVersion");

  std::uint8_t badHeaderSize[kFramePacketHeaderBytes];
  std::copy(bytes, bytes + kFramePacketHeaderBytes, badHeaderSize);
  badHeaderSize[6] = 47;  // header size LE low byte
  badHeaderSize[7] = 0;
  expect(
      lvk::tracker::decodeFramePacketHeader(
          badHeaderSize, kFramePacketHeaderBytes, decoded) ==
          FramePacketDecodeStatus::BadHeaderSize,
      "header size != 48 rejected as BadHeaderSize");

  FramePacketHeader badFormatHeader = header;
  badFormatHeader.pixelFormat = 2;  // only 1 (BGR24) is supported
  expect(
      decodeStatusOf(badFormatHeader) == FramePacketDecodeStatus::BadFormat,
      "pixelFormat != 1 (BGR24) rejected as BadFormat");
}

void testTruncatedHeader() {
  const FramePacketHeader header = makeValidHeader(4, 3);
  std::uint8_t bytes[kFramePacketHeaderBytes];
  lvk::tracker::encodeFramePacketHeader(header, bytes);
  FramePacketHeader decoded;

  expect(
      lvk::tracker::decodeFramePacketHeader(bytes, 0, decoded) ==
          FramePacketDecodeStatus::NeedMoreHeaderBytes,
      "zero-length buffer reports NeedMoreHeaderBytes, no allocation");
  expect(
      lvk::tracker::decodeFramePacketHeader(bytes, 1, decoded) ==
          FramePacketDecodeStatus::NeedMoreHeaderBytes,
      "1-byte buffer reports NeedMoreHeaderBytes");
  expect(
      lvk::tracker::decodeFramePacketHeader(
          bytes, kFramePacketHeaderBytes - 1, decoded) ==
          FramePacketDecodeStatus::NeedMoreHeaderBytes,
      "47-byte (one short) buffer reports NeedMoreHeaderBytes");
  expect(
      lvk::tracker::decodeFramePacketHeader(
          bytes, kFramePacketHeaderBytes, decoded) ==
          FramePacketDecodeStatus::Ok,
      "exact 48-byte buffer decodes Ok");
}

void testTruncatedPayload() {
  const FramePacketHeader header = makeValidHeader(4, 3);  // payloadBytes=36
  expect(
      !lvk::tracker::framePacketPayloadReady(header, 0),
      "truncated payload: 0 of 36 bytes is not ready");
  expect(
      !lvk::tracker::framePacketPayloadReady(header, 35),
      "truncated payload: 35 of 36 bytes is not ready");
  expect(
      lvk::tracker::framePacketPayloadReady(header, 36),
      "truncated payload: exactly 36 of 36 bytes is ready");
  expect(
      !lvk::tracker::framePacketPayloadReady(header, 37),
      "truncated payload: 37 of 36 bytes (over-read) is not reported ready");
}

void testExactLittleEndianBytes() {
  FramePacketHeader header;
  header.sequence = 0x1122334455667788ull;
  header.frameTimestampMs = -1;  // exercises the full-ones bit pattern
  header.width = 4;
  header.height = 3;
  header.rowStrideBytes = 12;
  header.pixelFormat = kFramePacketFormatBgr24;
  header.payloadBytes = 36;

  std::uint8_t bytes[kFramePacketHeaderBytes];
  lvk::tracker::encodeFramePacketHeader(header, bytes);

  const std::uint8_t expected[kFramePacketHeaderBytes] = {
      // magic "LVKF"
      0x4C, 0x56, 0x4B, 0x46,
      // version = 1 (LE u16)
      0x01, 0x00,
      // header size = 48 (LE u16)
      0x30, 0x00,
      // sequence = 0x1122334455667788 (LE u64)
      0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11,
      // frameTimestampMs = -1 (LE i64 bit pattern: all ones)
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      // width = 4 (LE u32)
      0x04, 0x00, 0x00, 0x00,
      // height = 3 (LE u32)
      0x03, 0x00, 0x00, 0x00,
      // rowStrideBytes = 12 (LE u32)
      0x0C, 0x00, 0x00, 0x00,
      // pixelFormat = 1 (LE u32)
      0x01, 0x00, 0x00, 0x00,
      // payloadBytes = 36 (LE u64)
      0x24, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  };

  bool exact = true;
  for (std::size_t index = 0; index < kFramePacketHeaderBytes; ++index) {
    if (bytes[index] != expected[index]) {
      exact = false;
      break;
    }
  }
  expect(exact, "encoded header matches the exact little-endian byte layout");

  FramePacketHeader decoded;
  const FramePacketDecodeStatus status =
      lvk::tracker::decodeFramePacketHeader(
          bytes, kFramePacketHeaderBytes, decoded);
  expect(
      status == FramePacketDecodeStatus::Ok,
      "exact-bytes header (including negative timestamp) decodes Ok");
  expect(
      decoded.frameTimestampMs == -1,
      "negative frameTimestampMs round-trips exactly");
  expect(
      decoded.sequence == 0x1122334455667788ull,
      "large sequence value round-trips exactly");
}

void testDeterministicChecksum() {
  const std::uint32_t emptyHash = lvk::tracker::fnv1a32(nullptr, 0);
  expect(
      emptyHash == 2166136261u,
      "fnv1a32(empty) equals the FNV-1a32 offset basis (2166136261)");

  const std::string marker = "LVKF-frame-packet-smoke";
  const auto* data = reinterpret_cast<const std::uint8_t*>(marker.data());
  const std::uint32_t hashOne = lvk::tracker::fnv1a32(data, marker.size());
  const std::uint32_t hashTwo = lvk::tracker::fnv1a32(data, marker.size());
  expect(hashOne == hashTwo, "fnv1a32 is deterministic across repeated calls");
  expect(
      hashOne == 1576141941u,
      "fnv1a32(\"LVKF-frame-packet-smoke\") matches the known FNV-1a32 value "
      "(1576141941 / 0x5df20475)");

  const std::string other = "LVKF-frame-packet-smokeX";
  const auto* otherData = reinterpret_cast<const std::uint8_t*>(other.data());
  const std::uint32_t hashOther =
      lvk::tracker::fnv1a32(otherData, other.size());
  expect(
      hashOther != hashOne,
      "fnv1a32 differs for different input (basic sanity, not a collision "
      "guarantee)");
}

void testNormalizeBgr24RowsContiguous() {
  // A tightly-packed 2x2 BGR24 source (stride == width*3) must copy through
  // byte-for-byte.
  const std::uint8_t src[12] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  std::vector<std::uint8_t> dest;
  const FrameNormalizeStatus status =
      lvk::tracker::normalizeBgr24Rows(src, 2, 2, 6, dest);
  expect(
      status == FrameNormalizeStatus::Ok,
      "normalizeBgr24Rows: contiguous 2x2 source normalizes Ok");
  expect(
      dest.size() == 12, "normalizeBgr24Rows: contiguous output is width*height*3");
  bool matches = true;
  for (std::size_t index = 0; index < dest.size(); ++index) {
    if (dest[index] != src[index]) {
      matches = false;
      break;
    }
  }
  expect(matches, "normalizeBgr24Rows: contiguous output matches source exactly");
}

void testNormalizeBgr24RowsStripsPadding() {
  // A 2x2 BGR24 source with 2 bytes of row padding (stride=8, width*3=6).
  // Sentinel bytes (0xEE) mark the padding that must never appear in output.
  const std::uint8_t src[16] = {
      1, 2, 3, 4, 5, 6, 0xEE, 0xEE,       // row 0: pixels + padding
      7, 8, 9, 10, 11, 12, 0xEE, 0xEE,    // row 1: pixels + padding
  };
  std::vector<std::uint8_t> dest;
  const FrameNormalizeStatus status =
      lvk::tracker::normalizeBgr24Rows(src, 2, 2, 8, dest);
  expect(
      status == FrameNormalizeStatus::Ok,
      "normalizeBgr24Rows: padded 2x2 source normalizes Ok");
  const std::uint8_t expected[12] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  expect(
      dest.size() == 12,
      "normalizeBgr24Rows: padded output is tightly packed (width*height*3)");
  bool matches = dest.size() == 12;
  for (std::size_t index = 0; matches && index < dest.size(); ++index) {
    if (dest[index] != expected[index]) {
      matches = false;
    }
  }
  expect(matches, "normalizeBgr24Rows: row padding is stripped from output");
}

void testNormalizeBgr24RowsRejectsBadInput() {
  const std::uint8_t src[16] = {0};
  std::vector<std::uint8_t> dest;
  expect(
      lvk::tracker::normalizeBgr24Rows(src, 0, 2, 8, dest) ==
          FrameNormalizeStatus::InvalidDimensions,
      "normalizeBgr24Rows: zero width rejected as InvalidDimensions");
  expect(
      lvk::tracker::normalizeBgr24Rows(src, 2, 2, 5, dest) ==
          FrameNormalizeStatus::StrideTooSmall,
      "normalizeBgr24Rows: srcRowStrideBytes < width*3 rejected as "
      "StrideTooSmall");
  expect(
      lvk::tracker::normalizeBgr24Rows(nullptr, 2, 2, 8, dest) ==
          FrameNormalizeStatus::InvalidDimensions,
      "normalizeBgr24Rows: null source rejected as InvalidDimensions");
}

int runDefaultSmoke() {
  testValidPacketRoundTrip();
  testExactHeaderSize();
  testMaxPayloadBoundaryWithoutLargeAllocation();
  testZeroDimensions();
  testWidthHeightLimits();
  testStrideMismatch();
  testMultiplicationOverflowSafety();
  testOversizedDeclaration();
  testBadMagicVersionHeaderSizeFormat();
  testTruncatedHeader();
  testTruncatedPayload();
  testExactLittleEndianBytes();
  testDeterministicChecksum();
  testNormalizeBgr24RowsContiguous();
  testNormalizeBgr24RowsStripsPadding();
  testNormalizeBgr24RowsRejectsBadInput();

  if (gFailures != 0) {
    std::cerr << "[helper-frame-packet-smoke] " << gFailures
              << " assertion(s) failed.\n";
    return 1;
  }
  std::cout << "helper-frame-packet smoke OK\n";
  return 0;
}

std::string toLowerHex(const std::vector<std::uint8_t>& bytes) {
  static const char kDigits[] = "0123456789abcdef";
  std::string out;
  out.reserve(bytes.size() * 2);
  for (std::uint8_t byteValue : bytes) {
    out.push_back(kDigits[(byteValue >> 4) & 0x0F]);
    out.push_back(kDigits[byteValue & 0x0F]);
  }
  return out;
}

// v0.13.0 (#535): opt-in, test-only fixture mode. Builds one tiny synthetic
// request/header/payload fixture using the actual current
// encodeFramePacketHeader() and fnv1a32(), and emits exactly three
// LF-delimited lines (request JSON, packet hex, checksum decimal) so a
// separate Python decoder/test can prove real cross-runtime parity. The
// request JSON line is a source-mirrored synthetic fixture, not a call into
// HelperProcessSession's private buildRequestLine(). No camera, file,
// network, or temp-file I/O; no diagnostic payload/path content on failure.
int runEmitPythonFrameInputFixture() {
#ifdef _WIN32
  // Ensures each LF delimiter below stays exactly one literal '\n' byte
  // instead of being translated to CRLF by a text-mode stdout.
  _setmode(_fileno(stdout), _O_BINARY);
#endif

  using lvk::tracker::FramePacketHeader;
  using lvk::tracker::kFramePacketFormatBgr24;
  using lvk::tracker::kFramePacketHeaderBytes;

  FramePacketHeader header;
  header.sequence = 7;
  header.frameTimestampMs = -123;
  header.width = 2;
  header.height = 2;
  header.rowStrideBytes = 6;
  header.pixelFormat = kFramePacketFormatBgr24;
  header.payloadBytes = 12;

  std::uint8_t headerBytes[kFramePacketHeaderBytes];
  lvk::tracker::encodeFramePacketHeader(header, headerBytes);

  const std::vector<std::uint8_t> payload = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};
  const std::uint32_t checksum =
      lvk::tracker::fnv1a32(payload.data(), payload.size());

  std::vector<std::uint8_t> packetBytes(
      headerBytes, headerBytes + kFramePacketHeaderBytes);
  packetBytes.insert(packetBytes.end(), payload.begin(), payload.end());

  const std::string requestLine =
      "{\"type\":\"request\",\"schemaVersion\":1,\"requestId\":7,"
      "\"frameTimestampMs\":-123}";
  const std::string packetHex = toLowerHex(packetBytes);
  const std::string checksumDecimal = std::to_string(checksum);

  if (std::fputs(requestLine.c_str(), stdout) == EOF ||
      std::fputc('\n', stdout) == EOF ||
      std::fputs(packetHex.c_str(), stdout) == EOF ||
      std::fputc('\n', stdout) == EOF ||
      std::fputs(checksumDecimal.c_str(), stdout) == EOF ||
      std::fputc('\n', stdout) == EOF || std::fflush(stdout) == EOF) {
    std::cerr << "[helper-frame-packet-smoke] fixture write failed\n";
    return 1;
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 1) {
    return runDefaultSmoke();
  }
  if (argc == 2 &&
      std::string(argv[1]) == "--emit-python-frame-input-fixture") {
    return runEmitPythonFrameInputFixture();
  }
  std::cerr << "[helper-frame-packet-smoke] unknown argument(s)\n";
  return 1;
}
