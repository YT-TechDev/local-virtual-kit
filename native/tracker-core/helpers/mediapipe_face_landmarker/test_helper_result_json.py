"""Standard-library tests for helper_result_json.py.

Run directly: python -B test_helper_result_json.py

Also supports one test-only CLI fixture mode used by
tools/check-helper-message-parse.mjs for actual cross-runtime parity against
the C++ strict parser:

    python -B test_helper_result_json.py --emit-cpp-parity-line
"""

from __future__ import annotations

import contextlib
import dataclasses
import io
import json
import sys
import unittest
from dataclasses import FrozenInstanceError
from unittest import mock

from helper_result_json import HelperFrameAck, serialize_helper_result_line
from helper_tracking_payload import (
    HelperEyePayload,
    HelperFaceRotationPayload,
    HelperMouthPayload,
    HelperTrackingPayload,
    HelperTrackingPayloadStatus,
)


class _NumericLike:
    """Numeric-like object exposing __float__/__int__ but not a built-in."""

    def __init__(self, value: float) -> None:
        self._value = value

    def __float__(self) -> float:
        return float(self._value)

    def __int__(self) -> int:
        return int(self._value)

    def __index__(self) -> int:
        return int(self._value)


class _AlwaysEqualStatus:
    """Object whose __eq__ always returns True, spoofing enum comparisons."""

    def __eq__(self, other: object) -> bool:
        return True

    def __hash__(self) -> int:
        return 0


class _IntSubclass(int):
    pass


class _FloatSubclass(float):
    pass


class _HelperTrackingPayloadSubclass(HelperTrackingPayload):
    pass


class _HelperFrameAckSubclass(HelperFrameAck):
    pass


class _HelperFaceRotationPayloadSubclass(HelperFaceRotationPayload):
    pass


class _HelperEyePayloadSubclass(HelperEyePayload):
    pass


class _HelperMouthPayloadSubclass(HelperMouthPayload):
    pass


_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1
_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

# The single synthetic contract fixture shared with the C++ parity mode
# (helper_message_parse_smoke.cpp --parse-result-frame-line) and the Node
# cross-runtime checker (tools/check-helper-message-parse.mjs). Values are
# synthetic metadata only; no image/frame/model/private-path data.
_PARITY_REQUEST_ID = 7
_PARITY_FRAME_TIMESTAMP_MS = 123
_PARITY_INFERENCE_MS = 1.5
_PARITY_TRACKING_PAYLOAD = HelperTrackingPayload(
    status=HelperTrackingPayloadStatus.TRACKING,
    confidence=1.0,
    face_rotation=HelperFaceRotationPayload(pitch=0.25, yaw=-0.5, roll=0.75),
    eyes=HelperEyePayload(left_open=0.8, right_open=0.6),
    mouth=HelperMouthPayload(open=0.4, smile=0.2),
)
_PARITY_FRAME_ACK = HelperFrameAck(sequence=7, payload_bytes=3, checksum=123456789)
_PARITY_EXPECTED_JSON = (
    '{"type":"result","schemaVersion":1,"requestId":7,"frameTimestampMs":123,'
    '"status":"tracking","confidence":1.0,'
    '"faceRotation":{"pitch":0.25,"yaw":-0.5,"roll":0.75},'
    '"eyes":{"leftOpen":0.8,"rightOpen":0.6},'
    '"mouth":{"open":0.4,"smile":0.2},'
    '"diag":{"inferenceMs":1.5},'
    '"frameAck":{"sequence":7,"payloadBytes":3,"checksum":123456789}}'
)

_TRACKING_PAYLOAD = _PARITY_TRACKING_PAYLOAD
_LOST_PAYLOAD = HelperTrackingPayload(
    status=HelperTrackingPayloadStatus.LOST,
    confidence=0.0,
    face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
    eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
    mouth=HelperMouthPayload(open=0.0, smile=0.0),
)


def _serialize_tracking(**overrides: object) -> str | None:
    kwargs: dict[str, object] = dict(
        payload=_TRACKING_PAYLOAD,
        request_id=_PARITY_REQUEST_ID,
        frame_timestamp_ms=_PARITY_FRAME_TIMESTAMP_MS,
        inference_ms=_PARITY_INFERENCE_MS,
        frame_ack=_PARITY_FRAME_ACK,
    )
    kwargs.update(overrides)
    return serialize_helper_result_line(**kwargs)


class ValidTrackingOutputTests(unittest.TestCase):
    def _line(self) -> str:
        line = _serialize_tracking()
        assert line is not None
        return line

    def test_valid_tracking_payload_serializes(self) -> None:
        self.assertIsNotNone(_serialize_tracking())

    def test_returned_value_is_exact_str_type(self) -> None:
        self.assertIs(type(self._line()), str)

    def test_ends_with_exactly_one_newline(self) -> None:
        line = self._line()
        self.assertTrue(line.endswith("\n"))
        self.assertEqual(line.count("\n"), 1)

    def test_no_carriage_return(self) -> None:
        self.assertNotIn("\r", self._line())

    def test_content_has_no_embedded_newline(self) -> None:
        self.assertNotIn("\n", self._line()[:-1])

    def test_output_is_compact_with_no_serializer_added_spaces(self) -> None:
        self.assertNotIn(" ", self._line()[:-1])

    def test_json_loads_accepts_content(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertIsInstance(parsed, dict)

    def test_top_level_key_set_is_exact(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(
            set(parsed.keys()),
            {
                "type",
                "schemaVersion",
                "requestId",
                "frameTimestampMs",
                "status",
                "confidence",
                "faceRotation",
                "eyes",
                "mouth",
                "diag",
                "frameAck",
            },
        )

    def test_nested_key_sets_are_exact(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(
            set(parsed["faceRotation"].keys()), {"pitch", "yaw", "roll"}
        )
        self.assertEqual(set(parsed["eyes"].keys()), {"leftOpen", "rightOpen"})
        self.assertEqual(set(parsed["mouth"].keys()), {"open", "smile"})
        self.assertEqual(set(parsed["diag"].keys()), {"inferenceMs"})
        self.assertEqual(
            set(parsed["frameAck"].keys()),
            {"sequence", "payloadBytes", "checksum"},
        )

    def test_type_is_exactly_result(self) -> None:
        self.assertEqual(json.loads(self._line()[:-1])["type"], "result")

    def test_schema_version_is_exactly_one(self) -> None:
        self.assertEqual(json.loads(self._line()[:-1])["schemaVersion"], 1)

    def test_status_is_exactly_tracking(self) -> None:
        self.assertEqual(json.loads(self._line()[:-1])["status"], "tracking")

    def test_request_id_and_frame_timestamp_preserved(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(parsed["requestId"], _PARITY_REQUEST_ID)
        self.assertEqual(parsed["frameTimestampMs"], _PARITY_FRAME_TIMESTAMP_MS)

    def test_tracking_values_preserved(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(parsed["confidence"], 1.0)
        self.assertEqual(
            parsed["faceRotation"], {"pitch": 0.25, "yaw": -0.5, "roll": 0.75}
        )
        self.assertEqual(parsed["eyes"], {"leftOpen": 0.8, "rightOpen": 0.6})
        self.assertEqual(parsed["mouth"], {"open": 0.4, "smile": 0.2})

    def test_inference_ms_preserved(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(parsed["diag"]["inferenceMs"], 1.5)

    def test_frame_ack_fields_preserved(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(
            parsed["frameAck"],
            {"sequence": 7, "payloadBytes": 3, "checksum": 123456789},
        )

    def test_no_timestamp_ms_field(self) -> None:
        self.assertNotIn("timestampMs", json.loads(self._line()[:-1]))

    def test_no_source_field(self) -> None:
        self.assertNotIn("source", json.loads(self._line()[:-1]))

    def test_no_raw_backend_specific_field(self) -> None:
        parsed = json.loads(self._line()[:-1])
        for forbidden in (
            "landmarks",
            "blendshapes",
            "matrices",
            "request",
            "payload",
            "tracking",
            "not_started",
        ):
            self.assertNotIn(forbidden, parsed)

    def test_known_fixture_produces_exact_deterministic_json(self) -> None:
        self.assertEqual(self._line(), _PARITY_EXPECTED_JSON + "\n")


class ValidLostOutputTests(unittest.TestCase):
    def _line(self) -> str:
        line = _serialize_tracking(payload=_LOST_PAYLOAD)
        assert line is not None
        return line

    def test_valid_lost_payload_serializes(self) -> None:
        self.assertIsNotNone(_serialize_tracking(payload=_LOST_PAYLOAD))

    def test_status_is_exactly_lost(self) -> None:
        self.assertEqual(json.loads(self._line()[:-1])["status"], "lost")

    def test_canonical_neutral_lost_values_preserved(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertEqual(
            parsed["faceRotation"], {"pitch": 0.0, "yaw": 0.0, "roll": 0.0}
        )
        self.assertEqual(parsed["eyes"], {"leftOpen": 1.0, "rightOpen": 1.0})
        self.assertEqual(parsed["mouth"], {"open": 0.0, "smile": 0.0})

    def test_confidence_is_exactly_zero(self) -> None:
        self.assertEqual(json.loads(self._line()[:-1])["confidence"], 0.0)

    def test_lost_output_includes_diag_and_frame_ack(self) -> None:
        parsed = json.loads(self._line()[:-1])
        self.assertIn("diag", parsed)
        self.assertIn("frameAck", parsed)


class PayloadContractTests(unittest.TestCase):
    def test_none_payload_rejected(self) -> None:
        self.assertIsNone(_serialize_tracking(payload=None))

    def test_wrong_payload_object_rejected(self) -> None:
        self.assertIsNone(_serialize_tracking(payload="not-a-payload"))

    def test_payload_subclass_rejected(self) -> None:
        subclass_payload = _HelperTrackingPayloadSubclass(
            status=HelperTrackingPayloadStatus.TRACKING,
            confidence=1.0,
            face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
            eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
            mouth=HelperMouthPayload(open=0.0, smile=0.0),
        )
        self.assertIsNone(_serialize_tracking(payload=subclass_payload))

    def test_wrong_status_type_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, status="tracking")
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_equality_spoof_status_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, status=_AlwaysEqualStatus())
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_wrong_face_rotation_type_rejected(self) -> None:
        payload = dataclasses.replace(
            _TRACKING_PAYLOAD, face_rotation=(0.25, -0.5, 0.75)
        )
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_wrong_eyes_type_rejected(self) -> None:
        payload = dataclasses.replace(
            _TRACKING_PAYLOAD, eyes={"left_open": 0.8, "right_open": 0.6}
        )
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_wrong_mouth_type_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, mouth=None)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_nested_dataclass_subclasses_rejected(self) -> None:
        variants = {
            "face_rotation": dataclasses.replace(
                _TRACKING_PAYLOAD,
                face_rotation=_HelperFaceRotationPayloadSubclass(
                    pitch=0.25, yaw=-0.5, roll=0.75
                ),
            ),
            "eyes": dataclasses.replace(
                _TRACKING_PAYLOAD,
                eyes=_HelperEyePayloadSubclass(left_open=0.8, right_open=0.6),
            ),
            "mouth": dataclasses.replace(
                _TRACKING_PAYLOAD,
                mouth=_HelperMouthPayloadSubclass(open=0.4, smile=0.2),
            ),
        }
        for name, payload in variants.items():
            with self.subTest(field=name):
                self.assertIsNone(_serialize_tracking(payload=payload))

    def test_payload_numeric_int_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, confidence=1)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_payload_numeric_bool_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, confidence=True)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_custom_numeric_like_value_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, confidence=_NumericLike(1.0))
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_nan_payload_field_rejected(self) -> None:
        rotation = dataclasses.replace(
            _TRACKING_PAYLOAD.face_rotation, pitch=float("nan")
        )
        payload = dataclasses.replace(_TRACKING_PAYLOAD, face_rotation=rotation)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_infinity_payload_field_rejected(self) -> None:
        rotation = dataclasses.replace(
            _TRACKING_PAYLOAD.face_rotation, pitch=float("inf")
        )
        payload = dataclasses.replace(_TRACKING_PAYLOAD, face_rotation=rotation)
        self.assertIsNone(_serialize_tracking(payload=payload))


class TrackingConsistencyTests(unittest.TestCase):
    def test_confidence_other_than_one_rejected(self) -> None:
        payload = dataclasses.replace(_TRACKING_PAYLOAD, confidence=0.99)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_rotation_below_minimum_rejected(self) -> None:
        rotation = dataclasses.replace(
            _TRACKING_PAYLOAD.face_rotation, pitch=-1.0001
        )
        payload = dataclasses.replace(_TRACKING_PAYLOAD, face_rotation=rotation)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_rotation_above_maximum_rejected(self) -> None:
        rotation = dataclasses.replace(_TRACKING_PAYLOAD.face_rotation, yaw=1.0001)
        payload = dataclasses.replace(_TRACKING_PAYLOAD, face_rotation=rotation)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_eye_value_below_zero_rejected(self) -> None:
        eyes = dataclasses.replace(_TRACKING_PAYLOAD.eyes, left_open=-0.0001)
        payload = dataclasses.replace(_TRACKING_PAYLOAD, eyes=eyes)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_eye_value_above_one_rejected(self) -> None:
        eyes = dataclasses.replace(_TRACKING_PAYLOAD.eyes, right_open=1.0001)
        payload = dataclasses.replace(_TRACKING_PAYLOAD, eyes=eyes)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_mouth_value_below_zero_rejected(self) -> None:
        mouth = dataclasses.replace(_TRACKING_PAYLOAD.mouth, open=-0.0001)
        payload = dataclasses.replace(_TRACKING_PAYLOAD, mouth=mouth)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_mouth_value_above_one_rejected(self) -> None:
        mouth = dataclasses.replace(_TRACKING_PAYLOAD.mouth, smile=1.0001)
        payload = dataclasses.replace(_TRACKING_PAYLOAD, mouth=mouth)
        self.assertIsNone(_serialize_tracking(payload=payload))


class LostConsistencyTests(unittest.TestCase):
    def test_confidence_other_than_zero_rejected(self) -> None:
        payload = dataclasses.replace(_LOST_PAYLOAD, confidence=0.5)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_non_neutral_rotation_rejected(self) -> None:
        rotation = dataclasses.replace(_LOST_PAYLOAD.face_rotation, pitch=0.1)
        payload = dataclasses.replace(_LOST_PAYLOAD, face_rotation=rotation)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_non_open_eyes_rejected(self) -> None:
        eyes = dataclasses.replace(_LOST_PAYLOAD.eyes, left_open=0.9)
        payload = dataclasses.replace(_LOST_PAYLOAD, eyes=eyes)
        self.assertIsNone(_serialize_tracking(payload=payload))

    def test_non_closed_mouth_rejected(self) -> None:
        mouth = dataclasses.replace(_LOST_PAYLOAD.mouth, open=0.1)
        payload = dataclasses.replace(_LOST_PAYLOAD, mouth=mouth)
        self.assertIsNone(_serialize_tracking(payload=payload))


class RequestIdTests(unittest.TestCase):
    def _serialize(self, request_id: object) -> str | None:
        sequence = request_id if type(request_id) is int else 0
        return _serialize_tracking(
            request_id=request_id,
            frame_ack=HelperFrameAck(sequence=sequence, payload_bytes=3, checksum=1),
        )

    def test_zero_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(0))

    def test_int64_max_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(_INT64_MAX))

    def test_negative_rejected(self) -> None:
        self.assertIsNone(self._serialize(-1))

    def test_int64_max_plus_one_rejected(self) -> None:
        self.assertIsNone(self._serialize(_INT64_MAX + 1))

    def test_bool_rejected(self) -> None:
        self.assertIsNone(self._serialize(True))

    def test_int_subclass_rejected(self) -> None:
        self.assertIsNone(self._serialize(_IntSubclass(7)))

    def test_numeric_like_object_rejected(self) -> None:
        self.assertIsNone(self._serialize(_NumericLike(7)))


class FrameTimestampTests(unittest.TestCase):
    def _serialize(self, frame_timestamp_ms: object) -> str | None:
        return _serialize_tracking(frame_timestamp_ms=frame_timestamp_ms)

    def test_zero_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(0))

    def test_int64_min_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(_INT64_MIN))

    def test_int64_max_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(_INT64_MAX))

    def test_below_minimum_rejected(self) -> None:
        self.assertIsNone(self._serialize(_INT64_MIN - 1))

    def test_above_maximum_rejected(self) -> None:
        self.assertIsNone(self._serialize(_INT64_MAX + 1))

    def test_bool_rejected(self) -> None:
        self.assertIsNone(self._serialize(True))

    def test_int_subclass_rejected(self) -> None:
        self.assertIsNone(self._serialize(_IntSubclass(123)))


class InferenceMsTests(unittest.TestCase):
    def _serialize(self, inference_ms: object) -> str | None:
        return _serialize_tracking(inference_ms=inference_ms)

    def test_zero_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(0.0))

    def test_finite_positive_accepted(self) -> None:
        self.assertIsNotNone(self._serialize(12.5))

    def test_negative_rejected(self) -> None:
        self.assertIsNone(self._serialize(-0.001))

    def test_nan_rejected(self) -> None:
        self.assertIsNone(self._serialize(float("nan")))

    def test_positive_infinity_rejected(self) -> None:
        self.assertIsNone(self._serialize(float("inf")))

    def test_negative_infinity_rejected(self) -> None:
        self.assertIsNone(self._serialize(float("-inf")))

    def test_int_rejected(self) -> None:
        self.assertIsNone(self._serialize(1))

    def test_bool_rejected(self) -> None:
        self.assertIsNone(self._serialize(True))

    def test_float_subclass_rejected(self) -> None:
        self.assertIsNone(self._serialize(_FloatSubclass(1.5)))

    def test_custom_numeric_like_rejected(self) -> None:
        self.assertIsNone(self._serialize(_NumericLike(1.5)))


class FrameAckTests(unittest.TestCase):
    def _serialize(self, frame_ack: object) -> str | None:
        return _serialize_tracking(frame_ack=frame_ack)

    def test_valid_exact_frame_ack_accepted(self) -> None:
        self.assertIsNotNone(
            self._serialize(HelperFrameAck(sequence=7, payload_bytes=3, checksum=123456789))
        )

    def test_none_rejected(self) -> None:
        self.assertIsNone(self._serialize(None))

    def test_wrong_type_rejected(self) -> None:
        self.assertIsNone(self._serialize((7, 3, 123456789)))

    def test_subclass_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(
                _HelperFrameAckSubclass(sequence=7, payload_bytes=3, checksum=1)
            )
        )

    def test_sequence_must_equal_request_id(self) -> None:
        self.assertIsNone(
            self._serialize(HelperFrameAck(sequence=8, payload_bytes=3, checksum=1))
        )

    def test_negative_sequence_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(HelperFrameAck(sequence=-1, payload_bytes=3, checksum=1))
        )

    def test_sequence_above_int64_max_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(
                HelperFrameAck(sequence=_INT64_MAX + 1, payload_bytes=3, checksum=1)
            )
        )

    def test_payload_bytes_zero_accepted(self) -> None:
        self.assertIsNotNone(
            self._serialize(HelperFrameAck(sequence=7, payload_bytes=0, checksum=1))
        )

    def test_payload_bytes_exactly_32mib_accepted(self) -> None:
        self.assertIsNotNone(
            self._serialize(
                HelperFrameAck(
                    sequence=7, payload_bytes=_MAX_PAYLOAD_BYTES, checksum=1
                )
            )
        )

    def test_payload_bytes_above_32mib_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(
                HelperFrameAck(
                    sequence=7, payload_bytes=_MAX_PAYLOAD_BYTES + 1, checksum=1
                )
            )
        )

    def test_negative_payload_bytes_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(HelperFrameAck(sequence=7, payload_bytes=-1, checksum=1))
        )

    def test_checksum_zero_accepted(self) -> None:
        self.assertIsNotNone(
            self._serialize(HelperFrameAck(sequence=7, payload_bytes=3, checksum=0))
        )

    def test_checksum_uint32_max_accepted(self) -> None:
        self.assertIsNotNone(
            self._serialize(
                HelperFrameAck(sequence=7, payload_bytes=3, checksum=_UINT32_MAX)
            )
        )

    def test_checksum_above_uint32_max_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(
                HelperFrameAck(sequence=7, payload_bytes=3, checksum=_UINT32_MAX + 1)
            )
        )

    def test_negative_checksum_rejected(self) -> None:
        self.assertIsNone(
            self._serialize(HelperFrameAck(sequence=7, payload_bytes=3, checksum=-1))
        )

    def test_bool_and_int_subclass_rejected_for_all_ack_fields(self) -> None:
        variants = [
            HelperFrameAck(sequence=True, payload_bytes=3, checksum=1),
            HelperFrameAck(sequence=7, payload_bytes=True, checksum=1),
            HelperFrameAck(sequence=7, payload_bytes=3, checksum=True),
            HelperFrameAck(sequence=_IntSubclass(7), payload_bytes=3, checksum=1),
            HelperFrameAck(sequence=7, payload_bytes=_IntSubclass(3), checksum=1),
            HelperFrameAck(sequence=7, payload_bytes=3, checksum=_IntSubclass(1)),
        ]
        for variant in variants:
            with self.subTest(frame_ack=variant):
                self.assertIsNone(self._serialize(variant))


class FramingAndSafetyTests(unittest.TestCase):
    def test_largest_accepted_boundaries_stay_within_2048_bytes(self) -> None:
        line = _serialize_tracking(
            request_id=_INT64_MAX,
            frame_timestamp_ms=_INT64_MAX,
            inference_ms=123456789.123456,
            frame_ack=HelperFrameAck(
                sequence=_INT64_MAX,
                payload_bytes=_MAX_PAYLOAD_BYTES,
                checksum=_UINT32_MAX,
            ),
        )
        self.assertIsNotNone(line)
        assert line is not None
        self.assertLessEqual(len(line[:-1].encode("ascii")), 2048)

    def test_content_is_ascii_encodable(self) -> None:
        line = _serialize_tracking()
        assert line is not None
        line[:-1].encode("ascii")

    def test_output_contains_no_nan_or_infinity_tokens(self) -> None:
        line = _serialize_tracking()
        assert line is not None
        self.assertNotIn("NaN", line)
        self.assertNotIn("Infinity", line)

    def test_no_stdout_or_stderr_for_valid_input(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            _serialize_tracking()
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_no_stdout_or_stderr_for_invalid_input(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            _serialize_tracking(payload=None, request_id=-1, frame_ack=None)
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_helper_frame_ack_is_frozen(self) -> None:
        frame_ack = HelperFrameAck(sequence=1, payload_bytes=1, checksum=1)
        with self.assertRaises(FrozenInstanceError):
            frame_ack.sequence = 2  # type: ignore[misc]

    def test_serializer_does_not_mutate_or_retain_input(self) -> None:
        payload = _TRACKING_PAYLOAD
        frame_ack = HelperFrameAck(sequence=7, payload_bytes=3, checksum=123456789)
        before = (dataclasses.astuple(payload), dataclasses.astuple(frame_ack))
        _serialize_tracking(payload=payload, frame_ack=frame_ack)
        after = (dataclasses.astuple(payload), dataclasses.astuple(frame_ack))
        self.assertEqual(before, after)

    def test_base_exception_is_not_swallowed(self) -> None:
        with mock.patch("json.dumps", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                _serialize_tracking()


def _emit_cpp_parity_line() -> int:
    line = serialize_helper_result_line(
        _PARITY_TRACKING_PAYLOAD,
        request_id=_PARITY_REQUEST_ID,
        frame_timestamp_ms=_PARITY_FRAME_TIMESTAMP_MS,
        inference_ms=_PARITY_INFERENCE_MS,
        frame_ack=_PARITY_FRAME_ACK,
    )
    if line is None:
        return 1
    # Writes raw bytes to the stdout buffer (not sys.stdout.write) so a
    # platform text-mode stdout (e.g. Windows translating "\n" to "\r\n")
    # cannot corrupt the required single-trailing-"\n" line framing.
    sys.stdout.buffer.write(line.encode("ascii"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--emit-cpp-parity-line":
        sys.exit(_emit_cpp_parity_line())
    unittest.main()
