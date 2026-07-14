"""Serializes a HelperTrackingPayload into a bounded frame-mode result line.

This module is dependency-free and must not import MediaPipe or NumPy. It
consumes only an already-validated `HelperTrackingPayload` (from
`helper_tracking_payload.assemble_helper_tracking_payload`) plus bounded
frame-mode transport/diagnostic metadata, and returns exactly one compact,
newline-delimited "result" envelope line for the strict Native Core C++
parser (`parseHelperResultEnvelope` / `parseHelperFrameAck` in
`helper_message.cpp`), or `None` on any inconsistency.

This is a cross-runtime serialization boundary: the input `HelperTrackingPayload`
and `HelperFrameAck` are revalidated here rather than trusted, since a
manually constructed object could otherwise carry a spoofed status, a wrong
nested type, or an out-of-contract numeric value. It does not own reading a
control request, reading frame bytes, decoding frame packet headers,
computing a checksum, MediaPipe invocation, timing an actual inference,
stdout writing/flushing, or lifecycle output.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

from helper_tracking_payload import (
    HelperEyePayload,
    HelperFaceRotationPayload,
    HelperMouthPayload,
    HelperTrackingPayload,
    HelperTrackingPayloadStatus,
)

# Mirrors the schemaVersion the strict C++ parser requires exactly
# (requireExactSchemaVersionOne in helper_message.cpp).
_SCHEMA_VERSION = 1

# Mirrors the signed 64-bit range the strict C++ parser accepts for integer
# fields (getInteger()/std::strtoll in helper_message.cpp).
_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1

# Mirrors the frameAck.checksum uint32 bound enforced by parseHelperFrameAck()
# in helper_message.cpp.
_UINT32_MAX = (1 << 32) - 1

# Mirrors kFramePacketMaxPayloadBytes in helper_frame_packet.h.
_FRAME_PACKET_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

# Mirrors kHelperMaxLineBytes in helper_message.h: the maximum content bytes
# of a single newline-delimited helper line, before the newline delimiter.
_MAX_LINE_CONTENT_BYTES = 2048

_ROTATION_MIN = -1.0
_ROTATION_MAX = 1.0
_NORMALIZED_MIN = 0.0
_NORMALIZED_MAX = 1.0


@dataclass(frozen=True)
class HelperFrameAck:
    sequence: int
    payload_bytes: int
    checksum: int


def serialize_helper_result_line(
    payload: HelperTrackingPayload,
    *,
    request_id: int,
    frame_timestamp_ms: int,
    inference_ms: float,
    frame_ack: HelperFrameAck,
) -> str | None:
    """Serializes a frame-mode "result" envelope line, or returns None.

    Requires `type(payload) is HelperTrackingPayload` and
    `type(frame_ack) is HelperFrameAck` exactly (subclasses rejected).
    Requires exact built-in `int`/`float` types for every transport and
    diagnostic value (no coercion; bool and numeric-like objects rejected).
    Revalidates the nested payload contract (exact nested types, exact float
    fields, finite values, and the TRACKING/LOST value contracts) before
    serializing. On success returns one compact, deterministic JSON object
    followed by exactly one trailing "\\n"; on any inconsistency returns
    None without emitting partial JSON.
    """
    if type(payload) is not HelperTrackingPayload:
        return None
    if type(frame_ack) is not HelperFrameAck:
        return None

    if type(request_id) is not int:
        return None
    if not (0 <= request_id <= _INT64_MAX):
        return None

    if type(frame_timestamp_ms) is not int:
        return None
    if not (_INT64_MIN <= frame_timestamp_ms <= _INT64_MAX):
        return None

    if type(inference_ms) is not float:
        return None
    if not math.isfinite(inference_ms):
        return None
    if inference_ms < 0.0:
        return None

    if type(frame_ack.sequence) is not int:
        return None
    if not (0 <= frame_ack.sequence <= _INT64_MAX):
        return None
    if frame_ack.sequence != request_id:
        return None

    if type(frame_ack.payload_bytes) is not int:
        return None
    if not (0 <= frame_ack.payload_bytes <= _FRAME_PACKET_MAX_PAYLOAD_BYTES):
        return None

    if type(frame_ack.checksum) is not int:
        return None
    if not (0 <= frame_ack.checksum <= _UINT32_MAX):
        return None

    status_text = _validate_payload(payload)
    if status_text is None:
        return None

    document = {
        "type": "result",
        "schemaVersion": _SCHEMA_VERSION,
        "requestId": request_id,
        "frameTimestampMs": frame_timestamp_ms,
        "status": status_text,
        "confidence": payload.confidence,
        "faceRotation": {
            "pitch": payload.face_rotation.pitch,
            "yaw": payload.face_rotation.yaw,
            "roll": payload.face_rotation.roll,
        },
        "eyes": {
            "leftOpen": payload.eyes.left_open,
            "rightOpen": payload.eyes.right_open,
        },
        "mouth": {
            "open": payload.mouth.open,
            "smile": payload.mouth.smile,
        },
        "diag": {
            "inferenceMs": inference_ms,
        },
        "frameAck": {
            "sequence": frame_ack.sequence,
            "payloadBytes": frame_ack.payload_bytes,
            "checksum": frame_ack.checksum,
        },
    }

    try:
        content = json.dumps(
            document, ensure_ascii=True, allow_nan=False, separators=(",", ":")
        )
    except (TypeError, ValueError):
        return None

    if len(content.encode("ascii")) > _MAX_LINE_CONTENT_BYTES:
        return None

    return content + "\n"


def _validate_payload(payload: HelperTrackingPayload) -> str | None:
    """Revalidates the nested payload contract and returns its status text.

    Returns "tracking" or "lost" on a fully consistent payload, or None on
    any wrong nested type, non-float numeric field, non-finite value, or
    TRACKING/LOST value-contract violation.
    """
    status = payload.status
    face_rotation = payload.face_rotation
    eyes = payload.eyes
    mouth = payload.mouth

    if type(status) is not HelperTrackingPayloadStatus:
        return None
    if type(face_rotation) is not HelperFaceRotationPayload:
        return None
    if type(eyes) is not HelperEyePayload:
        return None
    if type(mouth) is not HelperMouthPayload:
        return None

    numeric_fields = (
        payload.confidence,
        face_rotation.pitch,
        face_rotation.yaw,
        face_rotation.roll,
        eyes.left_open,
        eyes.right_open,
        mouth.open,
        mouth.smile,
    )
    for value in numeric_fields:
        if type(value) is not float:
            return None
        if not math.isfinite(value):
            return None

    if status is HelperTrackingPayloadStatus.TRACKING:
        if payload.confidence != 1.0:
            return None
        if not (_ROTATION_MIN <= face_rotation.pitch <= _ROTATION_MAX):
            return None
        if not (_ROTATION_MIN <= face_rotation.yaw <= _ROTATION_MAX):
            return None
        if not (_ROTATION_MIN <= face_rotation.roll <= _ROTATION_MAX):
            return None
        if not (_NORMALIZED_MIN <= eyes.left_open <= _NORMALIZED_MAX):
            return None
        if not (_NORMALIZED_MIN <= eyes.right_open <= _NORMALIZED_MAX):
            return None
        if not (_NORMALIZED_MIN <= mouth.open <= _NORMALIZED_MAX):
            return None
        if not (_NORMALIZED_MIN <= mouth.smile <= _NORMALIZED_MAX):
            return None
        return "tracking"

    if status is HelperTrackingPayloadStatus.LOST:
        if payload.confidence != 0.0:
            return None
        if face_rotation.pitch != 0.0:
            return None
        if face_rotation.yaw != 0.0:
            return None
        if face_rotation.roll != 0.0:
            return None
        if eyes.left_open != 1.0:
            return None
        if eyes.right_open != 1.0:
            return None
        if mouth.open != 0.0:
            return None
        if mouth.smile != 0.0:
            return None
        return "lost"

    return None
