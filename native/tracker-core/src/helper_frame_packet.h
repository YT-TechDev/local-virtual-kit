#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace lvk::tracker {

// v0.13.0 bounded private frame transport packet module (#534).
//
// Pure, dependency-free binary packet framing for the private parent->child
// frame pipe used by the opt-in synthetic-frame-helper backend. This module
// never includes OpenCV and never touches cv::Mat: callers supply raw byte
// spans only. It has no process, pipe, or IPC dependency and links cleanly
// into lvk-tracker-core, lvk-synthetic-helper, and CI-only smoke executables
// with zero OpenCV installed.
//
// Fixed 48-byte little-endian header (v1):
//   offset  size  field
//   0       4     magic bytes: "LVKF"
//   4       2     version: 1
//   6       2     header size: 48
//   8       8     transport sequence (uint64)
//   16      8     frame timestamp ms (int64)
//   24      4     width (uint32)
//   28      4     height (uint32)
//   32      4     row stride bytes (uint32)
//   36      4     pixel format (uint32; 1 = BGR24)
//   40      8     payload byte length (uint64)
//
// One format only: contiguous BGR24. The transport sequence is always the
// outstanding HelperProcessSession requestId; there is no second correlation
// counter.

constexpr std::size_t kFramePacketHeaderBytes = 48;
constexpr std::uint16_t kFramePacketVersion = 1;
constexpr std::uint32_t kFramePacketFormatBgr24 = 1;
constexpr std::uint32_t kFramePacketMinWidth = 1;
constexpr std::uint32_t kFramePacketMaxWidth = 7680;
constexpr std::uint32_t kFramePacketMinHeight = 1;
constexpr std::uint32_t kFramePacketMaxHeight = 4320;
constexpr std::uint64_t kFramePacketMaxPayloadBytes = 32ull * 1024ull * 1024ull;

struct FramePacketHeader {
  std::uint64_t sequence = 0;
  long long frameTimestampMs = 0;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t rowStrideBytes = 0;
  std::uint32_t pixelFormat = 0;
  std::uint64_t payloadBytes = 0;
};

enum class FramePacketDecodeStatus {
  Ok,
  NeedMoreHeaderBytes,
  BadMagic,
  BadVersion,
  BadHeaderSize,
  BadFormat,
  DimensionOutOfRange,
  StrideMismatch,
  LengthMismatch,
  PayloadTooLarge,
};

const char* framePacketDecodeStatusLabel(FramePacketDecodeStatus status);

// Encodes `header` into exactly kFramePacketHeaderBytes little-endian bytes
// using explicit byte-shift writes. Never serializes a C++ struct with
// memcpy (avoids padding/alignment/endianness bugs).
void encodeFramePacketHeader(
    const FramePacketHeader& header,
    std::uint8_t out[kFramePacketHeaderBytes]);

// Decodes and fully validates a packet header from `data`/`len`.
//   - len < kFramePacketHeaderBytes -> NeedMoreHeaderBytes (no allocation, no
//     partial decode; caller should keep accumulating bytes).
//   - otherwise: magic, version, header size, pixel format, width/height
//     bounds, stride (== width*3), and payload length (== rowStride*height,
//     <= 32 MiB) are all checked, in that order, before Ok is returned.
// All bound/length comparisons use uint64_t intermediates so no multiply or
// add can silently wrap. `out` is only written on Ok.
FramePacketDecodeStatus decodeFramePacketHeader(
    const std::uint8_t* data, std::size_t len, FramePacketHeader& out);

// True only when exactly header.payloadBytes have been supplied so far. Lets
// callers (and tests) distinguish a truncated payload from a complete one
// without any pipe/IPC involvement.
bool framePacketPayloadReady(
    const FramePacketHeader& header, std::size_t receivedPayloadBytes);

// Deterministic FNV-1a 32-bit checksum. Used only for the internal frameAck
// cross-check between Native Core and the helper; not a cryptographic
// guarantee.
std::uint32_t fnv1a32(const std::uint8_t* data, std::size_t len);

enum class FrameNormalizeStatus {
  Ok,
  InvalidDimensions,
  StrideTooSmall,
  Overflow,
};

// Copies a width x height BGR24 image out of a (possibly row-padded) source
// view into `destPayload`, producing exactly width*height*3 tightly-packed
// bytes (destPayload is resized to that size on success; left untouched on
// failure). srcRowStrideBytes must be >= width*3. This is the only row-copy
// implementation in the codebase: the OpenCV backend passes
// (cv::Mat::data, .step) and pure smoke tests pass a synthetic strided
// buffer through this exact same function, so there is no duplicated
// normalization logic anywhere else.
FrameNormalizeStatus normalizeBgr24Rows(
    const std::uint8_t* srcData,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t srcRowStrideBytes,
    std::vector<std::uint8_t>& destPayload);

}  // namespace lvk::tracker
