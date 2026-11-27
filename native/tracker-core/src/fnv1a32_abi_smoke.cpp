// P2-A: deterministic behavioral smoke for the lvk-fnv1a32 shared library C
// ABI (fnv1a32_abi.h). Links the shared library through its exported C ABI
// only, plus helper_frame_packet.cpp so results can be compared with the
// existing Native lvk::tracker::fnv1a32() implementation. Expected values
// come from three independent sources: published FNV-1a 32-bit test vectors,
// constants precomputed offline with an independent reference implementation
// over a documented LCG payload generator, and an in-test reference loop.
// No camera, OpenCV, Python, MediaPipe, network, files, or process spawning.

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

#include "fnv1a32_abi.h"
#include "helper_frame_packet.h"

namespace {

int gChecks = 0;
int gFailures = 0;

void check(bool condition, const char* label) {
  ++gChecks;
  if (!condition) {
    ++gFailures;
    std::fprintf(stderr, "[fnv1a32-abi-smoke] FAIL %s\n", label);
  }
}

constexpr std::uint32_t kOffsetBasis = 0x811C9DC5u;
constexpr std::uint32_t kUntouched = 0xA5A5A5A5u;

// Address in the never-mapped low page range on both Windows (first 64 KiB
// reserved) and Linux (vm.mmap_min_addr). Passed only where the ABI contract
// requires rejection (or a zero-length read) before any dereference: a
// contract violation would crash this smoke instead of passing silently.
const std::uint8_t* unreadableAddress() {
  return reinterpret_cast<const std::uint8_t*>(
      static_cast<std::uintptr_t>(0x10u));
}

// Independent in-test FNV-1a 32 reference (not the wrapped implementation).
std::uint32_t referenceFnv1a32(const std::uint8_t* data, std::size_t len) {
  std::uint32_t hash = kOffsetBasis;
  for (std::size_t i = 0; i < len; ++i) {
    hash = (hash ^ data[i]) * 0x01000193u;
  }
  return hash;
}

// Deterministic payload generator. Offline constants below were produced by
// the same definition: s = s * 1664525 + 1013904223 (mod 2^32); byte = s >> 24.
std::vector<std::uint8_t> lcgPayload(std::size_t len, std::uint32_t seed) {
  std::vector<std::uint8_t> out(len);
  std::uint32_t state = seed;
  for (std::size_t i = 0; i < len; ++i) {
    state = state * 1664525u + 1013904223u;
    out[i] = static_cast<std::uint8_t>(state >> 24);
  }
  return out;
}

// Calls the ABI on a valid buffer and asserts status, value, parity with the
// existing Native implementation, and input immutability.
void expectChecksum(
    const std::uint8_t* data,
    std::size_t len,
    std::uint32_t expected,
    const char* label) {
  std::vector<std::uint8_t> snapshot;
  if (data != nullptr && len != 0) {
    snapshot.assign(data, data + len);
  }
  std::uint32_t out = kUntouched;
  const int status = lvk_fnv1a32_v1(data, len, &out);
  check(status == LVK_FNV1A32_STATUS_OK, label);
  check(out == expected, label);
  check(lvk::tracker::fnv1a32(data, len) == expected, label);
  if (!snapshot.empty()) {
    check(std::memcmp(snapshot.data(), data, len) == 0, label);
  }
  std::uint32_t again = kUntouched;
  check(lvk_fnv1a32_v1(data, len, &again) == LVK_FNV1A32_STATUS_OK, label);
  check(again == out, label);
}

void expectRejected(
    const std::uint8_t* data,
    std::size_t len,
    int expectedStatus,
    const char* label) {
  std::uint32_t out = kUntouched;
  check(lvk_fnv1a32_v1(data, len, &out) == expectedStatus, label);
  check(out == kUntouched, label);
}

const std::uint8_t* bytesOf(const char* text) {
  return reinterpret_cast<const std::uint8_t*>(text);
}

void testVersionAndLimit() {
  check(lvk_fnv1a32_abi_version() == 1u, "abi version is 1");
  check(lvk_fnv1a32_abi_version() == LVK_FNV1A32_ABI_VERSION,
        "abi version matches header");
  check(lvk_fnv1a32_max_len() == 32u * 1024u * 1024u, "max len is 32 MiB");
  check(static_cast<std::uint64_t>(lvk_fnv1a32_max_len()) ==
            lvk::tracker::kFramePacketMaxPayloadBytes,
        "max len equals frame packet max payload");
}

void testKnownAnswers() {
  // Published FNV-1a 32-bit test vectors.
  expectChecksum(bytesOf(""), 0, 0x811C9DC5u, "kat empty");
  expectChecksum(bytesOf("a"), 1, 0xE40C292Cu, "kat a");
  expectChecksum(bytesOf("b"), 1, 0xE70C2DE5u, "kat b");
  expectChecksum(bytesOf("c"), 1, 0xE60C2C52u, "kat c");
  expectChecksum(bytesOf("foobar"), 6, 0xBF9CF968u, "kat foobar");
  expectChecksum(
      bytesOf("chongo was here!\n"), 17, 0xD49930D5u, "kat chongo");
  // Embedded NUL bytes (explicit lengths, never strlen).
  expectChecksum(bytesOf("\0"), 1, 0x050C5D1Fu, "kat single nul");
  expectChecksum(bytesOf("a\0"), 2, 0x2B24D044u, "kat a nul");
  expectChecksum(bytesOf("foo\0bar"), 7, 0xC5ED6ECAu, "kat embedded nul");
  expectChecksum(bytesOf("\0\0\0\0"), 4, 0x4B95F515u, "kat four nuls");
}

void testEmptyInput() {
  expectChecksum(nullptr, 0, kOffsetBasis, "empty null data");
  const std::uint8_t one = 0x42;
  expectChecksum(&one, 0, kOffsetBasis, "empty non-null data");
  std::uint32_t out = kUntouched;
  check(lvk_fnv1a32_v1(unreadableAddress(), 0, &out) == LVK_FNV1A32_STATUS_OK,
        "empty unreadable data not dereferenced");
  check(out == kOffsetBasis, "empty unreadable data yields offset basis");
}

void testAllByteValues() {
  std::vector<std::uint8_t> ascending(256);
  std::vector<std::uint8_t> descending(256);
  for (int i = 0; i < 256; ++i) {
    ascending[static_cast<std::size_t>(i)] = static_cast<std::uint8_t>(i);
    descending[static_cast<std::size_t>(i)] =
        static_cast<std::uint8_t>(255 - i);
  }
  expectChecksum(ascending.data(), 256, 0x90A458C5u, "all bytes ascending");
  expectChecksum(descending.data(), 256, 0x4754B7C5u, "all bytes descending");
  for (int b = 0; b < 256; ++b) {
    const std::uint8_t value = static_cast<std::uint8_t>(b);
    expectChecksum(&value, 1, referenceFnv1a32(&value, 1), "single byte value");
  }
}

void testVariedLengths() {
  const std::vector<std::uint8_t> pool = lcgPayload((1u << 20) + 64u, 0x5EEDu);
  std::vector<std::size_t> lengths;
  for (std::size_t len = 0; len <= 300; ++len) {
    lengths.push_back(len);
  }
  for (std::size_t len : {511u, 512u, 513u, 1023u, 1024u, 1025u, 4095u,
                          4096u, 4097u, 65535u, 65536u, 65537u, 1048576u}) {
    lengths.push_back(len);
  }
  for (std::size_t offset : {0u, 1u, 3u, 7u}) {
    for (std::size_t len : lengths) {
      const std::uint8_t* start = pool.data() + offset;
      expectChecksum(start, len, referenceFnv1a32(start, len), "varied length");
    }
  }
}

void testFramePayloads() {
  struct Frame {
    std::uint32_t width;
    std::uint32_t height;
    std::uint32_t expected;
    const char* label;
  };
  const Frame frames[] = {
      {320, 240, 0x1BAB04C3u, "frame 320x240 bgr24"},
      {640, 480, 0x76330A05u, "frame 640x480 bgr24"},
      {1280, 720, 0x5F9C55A6u, "frame 1280x720 bgr24"},
  };
  for (const Frame& frame : frames) {
    const std::size_t len =
        static_cast<std::size_t>(frame.width) * frame.height * 3u;
    const std::vector<std::uint8_t> payload = lcgPayload(len, frame.width);
    expectChecksum(payload.data(), len, frame.expected, frame.label);
  }
}

void testMaximumPayload() {
  const std::size_t maxLen = lvk_fnv1a32_max_len();
  // One extra byte so max+1 is rejected on a genuinely readable buffer too.
  const std::vector<std::uint8_t> payload = lcgPayload(maxLen + 1u, 32u);
  expectChecksum(payload.data(), maxLen, 0xC684B98Du, "maximum payload");
  expectRejected(payload.data(), maxLen + 1u,
                 LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "max+1 on readable buffer rejected");
}

void testInvalidArguments() {
  const std::uint8_t buffer[16] = {1, 2, 3, 4, 5, 6, 7, 8,
                                   9, 10, 11, 12, 13, 14, 15, 16};
  const std::size_t maxLen = lvk_fnv1a32_max_len();
  const std::size_t sizeMax = std::numeric_limits<std::size_t>::max();

  // Null output (status 1), including when input is unreadable/oversized:
  // output is validated first and nothing is dereferenced.
  check(lvk_fnv1a32_v1(buffer, sizeof(buffer), nullptr) ==
            LVK_FNV1A32_STATUS_NULL_OUTPUT,
        "null output");
  check(lvk_fnv1a32_v1(nullptr, 0, nullptr) == LVK_FNV1A32_STATUS_NULL_OUTPUT,
        "null output with empty null input");
  check(lvk_fnv1a32_v1(unreadableAddress(), 16, nullptr) ==
            LVK_FNV1A32_STATUS_NULL_OUTPUT,
        "null output precedes input access");
  check(lvk_fnv1a32_v1(nullptr, sizeMax, nullptr) ==
            LVK_FNV1A32_STATUS_NULL_OUTPUT,
        "null output precedes length check");

  // Null input with nonzero length (status 2).
  expectRejected(nullptr, 1, LVK_FNV1A32_STATUS_NULL_INPUT, "null input len 1");
  expectRejected(nullptr, maxLen, LVK_FNV1A32_STATUS_NULL_INPUT,
                 "null input len max");

  // Oversized lengths (status 3), rejected before any input access: an
  // unreadable address would crash if read.
  expectRejected(buffer, maxLen + 1u, LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "max+1 rejected");
  expectRejected(buffer, sizeMax, LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "SIZE_MAX rejected");
  expectRejected(unreadableAddress(), maxLen + 1u,
                 LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "max+1 rejected before input access");
  expectRejected(unreadableAddress(), sizeMax,
                 LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "SIZE_MAX rejected before input access");
  expectRejected(unreadableAddress(), sizeMax / 2u + 1u,
                 LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "high-bit length rejected before input access");
  // Length check precedes the null-input check.
  expectRejected(nullptr, sizeMax, LVK_FNV1A32_STATUS_LENGTH_EXCEEDED,
                 "length precedes null input");

  const std::uint8_t expectedBuffer[16] = {1, 2, 3, 4, 5, 6, 7, 8,
                                           9, 10, 11, 12, 13, 14, 15, 16};
  check(std::memcmp(buffer, expectedBuffer, sizeof(buffer)) == 0,
        "input unchanged after rejected calls");
}

}  // namespace

int main() {
  testVersionAndLimit();
  testKnownAnswers();
  testEmptyInput();
  testAllByteValues();
  testVariedLengths();
  testFramePayloads();
  testMaximumPayload();
  testInvalidArguments();

  if (gFailures != 0) {
    std::fprintf(stderr, "[fnv1a32-abi-smoke] FAIL failures=%d checks=%d\n",
                 gFailures, gChecks);
    return 1;
  }
  std::printf("[fnv1a32-abi-smoke] PASS abiVersion=%u maxLen=%zu checks=%d\n",
              static_cast<unsigned>(lvk_fnv1a32_abi_version()),
              lvk_fnv1a32_max_len(), gChecks);
  return 0;
}
