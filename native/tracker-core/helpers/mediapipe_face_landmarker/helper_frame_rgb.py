"""Converts one already-validated BGR24 frame input into an immutable RGB24 frame.

This module is dependency-free (standard library only) and must not import
MediaPipe, NumPy, OpenCV, PIL, or any other runtime/helper module besides the
exact source input type from `helper_frame_input`. It performs no I/O of any
kind: it only transforms an already-supplied in-memory value.

The adapter owns only channel reordering and its returned RGB byte value. It
retains no frame history and no global current-frame state: only the
caller-owned return value keeps the current frame bytes alive.

Because the frozen input dataclass can be manually constructed with
inconsistent values, every field is revalidated here rather than trusted, and
all type, bounds, stride, length, and checksum checks finish before the
full-frame channel conversion/allocation runs.
"""

from __future__ import annotations

from dataclasses import dataclass

from helper_frame_input import ValidatedHelperFrameInput

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1

_FRAME_MIN_WIDTH = 1
_FRAME_MAX_WIDTH = 7680
_FRAME_MIN_HEIGHT = 1
_FRAME_MAX_HEIGHT = 4320
_FRAME_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

# Mirrors the FNV-1a32 offset basis / prime used in helper_frame_input.py and
# by fnv1a32() in helper_frame_packet.cpp.
_FNV_OFFSET_BASIS = 2166136261
_FNV_PRIME = 16777619


@dataclass(frozen=True)
class ValidatedHelperRgb24Frame:
    request_id: int
    frame_timestamp_ms: int
    width: int
    height: int
    row_stride_bytes: int
    payload_bytes: int
    rgb24_bytes: bytes
    source_checksum: int


def _fnv1a32(data: bytes) -> int:
    hash_value = _FNV_OFFSET_BASIS
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * _FNV_PRIME) & 0xFFFFFFFF
    return hash_value


def _bgr24_to_rgb24(bgr24_bytes: bytes) -> bytes:
    converted = bytearray(bgr24_bytes)
    converted[0::3], converted[2::3] = converted[2::3], converted[0::3]
    return bytes(converted)


def convert_validated_helper_frame_input_to_rgb24(
    frame: ValidatedHelperFrameInput,
) -> ValidatedHelperRgb24Frame | None:
    """Revalidates and converts one BGR24 frame input into an RGB24 frame.

    `frame` must be exactly `type(frame) is ValidatedHelperFrameInput`
    (subclasses rejected). Every field is revalidated -- including
    recomputing the FNV-1a32 checksum of `bgr24_bytes` -- before the
    conversion/allocation runs. Ordinary invalid input returns `None`;
    unexpected programming failures remain visible.
    """
    if type(frame) is not ValidatedHelperFrameInput:
        return None

    request_id = frame.request_id
    if type(request_id) is not int:
        return None
    if not (1 <= request_id <= _INT64_MAX):
        return None

    frame_timestamp_ms = frame.frame_timestamp_ms
    if type(frame_timestamp_ms) is not int:
        return None
    if not (_INT64_MIN <= frame_timestamp_ms <= _INT64_MAX):
        return None

    width = frame.width
    if type(width) is not int:
        return None
    if not (_FRAME_MIN_WIDTH <= width <= _FRAME_MAX_WIDTH):
        return None

    height = frame.height
    if type(height) is not int:
        return None
    if not (_FRAME_MIN_HEIGHT <= height <= _FRAME_MAX_HEIGHT):
        return None

    row_stride_bytes = frame.row_stride_bytes
    if type(row_stride_bytes) is not int:
        return None
    if row_stride_bytes != width * 3:
        return None

    payload_bytes = frame.payload_bytes
    if type(payload_bytes) is not int:
        return None
    if payload_bytes != row_stride_bytes * height:
        return None
    if payload_bytes > _FRAME_MAX_PAYLOAD_BYTES:
        return None

    bgr24_bytes = frame.bgr24_bytes
    if type(bgr24_bytes) is not bytes:
        return None
    if len(bgr24_bytes) != payload_bytes:
        return None

    checksum = frame.checksum
    if type(checksum) is not int:
        return None
    if not (0 <= checksum <= _UINT32_MAX):
        return None
    if _fnv1a32(bgr24_bytes) != checksum:
        return None

    rgb24_bytes = _bgr24_to_rgb24(bgr24_bytes)

    return ValidatedHelperRgb24Frame(
        request_id=request_id,
        frame_timestamp_ms=frame_timestamp_ms,
        width=width,
        height=height,
        row_stride_bytes=row_stride_bytes,
        payload_bytes=payload_bytes,
        rgb24_bytes=rgb24_bytes,
        source_checksum=checksum,
    )
