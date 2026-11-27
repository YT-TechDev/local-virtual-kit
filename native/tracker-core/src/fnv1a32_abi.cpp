#include "fnv1a32_abi.h"

#include <cstddef>
#include <cstdint>
#include <limits>

#include "helper_frame_packet.h"

// P2-A: thin C ABI over the existing lvk::tracker::fnv1a32(). This file adds
// validation only; the checksum arithmetic is the unchanged Native Core
// implementation in helper_frame_packet.cpp. See fnv1a32_abi.h for the full
// contract.

namespace {

static_assert(
    lvk::tracker::kFramePacketMaxPayloadBytes <=
        static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max()),
    "frame packet maximum payload must be representable as size_t");

constexpr std::size_t kMaxInputBytes =
    static_cast<std::size_t>(lvk::tracker::kFramePacketMaxPayloadBytes);

}  // namespace

extern "C" {

LVK_FNV1A32_API uint32_t LVK_FNV1A32_CALL lvk_fnv1a32_abi_version(void)
    LVK_FNV1A32_NOEXCEPT {
  return LVK_FNV1A32_ABI_VERSION;
}

LVK_FNV1A32_API size_t LVK_FNV1A32_CALL lvk_fnv1a32_max_len(void)
    LVK_FNV1A32_NOEXCEPT {
  return kMaxInputBytes;
}

LVK_FNV1A32_API int LVK_FNV1A32_CALL lvk_fnv1a32_v1(
    const uint8_t* data, size_t length, uint32_t* output) LVK_FNV1A32_NOEXCEPT {
  // Every check below compares pointer values and the length only; neither
  // `data` nor `output` is dereferenced until all three have passed.
  if (output == nullptr) {
    return LVK_FNV1A32_STATUS_NULL_OUTPUT;
  }
  if (length > kMaxInputBytes) {
    return LVK_FNV1A32_STATUS_LENGTH_EXCEEDED;
  }
  if (data == nullptr && length != 0) {
    return LVK_FNV1A32_STATUS_NULL_INPUT;
  }

  // lvk::tracker::fnv1a32 never reads data when len == 0, so a NULL data
  // pointer with zero length yields the offset basis without a dereference.
  *output = lvk::tracker::fnv1a32(data, length);
  return LVK_FNV1A32_STATUS_OK;
}

}  // extern "C"
