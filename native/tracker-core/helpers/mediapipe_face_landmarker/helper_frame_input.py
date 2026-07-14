"""Converts one bounded Native Core request/frame packet into an immutable input.

This module is dependency-free (standard library only) and must not import
MediaPipe, NumPy, OpenCV, or any other runtime/helper module. It performs no
I/O of any kind: it only transforms already-supplied in-memory values.

It exposes exactly three pure operations, mirroring the staged boundary the
future runtime loop will drive:

  1. `parse_helper_control_line` -- strictly parses one bounded line of
     control JSON content (already stripped of its trailing delimiter) into
     a request, a stop, or `None`.
  2. `decode_helper_frame_packet_header` -- strictly decodes and validates
     exactly one already-read 48-byte little-endian frame header, mirroring
     the current Native Core wire layout in `helper_frame_packet.h`.
  3. `assemble_validated_helper_frame_input` -- correlates a parsed request,
     a decoded header, and an already-read bounded payload into one
     immutable, checksummed frame input.

This module does not read stdin, a pipe, or a file, does not access a
camera, does not touch the network, and does not print. It retains no frame
history: only the caller-owned return value of
`assemble_validated_helper_frame_input` keeps the current frame bytes alive.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

# --- Private wire constants (mirror Native Core; not part of the public API) ---

# Mirrors kHelperMaxLineBytes in helper_message.h: the maximum content bytes
# of a single newline-delimited control line, before the newline delimiter.
_MAX_LINE_CONTENT_BYTES = 2048

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT64_MAX = (1 << 64) - 1
_UINT32_MAX = (1 << 32) - 1

# Mirrors the fixed 48-byte little-endian frame packet header in
# helper_frame_packet.h.
_FRAME_MAGIC = b"LVKF"
_FRAME_VERSION = 1
_FRAME_HEADER_BYTES = 48
_FRAME_FORMAT_BGR24 = 1
_FRAME_MIN_WIDTH = 1
_FRAME_MAX_WIDTH = 7680
_FRAME_MIN_HEIGHT = 1
_FRAME_MAX_HEIGHT = 4320
_FRAME_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

_REQUEST_KEYS = frozenset({"type", "schemaVersion", "requestId", "frameTimestampMs"})
_STOP_KEYS = frozenset({"type", "schemaVersion"})

# Mirrors the FNV-1a32 offset basis / prime used by fnv1a32() in
# helper_frame_packet.cpp.
_FNV_OFFSET_BASIS = 2166136261
_FNV_PRIME = 16777619


@dataclass(frozen=True)
class HelperFrameRequest:
    request_id: int
    frame_timestamp_ms: int


@dataclass(frozen=True)
class HelperStopRequest:
    pass


@dataclass(frozen=True)
class HelperFramePacketHeader:
    sequence: int
    frame_timestamp_ms: int
    width: int
    height: int
    row_stride_bytes: int
    payload_bytes: int


@dataclass(frozen=True)
class ValidatedHelperFrameInput:
    request_id: int
    frame_timestamp_ms: int
    width: int
    height: int
    row_stride_bytes: int
    payload_bytes: int
    bgr24_bytes: bytes
    checksum: int


class _DuplicateControlKeyError(ValueError):
    pass


def _strict_object_pairs_hook(pairs: list) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateControlKeyError(f"duplicate key: {key!r}")
        result[key] = value
    return result


def _reject_json_constant(token: str) -> None:
    raise ValueError(f"non-standard JSON constant: {token}")


def parse_helper_control_line(
    line: str,
) -> HelperFrameRequest | HelperStopRequest | None:
    """Strictly parses one bounded control-line content, or returns None.

    `line` must be the exact content of one control line with its trailing
    delimiter already removed. Performs no I/O. Ordinary malformed input
    returns None; unexpected programming failures (e.g. BaseException from
    the JSON parser) remain visible.
    """
    if type(line) is not str:
        return None
    if "\r" in line or "\n" in line:
        return None

    try:
        encoded = line.encode("utf-8")
    except UnicodeEncodeError:
        return None
    if len(encoded) > _MAX_LINE_CONTENT_BYTES:
        return None

    try:
        value = json.loads(
            line,
            object_pairs_hook=_strict_object_pairs_hook,
            parse_constant=_reject_json_constant,
        )
    except (ValueError, RecursionError):
        return None

    if type(value) is not dict:
        return None

    keys = frozenset(value.keys())
    if keys == _REQUEST_KEYS:
        return _parse_request_fields(value)
    if keys == _STOP_KEYS:
        return _parse_stop_fields(value)
    return None


def _parse_request_fields(value: dict) -> HelperFrameRequest | None:
    if type(value["type"]) is not str or value["type"] != "request":
        return None
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        return None

    request_id = value["requestId"]
    if type(request_id) is not int:
        return None
    if not (1 <= request_id <= _INT64_MAX):
        return None

    frame_timestamp_ms = value["frameTimestampMs"]
    if type(frame_timestamp_ms) is not int:
        return None
    if not (_INT64_MIN <= frame_timestamp_ms <= _INT64_MAX):
        return None

    return HelperFrameRequest(
        request_id=request_id, frame_timestamp_ms=frame_timestamp_ms
    )


def _parse_stop_fields(value: dict) -> HelperStopRequest | None:
    if type(value["type"]) is not str or value["type"] != "stop":
        return None
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        return None
    return HelperStopRequest()


def decode_helper_frame_packet_header(
    header_bytes: bytes,
) -> HelperFramePacketHeader | None:
    """Decodes and fully validates exactly one 48-byte frame header.

    `header_bytes` must be exactly `type(header_bytes) is bytes` and exactly
    48 bytes long. Never allocates or reads payload data; never computes a
    checksum. Returns None on any structural or bounds failure.
    """
    if type(header_bytes) is not bytes:
        return None
    if len(header_bytes) != _FRAME_HEADER_BYTES:
        return None

    if header_bytes[0:4] != _FRAME_MAGIC:
        return None

    version = int.from_bytes(header_bytes[4:6], "little", signed=False)
    if version != _FRAME_VERSION:
        return None

    header_size = int.from_bytes(header_bytes[6:8], "little", signed=False)
    if header_size != _FRAME_HEADER_BYTES:
        return None

    sequence = int.from_bytes(header_bytes[8:16], "little", signed=False)
    frame_timestamp_ms = int.from_bytes(header_bytes[16:24], "little", signed=True)
    width = int.from_bytes(header_bytes[24:28], "little", signed=False)
    height = int.from_bytes(header_bytes[28:32], "little", signed=False)
    row_stride_bytes = int.from_bytes(header_bytes[32:36], "little", signed=False)
    pixel_format = int.from_bytes(header_bytes[36:40], "little", signed=False)
    payload_bytes = int.from_bytes(header_bytes[40:48], "little", signed=False)

    if pixel_format != _FRAME_FORMAT_BGR24:
        return None
    if not (_FRAME_MIN_WIDTH <= width <= _FRAME_MAX_WIDTH):
        return None
    if not (_FRAME_MIN_HEIGHT <= height <= _FRAME_MAX_HEIGHT):
        return None

    expected_stride = width * 3
    if row_stride_bytes != expected_stride:
        return None

    expected_payload = expected_stride * height
    if payload_bytes != expected_payload:
        return None
    if payload_bytes > _FRAME_MAX_PAYLOAD_BYTES:
        return None

    return HelperFramePacketHeader(
        sequence=sequence,
        frame_timestamp_ms=frame_timestamp_ms,
        width=width,
        height=height,
        row_stride_bytes=row_stride_bytes,
        payload_bytes=payload_bytes,
    )


def _fnv1a32(data: bytes) -> int:
    hash_value = _FNV_OFFSET_BASIS
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * _FNV_PRIME) & 0xFFFFFFFF
    return hash_value


def assemble_validated_helper_frame_input(
    request: HelperFrameRequest,
    header: HelperFramePacketHeader,
    payload: bytes,
) -> ValidatedHelperFrameInput | None:
    """Correlates a request, header, and payload into one immutable input.

    Because the public frozen dataclasses can be manually constructed with
    inconsistent values, every request/header field is revalidated here
    rather than trusted. All type, range, correlation, and exact-length
    checks run before the checksum is computed, so an invalid, mismatched,
    truncated, or overlong payload is never scanned.
    """
    if type(request) is not HelperFrameRequest:
        return None
    if type(header) is not HelperFramePacketHeader:
        return None
    if type(payload) is not bytes:
        return None

    request_id = request.request_id
    if type(request_id) is not int:
        return None
    if not (1 <= request_id <= _INT64_MAX):
        return None

    frame_timestamp_ms = request.frame_timestamp_ms
    if type(frame_timestamp_ms) is not int:
        return None
    if not (_INT64_MIN <= frame_timestamp_ms <= _INT64_MAX):
        return None

    sequence = header.sequence
    if type(sequence) is not int:
        return None
    if not (0 <= sequence <= _UINT64_MAX):
        return None

    header_timestamp_ms = header.frame_timestamp_ms
    if type(header_timestamp_ms) is not int:
        return None
    if not (_INT64_MIN <= header_timestamp_ms <= _INT64_MAX):
        return None

    width = header.width
    if type(width) is not int:
        return None
    if not (_FRAME_MIN_WIDTH <= width <= _FRAME_MAX_WIDTH):
        return None

    height = header.height
    if type(height) is not int:
        return None
    if not (_FRAME_MIN_HEIGHT <= height <= _FRAME_MAX_HEIGHT):
        return None

    row_stride_bytes = header.row_stride_bytes
    if type(row_stride_bytes) is not int:
        return None
    if row_stride_bytes != width * 3:
        return None

    payload_bytes = header.payload_bytes
    if type(payload_bytes) is not int:
        return None
    if payload_bytes != row_stride_bytes * height:
        return None
    if payload_bytes > _FRAME_MAX_PAYLOAD_BYTES:
        return None

    if sequence != request_id:
        return None
    if header_timestamp_ms != frame_timestamp_ms:
        return None

    if len(payload) != payload_bytes:
        return None

    checksum = _fnv1a32(payload)

    return ValidatedHelperFrameInput(
        request_id=request_id,
        frame_timestamp_ms=frame_timestamp_ms,
        width=width,
        height=height,
        row_stride_bytes=row_stride_bytes,
        payload_bytes=payload_bytes,
        bgr24_bytes=payload,
        checksum=checksum,
    )
