#include "helper_frame_packet.h"

#include <cstring>

namespace lvk::tracker {
namespace {

void writeLE16(std::uint8_t* out, std::uint16_t value) {
  out[0] = static_cast<std::uint8_t>(value & 0xFFu);
  out[1] = static_cast<std::uint8_t>((value >> 8) & 0xFFu);
}

void writeLE32(std::uint8_t* out, std::uint32_t value) {
  out[0] = static_cast<std::uint8_t>(value & 0xFFu);
  out[1] = static_cast<std::uint8_t>((value >> 8) & 0xFFu);
  out[2] = static_cast<std::uint8_t>((value >> 16) & 0xFFu);
  out[3] = static_cast<std::uint8_t>((value >> 24) & 0xFFu);
}

void writeLE64(std::uint8_t* out, std::uint64_t value) {
  for (int index = 0; index < 8; ++index) {
    out[index] = static_cast<std::uint8_t>((value >> (8 * index)) & 0xFFu);
  }
}

std::uint16_t readLE16(const std::uint8_t* data) {
  return static_cast<std::uint16_t>(
      static_cast<std::uint16_t>(data[0]) |
      (static_cast<std::uint16_t>(data[1]) << 8));
}

std::uint32_t readLE32(const std::uint8_t* data) {
  return static_cast<std::uint32_t>(data[0]) |
         (static_cast<std::uint32_t>(data[1]) << 8) |
         (static_cast<std::uint32_t>(data[2]) << 16) |
         (static_cast<std::uint32_t>(data[3]) << 24);
}

std::uint64_t readLE64(const std::uint8_t* data) {
  std::uint64_t value = 0;
  for (int index = 7; index >= 0; --index) {
    value = (value << 8) | static_cast<std::uint64_t>(data[index]);
  }
  return value;
}

}  // namespace

const char* framePacketDecodeStatusLabel(FramePacketDecodeStatus status) {
  switch (status) {
    case FramePacketDecodeStatus::Ok:
      return "ok";
    case FramePacketDecodeStatus::NeedMoreHeaderBytes:
      return "need-more-header-bytes";
    case FramePacketDecodeStatus::BadMagic:
      return "bad-magic";
    case FramePacketDecodeStatus::BadVersion:
      return "bad-version";
    case FramePacketDecodeStatus::BadHeaderSize:
      return "bad-header-size";
    case FramePacketDecodeStatus::BadFormat:
      return "bad-format";
    case FramePacketDecodeStatus::DimensionOutOfRange:
      return "dimension-out-of-range";
    case FramePacketDecodeStatus::StrideMismatch:
      return "stride-mismatch";
    case FramePacketDecodeStatus::LengthMismatch:
      return "length-mismatch";
    case FramePacketDecodeStatus::PayloadTooLarge:
      return "payload-too-large";
  }
  return "unknown";
}

void encodeFramePacketHeader(
    const FramePacketHeader& header,
    std::uint8_t out[kFramePacketHeaderBytes]) {
  out[0] = static_cast<std::uint8_t>('L');
  out[1] = static_cast<std::uint8_t>('V');
  out[2] = static_cast<std::uint8_t>('K');
  out[3] = static_cast<std::uint8_t>('F');
  writeLE16(out + 4, kFramePacketVersion);
  writeLE16(out + 6, static_cast<std::uint16_t>(kFramePacketHeaderBytes));
  writeLE64(out + 8, header.sequence);
  writeLE64(out + 16, static_cast<std::uint64_t>(header.frameTimestampMs));
  writeLE32(out + 24, header.width);
  writeLE32(out + 28, header.height);
  writeLE32(out + 32, header.rowStrideBytes);
  writeLE32(out + 36, header.pixelFormat);
  writeLE64(out + 40, header.payloadBytes);
}

FramePacketDecodeStatus decodeFramePacketHeader(
    const std::uint8_t* data, std::size_t len, FramePacketHeader& out) {
  if (data == nullptr || len < kFramePacketHeaderBytes) {
    return FramePacketDecodeStatus::NeedMoreHeaderBytes;
  }

  if (data[0] != static_cast<std::uint8_t>('L') ||
      data[1] != static_cast<std::uint8_t>('V') ||
      data[2] != static_cast<std::uint8_t>('K') ||
      data[3] != static_cast<std::uint8_t>('F')) {
    return FramePacketDecodeStatus::BadMagic;
  }

  const std::uint16_t version = readLE16(data + 4);
  if (version != kFramePacketVersion) {
    return FramePacketDecodeStatus::BadVersion;
  }

  const std::uint16_t headerSize = readLE16(data + 6);
  if (headerSize != static_cast<std::uint16_t>(kFramePacketHeaderBytes)) {
    return FramePacketDecodeStatus::BadHeaderSize;
  }

  FramePacketHeader header;
  header.sequence = readLE64(data + 8);
  header.frameTimestampMs = static_cast<long long>(readLE64(data + 16));
  header.width = readLE32(data + 24);
  header.height = readLE32(data + 28);
  header.rowStrideBytes = readLE32(data + 32);
  header.pixelFormat = readLE32(data + 36);
  header.payloadBytes = readLE64(data + 40);

  if (header.pixelFormat != kFramePacketFormatBgr24) {
    return FramePacketDecodeStatus::BadFormat;
  }
  if (header.width < kFramePacketMinWidth ||
      header.width > kFramePacketMaxWidth ||
      header.height < kFramePacketMinHeight ||
      header.height > kFramePacketMaxHeight) {
    return FramePacketDecodeStatus::DimensionOutOfRange;
  }

  const std::uint64_t expectedStride =
      static_cast<std::uint64_t>(header.width) * 3ull;
  if (static_cast<std::uint64_t>(header.rowStrideBytes) != expectedStride) {
    return FramePacketDecodeStatus::StrideMismatch;
  }

  const std::uint64_t expectedPayload =
      expectedStride * static_cast<std::uint64_t>(header.height);
  if (header.payloadBytes != expectedPayload) {
    return FramePacketDecodeStatus::LengthMismatch;
  }
  if (header.payloadBytes > kFramePacketMaxPayloadBytes) {
    return FramePacketDecodeStatus::PayloadTooLarge;
  }

  out = header;
  return FramePacketDecodeStatus::Ok;
}

bool framePacketPayloadReady(
    const FramePacketHeader& header, std::size_t receivedPayloadBytes) {
  return static_cast<std::uint64_t>(receivedPayloadBytes) ==
         header.payloadBytes;
}

std::uint32_t fnv1a32(const std::uint8_t* data, std::size_t len) {
  std::uint32_t hash = 2166136261u;
  for (std::size_t index = 0; index < len; ++index) {
    hash ^= static_cast<std::uint32_t>(data[index]);
    hash *= 16777619u;
  }
  return hash;
}

FrameNormalizeStatus normalizeBgr24Rows(
    const std::uint8_t* srcData,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t srcRowStrideBytes,
    std::vector<std::uint8_t>& destPayload) {
  if (srcData == nullptr || width < kFramePacketMinWidth ||
      width > kFramePacketMaxWidth || height < kFramePacketMinHeight ||
      height > kFramePacketMaxHeight) {
    return FrameNormalizeStatus::InvalidDimensions;
  }

  const std::uint64_t destRowStride = static_cast<std::uint64_t>(width) * 3ull;
  if (static_cast<std::uint64_t>(srcRowStrideBytes) < destRowStride) {
    return FrameNormalizeStatus::StrideTooSmall;
  }

  const std::uint64_t totalBytes = destRowStride * static_cast<std::uint64_t>(height);
  if (totalBytes > kFramePacketMaxPayloadBytes) {
    return FrameNormalizeStatus::Overflow;
  }

  destPayload.assign(static_cast<std::size_t>(totalBytes), 0);
  for (std::uint32_t row = 0; row < height; ++row) {
    const std::uint8_t* srcRow =
        srcData + static_cast<std::uint64_t>(row) * srcRowStrideBytes;
    std::uint8_t* destRow =
        destPayload.data() + static_cast<std::uint64_t>(row) * destRowStride;
    std::memcpy(destRow, srcRow, static_cast<std::size_t>(destRowStride));
  }

  return FrameNormalizeStatus::Ok;
}

}  // namespace lvk::tracker
