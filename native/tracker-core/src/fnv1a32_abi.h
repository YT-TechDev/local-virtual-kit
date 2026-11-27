#ifndef LVK_FNV1A32_ABI_H
#define LVK_FNV1A32_ABI_H

/*
 * LVK Native Core FNV-1a 32-bit checksum C ABI, version 1 (P2-A).
 *
 * Minimal, versioned, C-linkage surface over the existing Native Core
 * lvk::tracker::fnv1a32() implementation (helper_frame_packet.cpp), built
 * as the standalone `lvk-fnv1a32` shared library. It exists so a future,
 * separately approved caller can compute the private frame-transport
 * checksum without reimplementing it. Nothing in Native Core, the Python
 * helper, Electron, or Web Preview loads this library today.
 *
 * Exported symbols (exactly these three, nothing else):
 *   lvk_fnv1a32_abi_version()  -> LVK_FNV1A32_ABI_VERSION (1)
 *   lvk_fnv1a32_max_len()      -> maximum accepted input length in bytes,
 *                                 equal to the Native frame packet maximum
 *                                 payload (kFramePacketMaxPayloadBytes,
 *                                 currently 32 MiB)
 *   lvk_fnv1a32_v1(data, length, output)
 *
 * lvk_fnv1a32_v1 status codes:
 *   0 LVK_FNV1A32_STATUS_OK               *output = FNV-1a32(data[0..length))
 *   1 LVK_FNV1A32_STATUS_NULL_OUTPUT      output == NULL
 *   2 LVK_FNV1A32_STATUS_NULL_INPUT       data == NULL and length != 0
 *   3 LVK_FNV1A32_STATUS_LENGTH_EXCEEDED  length > lvk_fnv1a32_max_len()
 * Checks run in exactly that order (output, length, input) and all of them
 * complete before either pointer is dereferenced. data == NULL is accepted
 * only when length == 0 (result: the FNV-1a32 offset basis 0x811C9DC5).
 * On any nonzero status *output is never written.
 *
 * Caller obligations: on success the library reads exactly `length` bytes
 * starting at `data` and writes exactly one uint32_t to `output`. The
 * caller must supply `length` readable bytes at `data` and a writable,
 * suitably aligned uint32_t at `output` for the duration of the call. The
 * NULL and length checks above do NOT establish that an arbitrary non-NULL
 * pointer is valid; passing an invalid pointer is undefined behavior.
 *
 * Guarantees: input bytes are never modified; no pointer is retained after
 * return; no dynamic allocation; no mutable global state (calls are
 * reentrant and thread-safe); no exception ever crosses the ABI boundary.
 * Calling convention is the platform C convention (__cdecl on Windows).
 */

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#if defined(LVK_FNV1A32_BUILDING)
#define LVK_FNV1A32_API __declspec(dllexport)
#else
#define LVK_FNV1A32_API __declspec(dllimport)
#endif
#define LVK_FNV1A32_CALL __cdecl
#else
#if defined(LVK_FNV1A32_BUILDING)
#define LVK_FNV1A32_API __attribute__((visibility("default")))
#else
#define LVK_FNV1A32_API
#endif
#define LVK_FNV1A32_CALL
#endif

#if defined(__cplusplus)
#define LVK_FNV1A32_NOEXCEPT noexcept
#else
#define LVK_FNV1A32_NOEXCEPT
#endif

#define LVK_FNV1A32_ABI_VERSION 1u

#define LVK_FNV1A32_STATUS_OK 0
#define LVK_FNV1A32_STATUS_NULL_OUTPUT 1
#define LVK_FNV1A32_STATUS_NULL_INPUT 2
#define LVK_FNV1A32_STATUS_LENGTH_EXCEEDED 3

#if defined(__cplusplus)
extern "C" {
#endif

LVK_FNV1A32_API uint32_t LVK_FNV1A32_CALL lvk_fnv1a32_abi_version(void)
    LVK_FNV1A32_NOEXCEPT;

LVK_FNV1A32_API size_t LVK_FNV1A32_CALL lvk_fnv1a32_max_len(void)
    LVK_FNV1A32_NOEXCEPT;

LVK_FNV1A32_API int LVK_FNV1A32_CALL lvk_fnv1a32_v1(
    const uint8_t* data, size_t length, uint32_t* output) LVK_FNV1A32_NOEXCEPT;

#if defined(__cplusplus)
}
#endif

#endif /* LVK_FNV1A32_ABI_H */
