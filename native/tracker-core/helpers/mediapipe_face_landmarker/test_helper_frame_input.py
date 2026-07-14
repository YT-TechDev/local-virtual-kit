"""Standard-library tests for helper_frame_input.py.

Run directly: python -B test_helper_frame_input.py

Also supports one test-only CLI fixture-consumer mode used by
tools/check-helper-frame-packet.mjs for actual cross-runtime parity against
the C++ encoder/checksum:

    python -B test_helper_frame_input.py --consume-cpp-frame-input-fixture \
        <request-json-content> <packet-hex> <checksum-decimal>
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

import helper_frame_input
from helper_frame_input import (
    HelperFramePacketHeader,
    HelperFrameRequest,
    HelperStopRequest,
    ValidatedHelperFrameInput,
    assemble_validated_helper_frame_input,
    decode_helper_frame_packet_header,
    parse_helper_control_line,
)

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT64_MAX = (1 << 64) - 1
_UINT32_MAX = (1 << 32) - 1
_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024
_MAX_LINE_CONTENT_BYTES = 2048

_MAGIC = b"LVKF"


class _IntSubclass(int):
    pass


class _StrSubclass(str):
    pass


class _BytesSubclass(bytes):
    pass


class _HelperFrameRequestSubclass(HelperFrameRequest):
    pass


class _HelperFramePacketHeaderSubclass(HelperFramePacketHeader):
    pass


# --- Control-line fixture helpers -------------------------------------------


def _request_obj(**overrides) -> dict:
    obj = {
        "type": "request",
        "schemaVersion": 1,
        "requestId": 7,
        "frameTimestampMs": 1000,
    }
    obj.update(overrides)
    return obj


def _stop_obj(**overrides) -> dict:
    obj = {"type": "stop", "schemaVersion": 1}
    obj.update(overrides)
    return obj


def _line(obj: dict, remove_keys: tuple = ()) -> str:
    d = dict(obj)
    for key in remove_keys:
        d.pop(key, None)
    return json.dumps(d, separators=(",", ":"))


def _valid_request_line(request_id: int = 7, frame_timestamp_ms: int = 1000) -> str:
    return _line(_request_obj(requestId=request_id, frameTimestampMs=frame_timestamp_ms))


def _valid_stop_line() -> str:
    return _line(_stop_obj())


# --- Frame header fixture helpers -------------------------------------------


def _encode_header(
    *,
    magic: bytes = _MAGIC,
    version: int = 1,
    header_size: int = 48,
    sequence: int = 7,
    frame_timestamp_ms: int = 1000,
    width: int = 2,
    height: int = 2,
    row_stride_bytes: int | None = None,
    pixel_format: int = 1,
    payload_bytes: int | None = None,
) -> bytes:
    if row_stride_bytes is None:
        row_stride_bytes = width * 3
    if payload_bytes is None:
        payload_bytes = row_stride_bytes * height
    return (
        magic
        + version.to_bytes(2, "little", signed=False)
        + header_size.to_bytes(2, "little", signed=False)
        + sequence.to_bytes(8, "little", signed=False)
        + frame_timestamp_ms.to_bytes(8, "little", signed=True)
        + width.to_bytes(4, "little", signed=False)
        + height.to_bytes(4, "little", signed=False)
        + row_stride_bytes.to_bytes(4, "little", signed=False)
        + pixel_format.to_bytes(4, "little", signed=False)
        + payload_bytes.to_bytes(8, "little", signed=False)
    )


def _valid_header_bytes(**overrides) -> bytes:
    return _encode_header(**overrides)


def _valid_header(**overrides) -> HelperFramePacketHeader:
    header = decode_helper_frame_packet_header(_valid_header_bytes(**overrides))
    assert header is not None
    return header


# --- Final-assembly fixture helpers -----------------------------------------

_ASSEMBLY_REQUEST_ID = 7
_ASSEMBLY_TIMESTAMP_MS = 1000
_ASSEMBLY_WIDTH = 2
_ASSEMBLY_HEIGHT = 2
_ASSEMBLY_STRIDE = 6
_ASSEMBLY_PAYLOAD_BYTES = 12
_ASSEMBLY_PAYLOAD = bytes(range(12))


def _valid_assembly_request(**overrides) -> HelperFrameRequest:
    fields = {
        "request_id": _ASSEMBLY_REQUEST_ID,
        "frame_timestamp_ms": _ASSEMBLY_TIMESTAMP_MS,
    }
    fields.update(overrides)
    return HelperFrameRequest(**fields)


def _valid_assembly_header(**overrides) -> HelperFramePacketHeader:
    fields = {
        "sequence": _ASSEMBLY_REQUEST_ID,
        "frame_timestamp_ms": _ASSEMBLY_TIMESTAMP_MS,
        "width": _ASSEMBLY_WIDTH,
        "height": _ASSEMBLY_HEIGHT,
        "row_stride_bytes": _ASSEMBLY_STRIDE,
        "payload_bytes": _ASSEMBLY_PAYLOAD_BYTES,
    }
    fields.update(overrides)
    return HelperFramePacketHeader(**fields)


# =============================================================================
# Control-line valid cases (1-10)
# =============================================================================


class ControlLineValidCasesTest(unittest.TestCase):
    def test_01_valid_compact_request(self) -> None:
        result = parse_helper_control_line(_valid_request_line())
        self.assertEqual(result, HelperFrameRequest(request_id=7, frame_timestamp_ms=1000))

    def test_02_valid_request_with_legal_whitespace(self) -> None:
        line = (
            '{ "type" : "request" , "schemaVersion" : 1 , '
            '"requestId" : 7 , "frameTimestampMs" : 1000 }'
        )
        result = parse_helper_control_line(line)
        self.assertEqual(result, HelperFrameRequest(request_id=7, frame_timestamp_ms=1000))

    def test_03_request_id_one_accepted(self) -> None:
        result = parse_helper_control_line(_valid_request_line(request_id=1))
        assert isinstance(result, HelperFrameRequest)
        self.assertEqual(result.request_id, 1)

    def test_04_request_id_signed_max_accepted(self) -> None:
        result = parse_helper_control_line(_valid_request_line(request_id=_INT64_MAX))
        assert isinstance(result, HelperFrameRequest)
        self.assertEqual(result.request_id, _INT64_MAX)

    def test_05_timestamp_zero_accepted(self) -> None:
        result = parse_helper_control_line(_valid_request_line(frame_timestamp_ms=0))
        assert isinstance(result, HelperFrameRequest)
        self.assertEqual(result.frame_timestamp_ms, 0)

    def test_06_timestamp_signed_min_accepted(self) -> None:
        result = parse_helper_control_line(
            _valid_request_line(frame_timestamp_ms=_INT64_MIN)
        )
        assert isinstance(result, HelperFrameRequest)
        self.assertEqual(result.frame_timestamp_ms, _INT64_MIN)

    def test_07_timestamp_signed_max_accepted(self) -> None:
        result = parse_helper_control_line(
            _valid_request_line(frame_timestamp_ms=_INT64_MAX)
        )
        assert isinstance(result, HelperFrameRequest)
        self.assertEqual(result.frame_timestamp_ms, _INT64_MAX)

    def test_08_valid_stop(self) -> None:
        result = parse_helper_control_line(_valid_stop_line())
        self.assertEqual(result, HelperStopRequest())

    def test_09_request_fields_exact_builtin_int(self) -> None:
        result = parse_helper_control_line(_valid_request_line())
        assert isinstance(result, HelperFrameRequest)
        self.assertIs(type(result.request_id), int)
        self.assertIs(type(result.frame_timestamp_ms), int)

    def test_10_request_and_stop_are_frozen(self) -> None:
        request = HelperFrameRequest(request_id=1, frame_timestamp_ms=0)
        with self.assertRaises(FrozenInstanceError):
            request.request_id = 2  # type: ignore[misc]
        stop = HelperStopRequest()
        with self.assertRaises(FrozenInstanceError):
            stop.__setattr__("bogus", 1)


# =============================================================================
# Control-line input type and framing (11-23)
# =============================================================================


class ControlLineInputTypeAndFramingTest(unittest.TestCase):
    def test_11_none_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(None))  # type: ignore[arg-type]

    def test_12_bytes_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_valid_request_line().encode("utf-8"))  # type: ignore[arg-type]
        )

    def test_13_bytearray_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(bytearray(_valid_request_line(), "utf-8"))  # type: ignore[arg-type]
        )

    def test_14_memoryview_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(memoryview(_valid_request_line().encode("utf-8")))  # type: ignore[arg-type]
        )

    def test_15_unrelated_object_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(object()))  # type: ignore[arg-type]

    def test_16_str_subclass_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_StrSubclass(_valid_request_line())))

    def test_17_trailing_lf_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_valid_request_line() + "\n"))

    def test_18_trailing_crlf_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_valid_request_line() + "\r\n"))

    def test_19_embedded_lf_returns_none(self) -> None:
        line = _valid_request_line()
        embedded = line[:5] + "\n" + line[5:]
        self.assertIsNone(parse_helper_control_line(embedded))

    def test_20_embedded_cr_returns_none(self) -> None:
        line = _valid_request_line()
        embedded = line[:5] + "\r" + line[5:]
        self.assertIsNone(parse_helper_control_line(embedded))

    def test_21_over_limit_content_returns_none(self) -> None:
        obj = _request_obj(pad="x" * 3000)
        line = _line(obj)
        self.assertGreater(len(line.encode("utf-8")), _MAX_LINE_CONTENT_BYTES)
        self.assertIsNone(parse_helper_control_line(line))

    def test_22_invalid_unicode_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line("\ud800"))

    def test_23_over_limit_rejected_before_json_loads(self) -> None:
        obj = _request_obj(pad="x" * 3000)
        line = _line(obj)
        with mock.patch("json.loads") as mocked_loads:
            result = parse_helper_control_line(line)
        self.assertIsNone(result)
        mocked_loads.assert_not_called()


# =============================================================================
# Strict JSON (24-38)
# =============================================================================


class StrictJsonTest(unittest.TestCase):
    def test_24_empty_string_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(""))

    def test_25_malformed_json_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line('{"type":'))

    def test_26_trailing_garbage_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_valid_request_line() + "trailing-garbage"))

    def test_27_top_level_array_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line("[]"))

    def test_28_top_level_string_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line('"hello"'))

    def test_29_top_level_number_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line("123"))

    def test_30_top_level_boolean_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line("true"))

    def test_31_top_level_null_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line("null"))

    def test_32_nan_constant_returns_none(self) -> None:
        line = '{"type":"request","schemaVersion":1,"requestId":NaN,"frameTimestampMs":1000}'
        self.assertIsNone(parse_helper_control_line(line))

    def test_33_infinity_constant_returns_none(self) -> None:
        line = (
            '{"type":"request","schemaVersion":1,"requestId":Infinity,'
            '"frameTimestampMs":1000}'
        )
        self.assertIsNone(parse_helper_control_line(line))

    def test_34_negative_infinity_constant_returns_none(self) -> None:
        line = (
            '{"type":"request","schemaVersion":1,"requestId":-Infinity,'
            '"frameTimestampMs":1000}'
        )
        self.assertIsNone(parse_helper_control_line(line))

    def test_35_duplicate_type_key_returns_none(self) -> None:
        line = (
            '{"type":"request","type":"request","schemaVersion":1,'
            '"requestId":7,"frameTimestampMs":1000}'
        )
        self.assertIsNone(parse_helper_control_line(line))

    def test_36_duplicate_schema_version_key_returns_none(self) -> None:
        line = (
            '{"type":"request","schemaVersion":1,"schemaVersion":1,'
            '"requestId":7,"frameTimestampMs":1000}'
        )
        self.assertIsNone(parse_helper_control_line(line))

    def test_37_duplicate_request_id_key_returns_none(self) -> None:
        line = (
            '{"type":"request","schemaVersion":1,"requestId":7,"requestId":7,'
            '"frameTimestampMs":1000}'
        )
        self.assertIsNone(parse_helper_control_line(line))

    def test_38_duplicate_frame_timestamp_key_returns_none(self) -> None:
        line = (
            '{"type":"request","schemaVersion":1,"requestId":7,'
            '"frameTimestampMs":1000,"frameTimestampMs":1000}'
        )
        self.assertIsNone(parse_helper_control_line(line))


# =============================================================================
# Request schema (39-62)
# =============================================================================


class RequestSchemaTest(unittest.TestCase):
    def test_39_missing_type_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(), remove_keys=("type",))))

    def test_40_missing_schema_version_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(), remove_keys=("schemaVersion",)))
        )

    def test_41_missing_request_id_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(), remove_keys=("requestId",)))
        )

    def test_42_missing_frame_timestamp_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(), remove_keys=("frameTimestampMs",)))
        )

    def test_43_extra_key_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(extra=1))))

    def test_44_unknown_control_type_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(type="unknown"))))

    def test_45_schema_version_zero_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(schemaVersion=0))))

    def test_46_schema_version_two_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(schemaVersion=2))))

    def test_47_schema_version_float_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(schemaVersion=1.0))))

    def test_48_schema_version_true_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(schemaVersion=True))))

    def test_49_schema_version_string_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(schemaVersion="1"))))

    def test_50_request_id_zero_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(requestId=0))))

    def test_51_request_id_negative_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(requestId=-1))))

    def test_52_request_id_above_max_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(requestId=_INT64_MAX + 1)))
        )

    def test_53_request_id_float_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(requestId=7.0))))

    def test_54_request_id_true_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(requestId=True))))

    def test_55_request_id_string_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(requestId="7"))))

    def test_56_request_id_null_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_request_obj(requestId=None))))

    def test_57_timestamp_below_min_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(
                _line(_request_obj(frameTimestampMs=_INT64_MIN - 1))
            )
        )

    def test_58_timestamp_above_max_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(
                _line(_request_obj(frameTimestampMs=_INT64_MAX + 1))
            )
        )

    def test_59_timestamp_float_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(frameTimestampMs=1000.0)))
        )

    def test_60_timestamp_true_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(frameTimestampMs=True)))
        )

    def test_61_timestamp_string_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(frameTimestampMs="1000")))
        )

    def test_62_timestamp_null_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_request_obj(frameTimestampMs=None)))
        )


# =============================================================================
# Stop schema (63-69)
# =============================================================================


class StopSchemaTest(unittest.TestCase):
    def test_63_stop_missing_schema_version_returns_none(self) -> None:
        self.assertIsNone(
            parse_helper_control_line(_line(_stop_obj(), remove_keys=("schemaVersion",)))
        )

    def test_64_stop_with_request_id_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_stop_obj(requestId=1))))

    def test_65_stop_with_frame_timestamp_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_stop_obj(frameTimestampMs=1))))

    def test_66_stop_with_reason_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_stop_obj(reason="x"))))

    def test_67_stop_with_another_extra_key_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_stop_obj(foo=1))))

    def test_68_stop_wrong_schema_type_returns_none(self) -> None:
        self.assertIsNone(parse_helper_control_line(_line(_stop_obj(schemaVersion="1"))))

    def test_69_request_type_with_stop_key_set_returns_none(self) -> None:
        line = '{"type":"request","schemaVersion":1}'
        self.assertIsNone(parse_helper_control_line(line))


# =============================================================================
# Header valid cases (70-80)
# =============================================================================


class HeaderValidCasesTest(unittest.TestCase):
    def test_70_exact_valid_header_decodes(self) -> None:
        self.assertIsNotNone(decode_helper_frame_packet_header(_valid_header_bytes()))

    def test_71_exact_little_endian_fixture_preserved(self) -> None:
        header_bytes = _encode_header(
            sequence=0x1122334455667788,
            frame_timestamp_ms=-1,
            width=4,
            height=3,
        )
        header = decode_helper_frame_packet_header(header_bytes)
        assert header is not None
        self.assertEqual(header.sequence, 0x1122334455667788)
        self.assertEqual(header.frame_timestamp_ms, -1)
        self.assertEqual(header.width, 4)
        self.assertEqual(header.height, 3)
        self.assertEqual(header.row_stride_bytes, 12)
        self.assertEqual(header.payload_bytes, 36)

    def test_72_negative_signed_timestamp_decodes(self) -> None:
        header = decode_helper_frame_packet_header(
            _encode_header(frame_timestamp_ms=-12345)
        )
        assert header is not None
        self.assertEqual(header.frame_timestamp_ms, -12345)

    def test_73_sequence_zero_decodes(self) -> None:
        header = decode_helper_frame_packet_header(_encode_header(sequence=0))
        assert header is not None
        self.assertEqual(header.sequence, 0)

    def test_74_sequence_uint64_max_decodes(self) -> None:
        header = decode_helper_frame_packet_header(_encode_header(sequence=_UINT64_MAX))
        assert header is not None
        self.assertEqual(header.sequence, _UINT64_MAX)

    def test_75_width_one_accepted(self) -> None:
        header = decode_helper_frame_packet_header(
            _encode_header(width=1, height=2)
        )
        self.assertIsNotNone(header)

    def test_76_width_max_accepted(self) -> None:
        header = decode_helper_frame_packet_header(
            _encode_header(width=7680, height=1)
        )
        self.assertIsNotNone(header)

    def test_77_height_one_accepted(self) -> None:
        header = decode_helper_frame_packet_header(
            _encode_header(width=2, height=1)
        )
        self.assertIsNotNone(header)

    def test_78_height_max_accepted(self) -> None:
        header = decode_helper_frame_packet_header(
            _encode_header(width=1, height=4320)
        )
        self.assertIsNotNone(header)

    def test_79_header_fields_exact_builtin_int(self) -> None:
        header = decode_helper_frame_packet_header(_valid_header_bytes())
        assert header is not None
        for value in dataclasses.astuple(header):
            self.assertIs(type(value), int)

    def test_80_header_is_frozen(self) -> None:
        header = decode_helper_frame_packet_header(_valid_header_bytes())
        assert header is not None
        with self.assertRaises(FrozenInstanceError):
            header.sequence = 99  # type: ignore[misc]


# =============================================================================
# Header input contract (81-87)
# =============================================================================


class HeaderInputContractTest(unittest.TestCase):
    def test_81_none_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(None))  # type: ignore[arg-type]

    def test_82_bytearray_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(bytearray(_valid_header_bytes()))  # type: ignore[arg-type]
        )

    def test_83_memoryview_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(memoryview(_valid_header_bytes()))  # type: ignore[arg-type]
        )

    def test_84_bytes_subclass_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(_BytesSubclass(_valid_header_bytes()))
        )

    def test_85_empty_bytes_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(b""))

    def test_86_47_byte_header_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_valid_header_bytes()[:-1]))

    def test_87_49_byte_header_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_valid_header_bytes() + b"\x00"))


# =============================================================================
# Header structural failures (88-105)
# =============================================================================


class HeaderStructuralFailuresTest(unittest.TestCase):
    def test_88_bad_magic_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(magic=b"XXXX")))

    def test_89_version_zero_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(version=0)))

    def test_90_version_two_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(version=2)))

    def test_91_header_size_47_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(header_size=47)))

    def test_92_header_size_49_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(header_size=49)))

    def test_93_pixel_format_zero_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(pixel_format=0)))

    def test_94_pixel_format_two_returns_none(self) -> None:
        self.assertIsNone(decode_helper_frame_packet_header(_encode_header(pixel_format=2)))

    def test_95_width_zero_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(_encode_header(width=0, height=1))
        )

    def test_96_width_7681_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(_encode_header(width=7681, height=1))
        )

    def test_97_height_zero_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(_encode_header(width=1, height=0))
        )

    def test_98_height_4321_returns_none(self) -> None:
        self.assertIsNone(
            decode_helper_frame_packet_header(_encode_header(width=1, height=4321))
        )

    def test_99_stride_below_expected_returns_none(self) -> None:
        header_bytes = _encode_header(width=4, height=3, row_stride_bytes=11)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_100_stride_above_expected_returns_none(self) -> None:
        header_bytes = _encode_header(width=4, height=3, row_stride_bytes=13)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_101_uint32_max_stride_returns_none(self) -> None:
        header_bytes = _encode_header(
            width=7680, height=1, row_stride_bytes=_UINT32_MAX
        )
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_102_payload_below_expected_returns_none(self) -> None:
        header_bytes = _encode_header(width=4, height=3, payload_bytes=35)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_103_payload_above_expected_returns_none(self) -> None:
        header_bytes = _encode_header(width=4, height=3, payload_bytes=37)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_104_uint64_max_payload_returns_none(self) -> None:
        header_bytes = _encode_header(
            width=7680, height=4320, payload_bytes=_UINT64_MAX
        )
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_105_oversized_declaration_returns_none(self) -> None:
        header_bytes = _encode_header(width=7680, height=4320)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))


# =============================================================================
# Representable payload boundaries (106-108)
# =============================================================================


class RepresentablePayloadBoundariesTest(unittest.TestCase):
    def test_106_7680x1456_accepted_without_payload_allocation(self) -> None:
        header_bytes = _encode_header(width=7680, height=1456)
        header = decode_helper_frame_packet_header(header_bytes)
        self.assertIsNotNone(header)
        assert header is not None
        self.assertEqual(header.payload_bytes, 33546240)

    def test_107_7680x1457_rejected_over_cap(self) -> None:
        header_bytes = _encode_header(width=7680, height=1457)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))

    def test_108_exact_32mib_declaration_inconsistent_with_dims_rejected(self) -> None:
        header_bytes = _encode_header(width=4, height=3, payload_bytes=_MAX_PAYLOAD_BYTES)
        self.assertIsNone(decode_helper_frame_packet_header(header_bytes))


# =============================================================================
# Final assembly valid cases (109-119)
# =============================================================================


class FinalAssemblyValidCasesTest(unittest.TestCase):
    def test_109_valid_inputs_produce_validated_frame_input(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIs(type(result), ValidatedHelperFrameInput)

    def test_110_preserves_request_id(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertEqual(result.request_id, _ASSEMBLY_REQUEST_ID)

    def test_111_preserves_timestamp(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertEqual(result.frame_timestamp_ms, _ASSEMBLY_TIMESTAMP_MS)

    def test_112_preserves_dimensions(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertEqual(result.width, _ASSEMBLY_WIDTH)
        self.assertEqual(result.height, _ASSEMBLY_HEIGHT)

    def test_113_preserves_tight_row_stride(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertEqual(result.row_stride_bytes, _ASSEMBLY_STRIDE)

    def test_114_payload_bytes_equals_len_payload(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertEqual(result.payload_bytes, len(_ASSEMBLY_PAYLOAD))

    def test_115_bgr24_bytes_equals_supplied_payload(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertIs(result.bgr24_bytes, _ASSEMBLY_PAYLOAD)

    def test_116_checksum_is_exact_builtin_int(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertIs(type(result.checksum), int)

    def test_117_checksum_within_uint32(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        self.assertGreaterEqual(result.checksum, 0)
        self.assertLessEqual(result.checksum, _UINT32_MAX)

    def test_118_output_is_frozen(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        assert result is not None
        with self.assertRaises(FrozenInstanceError):
            result.checksum = 0  # type: ignore[misc]

    def test_119_repeated_calls_do_not_share_state(self) -> None:
        result_one = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), bytes(range(12))
        )
        result_two = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), bytes(range(12, 24))
        )
        assert result_one is not None
        assert result_two is not None
        self.assertNotEqual(result_one.bgr24_bytes, result_two.bgr24_bytes)
        self.assertNotEqual(result_one.checksum, result_two.checksum)
        self.assertEqual(result_one.bgr24_bytes, bytes(range(12)))


# =============================================================================
# Final assembly type safety (120-129)
# =============================================================================


class FinalAssemblyTypeSafetyTest(unittest.TestCase):
    def test_120_none_request_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            None, _valid_assembly_header(), _ASSEMBLY_PAYLOAD  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_121_wrong_request_type_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            HelperStopRequest(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_122_request_subclass_returns_none(self) -> None:
        request = _HelperFrameRequestSubclass(
            request_id=_ASSEMBLY_REQUEST_ID, frame_timestamp_ms=_ASSEMBLY_TIMESTAMP_MS
        )
        result = assemble_validated_helper_frame_input(
            request, _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_123_none_header_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), None, _ASSEMBLY_PAYLOAD  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_124_wrong_header_type_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_request(), _ASSEMBLY_PAYLOAD  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_125_header_subclass_returns_none(self) -> None:
        header = _HelperFramePacketHeaderSubclass(
            sequence=_ASSEMBLY_REQUEST_ID,
            frame_timestamp_ms=_ASSEMBLY_TIMESTAMP_MS,
            width=_ASSEMBLY_WIDTH,
            height=_ASSEMBLY_HEIGHT,
            row_stride_bytes=_ASSEMBLY_STRIDE,
            payload_bytes=_ASSEMBLY_PAYLOAD_BYTES,
        )
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_126_none_payload_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), None  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_127_bytearray_payload_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), bytearray(_ASSEMBLY_PAYLOAD)  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_128_memoryview_payload_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(),
            _valid_assembly_header(),
            memoryview(_ASSEMBLY_PAYLOAD),  # type: ignore[arg-type]
        )
        self.assertIsNone(result)

    def test_129_bytes_subclass_payload_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(),
            _valid_assembly_header(),
            _BytesSubclass(_ASSEMBLY_PAYLOAD),
        )
        self.assertIsNone(result)


# =============================================================================
# Manually constructed internal inconsistency (130-142)
# =============================================================================


class ManuallyConstructedInternalInconsistencyTest(unittest.TestCase):
    def test_130_request_bool_request_id_returns_none(self) -> None:
        request = HelperFrameRequest(request_id=True, frame_timestamp_ms=1000)  # type: ignore[arg-type]
        result = assemble_validated_helper_frame_input(
            request, _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_131_request_int_subclass_request_id_returns_none(self) -> None:
        request = HelperFrameRequest(
            request_id=_IntSubclass(_ASSEMBLY_REQUEST_ID),
            frame_timestamp_ms=_ASSEMBLY_TIMESTAMP_MS,
        )
        result = assemble_validated_helper_frame_input(
            request, _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_132_request_id_zero_returns_none(self) -> None:
        request = HelperFrameRequest(request_id=0, frame_timestamp_ms=1000)
        result = assemble_validated_helper_frame_input(
            request, _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_133_request_id_above_signed_max_returns_none(self) -> None:
        request = HelperFrameRequest(request_id=_INT64_MAX + 1, frame_timestamp_ms=1000)
        result = assemble_validated_helper_frame_input(
            request, _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_134_request_invalid_timestamp_type_returns_none(self) -> None:
        request = HelperFrameRequest(request_id=_ASSEMBLY_REQUEST_ID, frame_timestamp_ms="1000")  # type: ignore[arg-type]
        result = assemble_validated_helper_frame_input(
            request, _valid_assembly_header(), _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_135_header_bool_field_returns_none(self) -> None:
        header = _valid_assembly_header(sequence=True)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_136_header_int_subclass_field_returns_none(self) -> None:
        header = _valid_assembly_header(sequence=_IntSubclass(_ASSEMBLY_REQUEST_ID))
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_137_header_invalid_dimensions_returns_none(self) -> None:
        header = _valid_assembly_header(width=0)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_138_header_stride_mismatch_returns_none(self) -> None:
        header = _valid_assembly_header(row_stride_bytes=7)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_139_header_length_mismatch_returns_none(self) -> None:
        header = _valid_assembly_header(payload_bytes=13)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_140_header_above_payload_cap_returns_none(self) -> None:
        # The cap check runs before the exact-length payload check, so a tiny
        # dummy payload proves rejection without allocating 32+ MiB.
        header = HelperFramePacketHeader(
            sequence=_ASSEMBLY_REQUEST_ID,
            frame_timestamp_ms=_ASSEMBLY_TIMESTAMP_MS,
            width=7680,
            height=1457,
            row_stride_bytes=23040,
            payload_bytes=33569280,
        )
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, b""
        )
        self.assertIsNone(result)

    def test_141_header_sequence_above_uint64_returns_none(self) -> None:
        header = _valid_assembly_header(sequence=_UINT64_MAX + 1)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_142_header_timestamp_outside_signed_range_returns_none(self) -> None:
        header = _valid_assembly_header(frame_timestamp_ms=_INT64_MAX + 1)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)


# =============================================================================
# Correlation and payload length (143-149)
# =============================================================================


class CorrelationAndPayloadLengthTest(unittest.TestCase):
    def test_143_mismatched_sequence_returns_none(self) -> None:
        header = _valid_assembly_header(sequence=_ASSEMBLY_REQUEST_ID + 1)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_144_mismatched_timestamp_returns_none(self) -> None:
        header = _valid_assembly_header(frame_timestamp_ms=_ASSEMBLY_TIMESTAMP_MS + 1)
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
        )
        self.assertIsNone(result)

    def test_145_truncated_payload_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD[:-1]
        )
        self.assertIsNone(result)

    def test_146_overlong_payload_returns_none(self) -> None:
        result = assemble_validated_helper_frame_input(
            _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD + b"\x00"
        )
        self.assertIsNone(result)

    def test_147_correlation_failure_before_checksum(self) -> None:
        header = _valid_assembly_header(sequence=_ASSEMBLY_REQUEST_ID + 1)
        with mock.patch("helper_frame_input._fnv1a32") as mocked_fnv:
            result = assemble_validated_helper_frame_input(
                _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
            )
        self.assertIsNone(result)
        mocked_fnv.assert_not_called()

    def test_148_length_failure_before_checksum(self) -> None:
        with mock.patch("helper_frame_input._fnv1a32") as mocked_fnv:
            result = assemble_validated_helper_frame_input(
                _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD[:-1]
            )
        self.assertIsNone(result)
        mocked_fnv.assert_not_called()

    def test_149_invalid_header_before_checksum(self) -> None:
        header = _valid_assembly_header(row_stride_bytes=7)
        with mock.patch("helper_frame_input._fnv1a32") as mocked_fnv:
            result = assemble_validated_helper_frame_input(
                _valid_assembly_request(), header, _ASSEMBLY_PAYLOAD
            )
        self.assertIsNone(result)
        mocked_fnv.assert_not_called()


# =============================================================================
# FNV-1a32 (150-153)
# =============================================================================


class Fnv1a32Test(unittest.TestCase):
    def test_150_empty_bytes_returns_offset_basis(self) -> None:
        self.assertEqual(helper_frame_input._fnv1a32(b""), 2166136261)

    def test_151_known_marker_matches_cpp_checksum(self) -> None:
        marker = b"LVKF-frame-packet-smoke"
        self.assertEqual(helper_frame_input._fnv1a32(marker), 1576141941)

    def test_152_different_payload_differs(self) -> None:
        first = helper_frame_input._fnv1a32(b"LVKF-frame-packet-smoke")
        second = helper_frame_input._fnv1a32(b"LVKF-frame-packet-smokeX")
        self.assertNotEqual(first, second)

    def test_153_checksum_covers_payload_only_not_header(self) -> None:
        request_a = HelperFrameRequest(request_id=7, frame_timestamp_ms=1000)
        header_a = _valid_assembly_header()
        request_b = HelperFrameRequest(request_id=9, frame_timestamp_ms=500)
        header_b = _valid_assembly_header(sequence=9, frame_timestamp_ms=500)

        result_a = assemble_validated_helper_frame_input(
            request_a, header_a, _ASSEMBLY_PAYLOAD
        )
        result_b = assemble_validated_helper_frame_input(
            request_b, header_b, _ASSEMBLY_PAYLOAD
        )
        assert result_a is not None
        assert result_b is not None
        self.assertEqual(result_a.checksum, result_b.checksum)


# =============================================================================
# No I/O / exception policy (154-162)
# =============================================================================


class NoIoExceptionPolicyTest(unittest.TestCase):
    def test_154_valid_parse_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            parse_helper_control_line(_valid_request_line())
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_155_invalid_parse_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            parse_helper_control_line("not json")
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_156_valid_header_decode_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            decode_helper_frame_packet_header(_valid_header_bytes())
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_157_invalid_header_decode_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            decode_helper_frame_packet_header(b"")
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_158_valid_final_assembly_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            assemble_validated_helper_frame_input(
                _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
            )
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_159_invalid_final_assembly_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            assemble_validated_helper_frame_input(None, None, None)  # type: ignore[arg-type]
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_160_base_exception_from_json_loads_not_swallowed(self) -> None:
        with mock.patch("json.loads", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                parse_helper_control_line(_valid_request_line())

    def test_161_base_exception_from_checksum_helper_not_swallowed(self) -> None:
        with mock.patch("helper_frame_input._fnv1a32", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                assemble_validated_helper_frame_input(
                    _valid_assembly_request(), _valid_assembly_header(), _ASSEMBLY_PAYLOAD
                )

    def test_162_production_functions_do_not_mutate_input(self) -> None:
        request = _valid_assembly_request()
        header = _valid_assembly_header()
        payload = bytes(_ASSEMBLY_PAYLOAD)
        before_request = dataclasses.astuple(request)
        before_header = dataclasses.astuple(header)
        before_payload = bytes(payload)

        assemble_validated_helper_frame_input(request, header, payload)

        self.assertEqual(dataclasses.astuple(request), before_request)
        self.assertEqual(dataclasses.astuple(header), before_header)
        self.assertEqual(payload, before_payload)


# =============================================================================
# Test-only cross-runtime fixture consumer CLI mode
# =============================================================================

_FIXTURE_REQUEST_ID = 7
_FIXTURE_FRAME_TIMESTAMP_MS = -123
_FIXTURE_WIDTH = 2
_FIXTURE_HEIGHT = 2
_FIXTURE_HEADER_BYTES = 48
_FIXTURE_PAYLOAD_BYTES = 12


def _consume_cpp_frame_input_fixture(argv: list) -> int:
    if len(argv) != 3:
        return 1
    request_line, packet_hex, checksum_decimal = argv

    if not packet_hex or len(packet_hex) % 2 != 0:
        return 1
    if any(char not in "0123456789abcdef" for char in packet_hex):
        return 1
    try:
        packet_bytes = bytes.fromhex(packet_hex)
    except ValueError:
        return 1

    if len(packet_bytes) != _FIXTURE_HEADER_BYTES + _FIXTURE_PAYLOAD_BYTES:
        return 1

    header_bytes = packet_bytes[:_FIXTURE_HEADER_BYTES]
    payload_bytes = packet_bytes[_FIXTURE_HEADER_BYTES:]

    request = parse_helper_control_line(request_line)
    if type(request) is not HelperFrameRequest:
        return 1
    if request.request_id != _FIXTURE_REQUEST_ID:
        return 1
    if request.frame_timestamp_ms != _FIXTURE_FRAME_TIMESTAMP_MS:
        return 1

    header = decode_helper_frame_packet_header(header_bytes)
    if header is None:
        return 1
    if header.width != _FIXTURE_WIDTH or header.height != _FIXTURE_HEIGHT:
        return 1

    result = assemble_validated_helper_frame_input(request, header, payload_bytes)
    if result is None:
        return 1

    if (
        not checksum_decimal
        or len(checksum_decimal) > 10
        or any(character not in "0123456789" for character in checksum_decimal)
    ):
        return 1

    expected_checksum = int(checksum_decimal)
    if expected_checksum > _UINT32_MAX:
        return 1

    if result.checksum != expected_checksum:
        return 1

    sys.stdout.buffer.write(b"helper-frame-input parity OK\n")
    sys.stdout.buffer.flush()
    return 0


def _valid_cli_fixture_argv() -> list:
    request_line = _valid_request_line(
        request_id=_FIXTURE_REQUEST_ID, frame_timestamp_ms=_FIXTURE_FRAME_TIMESTAMP_MS
    )
    header_bytes = _encode_header(
        sequence=_FIXTURE_REQUEST_ID,
        frame_timestamp_ms=_FIXTURE_FRAME_TIMESTAMP_MS,
        width=_FIXTURE_WIDTH,
        height=_FIXTURE_HEIGHT,
    )
    payload_bytes = bytes(_FIXTURE_PAYLOAD_BYTES)
    packet_hex = (header_bytes + payload_bytes).hex()
    checksum_decimal = str(helper_frame_input._fnv1a32(payload_bytes))
    return [request_line, packet_hex, checksum_decimal]


class CliFixtureConsumerChecksumTest(unittest.TestCase):
    def _run_with_checksum(self, checksum_decimal: str):
        request_line, packet_hex, _ = _valid_cli_fixture_argv()
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exit_code = _consume_cpp_frame_input_fixture(
                [request_line, packet_hex, checksum_decimal]
            )
        return exit_code, out.getvalue(), err.getvalue()

    def test_valid_known_fixture_checksum_accepted(self) -> None:
        argv = _valid_cli_fixture_argv()
        fake_stdout = mock.Mock()
        fake_stdout.buffer = io.BytesIO()
        err = io.StringIO()
        with mock.patch("sys.stdout", fake_stdout), contextlib.redirect_stderr(err):
            exit_code = _consume_cpp_frame_input_fixture(argv)
        self.assertEqual(exit_code, 0)
        self.assertEqual(fake_stdout.buffer.getvalue(), b"helper-frame-input parity OK\n")
        self.assertEqual(err.getvalue(), "")

    def test_non_ascii_digit_checksum_rejected(self) -> None:
        exit_code, out, err = self._run_with_checksum("١٢٣")
        self.assertNotEqual(exit_code, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_checksum_longer_than_int_conversion_digit_limit_rejected(self) -> None:
        exit_code, out, err = self._run_with_checksum("1" * 5000)
        self.assertNotEqual(exit_code, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_ten_digit_checksum_above_uint32_max_rejected(self) -> None:
        exit_code, out, err = self._run_with_checksum(str(_UINT32_MAX + 1).zfill(10))
        self.assertNotEqual(exit_code, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_empty_checksum_rejected(self) -> None:
        exit_code, out, err = self._run_with_checksum("")
        self.assertNotEqual(exit_code, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_checksum_with_non_digit_characters_rejected(self) -> None:
        for checksum_decimal in ("-1", "+1", "1 ", " 1", "1.0", "1e5", "1_0"):
            with self.subTest(checksum_decimal=checksum_decimal):
                exit_code, out, err = self._run_with_checksum(checksum_decimal)
                self.assertNotEqual(exit_code, 0)
                self.assertEqual(out, "")
                self.assertEqual(err, "")


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "--consume-cpp-frame-input-fixture":
        sys.exit(_consume_cpp_frame_input_fixture(sys.argv[2:]))
    unittest.main()
