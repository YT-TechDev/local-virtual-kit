"""Standard-library tests for helper_frame_reader.py.

Run directly: python -B test_helper_frame_reader.py

Uses fake binary control streams and mocked module-level platform seams
only: no real fd 3, Windows HANDLE, pipe, camera, MediaPipe package, model,
file, socket, or subprocess is ever touched.
"""

from __future__ import annotations

import dataclasses
import json
import unittest
from dataclasses import FrozenInstanceError
from unittest import mock

import helper_frame_reader
from helper_frame_input import (
    HelperFramePacketHeader,
    HelperFrameRequest,
    HelperStopRequest,
    ValidatedHelperFrameInput,
)
from helper_frame_reader import (
    HelperFrameInputReader,
    HelperFrameInputReadOutcome,
    HelperFrameInputReadStatus,
)

_MAX_LINE_CONTENT_BYTES = 2048
_FRAME_HEADER_BYTES = 48
_MAGIC = b"LVKF"


def _reference_fnv1a32(data: bytes) -> int:
    """Test-only deterministic FNV-1a32 oracle (P2-C).

    The reader never computes or discovers a checksum: the helper session
    supplies the verified native callable. These tests supply this
    pure-Python reference explicitly as the deterministic oracle.
    """
    hash_value = 2166136261
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


class _CountingChecksum:
    def __init__(self, *, error: BaseException | None = None, result: object = None):
        self.calls: list = []
        self._error = error
        self._result = result

    def __call__(self, data: bytes) -> object:
        self.calls.append(data)
        if self._error is not None:
            raise self._error
        if self._result is not None:
            return self._result
        return _reference_fnv1a32(data)


# =============================================================================
# Fixture helpers
# =============================================================================


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


def _line_bytes(obj: dict) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")


def _valid_request_line_bytes(request_id: int = 7, frame_timestamp_ms: int = 1000) -> bytes:
    return _line_bytes(_request_obj(requestId=request_id, frameTimestampMs=frame_timestamp_ms))


def _valid_stop_line_bytes() -> bytes:
    return _line_bytes(_stop_obj())


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


_VALID_WIDTH = 2
_VALID_HEIGHT = 2
_VALID_PAYLOAD = bytes(range(12))


def _valid_header_bytes(request_id: int = 7, frame_timestamp_ms: int = 1000) -> bytes:
    return _encode_header(sequence=request_id, frame_timestamp_ms=frame_timestamp_ms)


def _valid_frame_bytes(request_id: int = 7, frame_timestamp_ms: int = 1000) -> bytes:
    return _valid_header_bytes(request_id, frame_timestamp_ms) + _VALID_PAYLOAD


# --- Fake control stream -----------------------------------------------------

_NO_ERROR = object()


class _FakeControlStream:
    """Byte-at-a-time fake matching the reader's `read(1)` contract."""

    def __init__(self, data: bytes = b""):
        self._data = data
        self._position = 0
        self.read_calls = 0
        self.closed = False
        self._error = None
        self._bad_return = _NO_ERROR

    def read(self, size: int) -> bytes:
        self.read_calls += 1
        if size != 1:
            raise AssertionError("reader must call control_stream.read(1) only")
        if self._error is not None:
            raise self._error
        if self._bad_return is not _NO_ERROR:
            return self._bad_return
        if self._position >= len(self._data):
            return b""
        byte = self._data[self._position : self._position + 1]
        self._position += 1
        return byte

    def close(self) -> None:
        self.closed = True
        raise AssertionError("reader must never close control_stream")

    @classmethod
    def raising(cls, error: BaseException) -> "_FakeControlStream":
        stream = cls(b"")
        stream._error = error
        return stream

    @classmethod
    def bad_return(cls, value: object) -> "_FakeControlStream":
        stream = cls(b"")
        stream._bad_return = value
        return stream


def _stream_for_lines(*chunks: bytes) -> _FakeControlStream:
    return _FakeControlStream(b"".join(chunks))


# --- Frame fd fakes ------------------------------------------------------


class _FakeFrameFd:
    """Simulates the private frame endpoint via patched module-level seams."""

    def __init__(self, data: bytes = b"", *, chunk_size: int = 1):
        self.data = data
        self.position = 0
        self.chunk_size = chunk_size
        self.closed_fds: list[int] = []
        self.close_error = None
        self.read_error = None
        self.next_fd = 3

    def read(self, fd: int, size: int) -> bytes:
        if self.read_error is not None:
            raise self.read_error
        remaining = len(self.data) - self.position
        if remaining <= 0:
            return b""
        take = min(size, self.chunk_size, remaining)
        chunk = self.data[self.position : self.position + take]
        self.position += take
        return chunk

    def close(self, fd: int) -> None:
        self.closed_fds.append(fd)
        if self.close_error is not None:
            raise self.close_error


def _posix(monkeypatch_target=None):
    return mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="posix")


# =============================================================================
# Output contract
# =============================================================================


class OutputContractTest(unittest.TestCase):
    def test_status_enum_exact_members(self) -> None:
        expected = {
            "FRAME",
            "STOP",
            "EOF",
            "CLOSED",
            "CONTROL_READ_FAILED",
            "CONTROL_LINE_INCOMPLETE",
            "CONTROL_LINE_TOO_LONG",
            "CONTROL_DECODE_FAILED",
            "CONTROL_INVALID",
            "FRAME_ENDPOINT_INVALID",
            "FRAME_HEADER_INCOMPLETE",
            "FRAME_HEADER_READ_FAILED",
            "FRAME_HEADER_INVALID",
            "FRAME_PAYLOAD_INCOMPLETE",
            "FRAME_PAYLOAD_READ_FAILED",
            "FRAME_ASSEMBLY_FAILED",
        }
        actual = {member.value for member in HelperFrameInputReadStatus}
        self.assertEqual(actual, expected)

    def test_outcome_is_frozen(self) -> None:
        outcome = HelperFrameInputReadOutcome(HelperFrameInputReadStatus.EOF, None)
        with self.assertRaises(FrozenInstanceError):
            outcome.status = HelperFrameInputReadStatus.STOP  # type: ignore[misc]

    def test_outcome_has_exactly_two_fields(self) -> None:
        field_names = {f.name for f in dataclasses.fields(HelperFrameInputReadOutcome)}
        self.assertEqual(field_names, {"status", "frame_input"})

    def test_frame_input_hidden_from_repr(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)
        text = repr(outcome)
        self.assertNotIn("bgr24_bytes", text)
        self.assertNotIn("checksum", text)
        self.assertIn("status=", text)

    def test_frame_status_has_exact_frame_input_type(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertIs(type(outcome.frame_input), ValidatedHelperFrameInput)

    def test_non_frame_statuses_have_none_frame_input(self) -> None:
        for status_value in HelperFrameInputReadStatus:
            if status_value is HelperFrameInputReadStatus.FRAME:
                continue
            outcome = HelperFrameInputReadOutcome(status_value, None)
            self.assertIsNone(outcome.frame_input)

    def test_outcome_has_no_extra_public_attributes(self) -> None:
        outcome = HelperFrameInputReadOutcome(HelperFrameInputReadStatus.EOF, None)
        for forbidden in ("endpoint", "handle", "fd", "raw_control", "header", "payload", "checksum", "path"):
            self.assertFalse(hasattr(outcome, forbidden))


# =============================================================================
# Valid operation
# =============================================================================


class ValidOperationTest(unittest.TestCase):
    def test_compact_valid_request_produces_frame(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)
        assert outcome.frame_input is not None
        self.assertEqual(outcome.frame_input.request_id, 7)
        self.assertEqual(outcome.frame_input.bgr24_bytes, _VALID_PAYLOAD)

    def test_arbitrarily_partitioned_header_and_payload_reads(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes(), chunk_size=3)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)
        assert outcome.frame_input is not None
        self.assertEqual(outcome.frame_input.bgr24_bytes, _VALID_PAYLOAD)

    def test_single_byte_partitioned_reads(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes(), chunk_size=1)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)

    def test_returned_object_identity_equals_assembler_output(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        sentinel = ValidatedHelperFrameInput(
            request_id=7,
            frame_timestamp_ms=1000,
            width=2,
            height=2,
            row_stride_bytes=6,
            payload_bytes=12,
            bgr24_bytes=_VALID_PAYLOAD,
            checksum=123,
        )
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
            mock.patch.object(
                helper_frame_reader, "assemble_validated_helper_frame_input", return_value=sentinel
            ),
        ):
            outcome = reader.read_next()
        self.assertIs(outcome.frame_input, sentinel)

    def test_exact_call_order(self) -> None:
        calls: list[str] = []
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        # A large chunk_size so each header/payload read completes in one
        # call: keeps the read_header/read_payload classification below exact.
        fd_fake = _FakeFrameFd(_valid_frame_bytes(), chunk_size=1024)

        real_parse = helper_frame_reader.parse_helper_control_line
        real_decode = helper_frame_reader.decode_helper_frame_packet_header
        real_assemble = helper_frame_reader.assemble_validated_helper_frame_input

        def parse_spy(line):
            calls.append("parse")
            return real_parse(line)

        def resolve_spy():
            calls.append("resolve")
            return "posix"

        def read_spy(fd, size):
            if "decode" not in calls:
                calls.append("read_header")
            else:
                calls.append("read_payload")
            return fd_fake.read(fd, size)

        def decode_spy(header_bytes):
            calls.append("decode")
            return real_decode(header_bytes)

        def assemble_spy(request, header, payload, checksum):
            calls.append("assemble")
            return real_assemble(request, header, payload, checksum)

        with (
            mock.patch.object(helper_frame_reader, "parse_helper_control_line", side_effect=parse_spy),
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", side_effect=resolve_spy),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=read_spy),
            mock.patch.object(
                helper_frame_reader, "decode_helper_frame_packet_header", side_effect=decode_spy
            ),
            mock.patch.object(
                helper_frame_reader, "assemble_validated_helper_frame_input", side_effect=assemble_spy
            ),
        ):
            outcome = reader.read_next()

        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)
        expected_prefix = ["parse", "resolve", "read_header"]
        self.assertEqual(calls[: len(expected_prefix)], expected_prefix)
        self.assertIn("decode", calls)
        self.assertIn("read_payload", calls)
        self.assertIn("assemble", calls)
        self.assertLess(calls.index("decode"), calls.index("read_payload"))
        self.assertLess(calls.index("read_payload"), calls.index("assemble"))

    def test_two_sequential_frames_share_endpoint_independent_values(self) -> None:
        first_frame = _valid_frame_bytes(request_id=7, frame_timestamp_ms=1000)
        second_frame = _valid_frame_bytes(request_id=9, frame_timestamp_ms=2000)
        stream = _stream_for_lines(
            _valid_request_line_bytes(request_id=7, frame_timestamp_ms=1000),
            b"\n",
            _valid_request_line_bytes(request_id=9, frame_timestamp_ms=2000),
            b"\n",
        )
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(first_frame + second_frame)

        resolve_calls = []
        real_detect = helper_frame_reader._detect_platform_kind

        def counting_detect():
            resolve_calls.append(1)
            return "posix"

        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", side_effect=counting_detect),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
        ):
            outcome_one = reader.read_next()
            outcome_two = reader.read_next()

        self.assertEqual(outcome_one.status, HelperFrameInputReadStatus.FRAME)
        self.assertEqual(outcome_two.status, HelperFrameInputReadStatus.FRAME)
        assert outcome_one.frame_input is not None
        assert outcome_two.frame_input is not None
        self.assertEqual(outcome_one.frame_input.request_id, 7)
        self.assertEqual(outcome_two.frame_input.request_id, 9)
        self.assertEqual(len(resolve_calls), 1)

    def test_following_stop_has_no_stale_frame_and_closes_endpoint(self) -> None:
        stream = _stream_for_lines(
            _valid_request_line_bytes(),
            b"\n",
            _valid_stop_line_bytes(),
            b"\n",
        )
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome_one = reader.read_next()
            with mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close):
                outcome_two = reader.read_next()
        self.assertEqual(outcome_one.status, HelperFrameInputReadStatus.FRAME)
        self.assertEqual(outcome_two.status, HelperFrameInputReadStatus.STOP)
        self.assertIsNone(outcome_two.frame_input)
        self.assertEqual(fd_fake.closed_fds, [helper_frame_reader._POSIX_FRAME_FD])

    def test_valid_stop_alone_reads_no_frame(self) -> None:
        stream = _stream_for_lines(_valid_stop_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with mock.patch.object(helper_frame_reader, "_detect_platform_kind") as detect_mock:
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.STOP)
        detect_mock.assert_not_called()


# =============================================================================
# Control framing
# =============================================================================


class ControlFramingTest(unittest.TestCase):
    def test_exactly_2048_bytes_plus_lf_accepted(self) -> None:
        base = _line_bytes(_request_obj())
        # Pad with legal whitespace right after the opening brace so the
        # schema (exact key set) stays valid while content length grows.
        padding_len = _MAX_LINE_CONTENT_BYTES - len(base)
        self.assertGreater(padding_len, 0)
        content = b"{" + b" " * padding_len + base[1:]
        self.assertEqual(len(content), _MAX_LINE_CONTENT_BYTES)
        stream = _stream_for_lines(content, b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="posix"):
            with mock.patch.object(helper_frame_reader, "_resolve_posix_frame_fd", return_value=-1):
                outcome = reader.read_next()
        self.assertNotEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_LINE_TOO_LONG)
        self.assertNotEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_INVALID)

    def test_2049th_byte_rejected_before_further_accumulation(self) -> None:
        content = b"{" + b"x" * 2100
        stream = _stream_for_lines(content, b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_LINE_TOO_LONG)
        self.assertLessEqual(stream.read_calls, _MAX_LINE_CONTENT_BYTES + 2)

    def test_empty_line_is_invalid(self) -> None:
        stream = _stream_for_lines(b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_INVALID)

    def test_clean_eof_before_any_byte(self) -> None:
        stream = _stream_for_lines(b"")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.EOF)

    def test_partial_eof_after_content(self) -> None:
        stream = _stream_for_lines(b'{"type":"stop"')
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_LINE_INCOMPLETE)

    def test_malformed_utf8_returns_decode_failed(self) -> None:
        stream = _stream_for_lines(b"\xff\xfe", b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_DECODE_FAILED)

    def test_crlf_leaves_cr_and_is_rejected(self) -> None:
        stream = _stream_for_lines(_valid_stop_line_bytes(), b"\r\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_INVALID)

    def test_embedded_cr_rejected(self) -> None:
        line = _valid_stop_line_bytes()
        embedded = line[:3] + b"\r" + line[3:]
        stream = _stream_for_lines(embedded, b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_INVALID)

    def test_ordinary_read_failure(self) -> None:
        stream = _FakeControlStream.raising(OSError("boom"))
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_READ_FAILED)

    def test_base_exception_from_control_read_not_swallowed(self) -> None:
        stream = _FakeControlStream.raising(KeyboardInterrupt())
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with self.assertRaises(KeyboardInterrupt):
            reader.read_next()

    def test_invalid_read_return_type(self) -> None:
        stream = _FakeControlStream.bad_return("not-bytes")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_READ_FAILED)

    def test_invalid_read_return_length(self) -> None:
        stream = _FakeControlStream.bad_return(b"ab")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_READ_FAILED)

    def test_parser_invalid_result_returns_control_invalid(self) -> None:
        stream = _stream_for_lines(_line_bytes(_request_obj(extra=1)), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CONTROL_INVALID)

    def test_parser_called_exactly_once(self) -> None:
        stream = _stream_for_lines(_valid_stop_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with mock.patch.object(
            helper_frame_reader, "parse_helper_control_line", return_value=HelperStopRequest()
        ) as parse_mock:
            reader.read_next()
        parse_mock.assert_called_once()

    def test_stop_performs_no_endpoint_resolution_or_read(self) -> None:
        stream = _stream_for_lines(_valid_stop_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind") as detect_mock,
            mock.patch.object(helper_frame_reader, "_read_from_fd") as read_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.STOP)
        detect_mock.assert_not_called()
        read_mock.assert_not_called()


# =============================================================================
# Frame failures
# =============================================================================


class FrameFailuresTest(unittest.TestCase):
    def test_missing_endpoint_returns_frame_endpoint_invalid(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="unsupported"):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)

    def test_invalid_negative_fd_returns_frame_endpoint_invalid(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="posix"),
            mock.patch.object(helper_frame_reader, "_resolve_posix_frame_fd", return_value=-1),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)

    def test_zero_byte_header_eof(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(b"")
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_INCOMPLETE)

    def test_partial_header_eof(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_header_bytes()[:10])
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_INCOMPLETE)

    def test_header_read_exception(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=OSError("boom")),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)

    def test_invalid_read_return_type_for_header(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", return_value="not-bytes"),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)

    def test_oversized_chunk_for_header_is_read_failure(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", return_value=b"x" * 999),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)

    def test_invalid_header_returns_frame_header_invalid(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        bad_header = _encode_header(magic=b"XXXX")
        fd_fake = _FakeFrameFd(bad_header)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_INVALID)

    def test_no_payload_read_after_invalid_header(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        bad_header = _encode_header(magic=b"XXXX")

        read_calls: list[int] = []

        def spy_read(fd, size):
            read_calls.append(size)
            return bad_header[: min(size, len(bad_header))] if bad_header else b""

        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=spy_read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_INVALID)
        self.assertTrue(all(size == _FRAME_HEADER_BYTES for size in read_calls))

    def test_partial_payload_eof(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        truncated = _valid_header_bytes() + _VALID_PAYLOAD[:-1]
        fd_fake = _FakeFrameFd(truncated)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_PAYLOAD_INCOMPLETE)

    def test_payload_read_exception(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        header = _valid_header_bytes()
        call_count = {"n": 0}

        def spy_read(fd, size):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return header
            raise OSError("boom")

        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=spy_read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_PAYLOAD_READ_FAILED)

    def test_assembly_correlation_failure(self) -> None:
        mismatched_request = _valid_request_line_bytes(request_id=7)
        header_for_different_id = _encode_header(sequence=9)
        stream = _stream_for_lines(mismatched_request, b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(header_for_different_id + _VALID_PAYLOAD)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ASSEMBLY_FAILED)

    def test_no_assembly_call_after_header_failure(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        bad_header = _encode_header(magic=b"XXXX")
        fd_fake = _FakeFrameFd(bad_header)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
            mock.patch.object(helper_frame_reader, "assemble_validated_helper_frame_input") as assemble_mock,
        ):
            reader.read_next()
        assemble_mock.assert_not_called()

    def test_no_assembly_call_after_payload_failure(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        truncated = _valid_header_bytes() + _VALID_PAYLOAD[:-1]
        fd_fake = _FakeFrameFd(truncated)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
            mock.patch.object(helper_frame_reader, "assemble_validated_helper_frame_input") as assemble_mock,
        ):
            reader.read_next()
        assemble_mock.assert_not_called()


# =============================================================================
# Bounded EINTR retry
# =============================================================================

_MAX_INTERRUPTED_READ_RETRIES = helper_frame_reader._MAX_INTERRUPTED_READ_RETRIES


class InterruptedReadBoundTest(unittest.TestCase):
    def test_one_interruption_then_valid_data_succeeds(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        side_effect = [InterruptedError(), _valid_header_bytes(), _VALID_PAYLOAD]
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=side_effect),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)
        assert outcome.frame_input is not None
        self.assertEqual(outcome.frame_input.bgr24_bytes, _VALID_PAYLOAD)

    def test_cap_plus_one_header_interruptions_fail_header_read(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        side_effect = [InterruptedError()] * (_MAX_INTERRUPTED_READ_RETRIES + 1)
        with (
            _posix(),
            mock.patch.object(
                helper_frame_reader, "_read_from_fd", side_effect=side_effect
            ) as read_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)
        self.assertEqual(read_mock.call_count, _MAX_INTERRUPTED_READ_RETRIES + 1)

    def test_header_exhaustion_closes_endpoint_once_and_next_read_is_closed(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n", _valid_stop_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        side_effect = [InterruptedError()] * (_MAX_INTERRUPTED_READ_RETRIES + 1)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=side_effect),
            mock.patch.object(helper_frame_reader, "_close_fd") as close_mock,
        ):
            outcome_one = reader.read_next()
            outcome_two = reader.read_next()
        self.assertEqual(outcome_one.status, HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)
        close_mock.assert_called_once_with(helper_frame_reader._POSIX_FRAME_FD)
        self.assertEqual(outcome_two.status, HelperFrameInputReadStatus.CLOSED)

    def test_valid_header_then_cap_plus_one_payload_interruptions_fails_payload_read(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        side_effect = [_valid_header_bytes()] + [InterruptedError()] * (
            _MAX_INTERRUPTED_READ_RETRIES + 1
        )
        with (
            _posix(),
            mock.patch.object(
                helper_frame_reader, "_read_from_fd", side_effect=side_effect
            ) as read_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_PAYLOAD_READ_FAILED)
        # One header read call, plus exactly cap + 1 bounded payload attempts.
        self.assertEqual(read_mock.call_count, 1 + _MAX_INTERRUPTED_READ_RETRIES + 1)

    def test_interrupted_count_not_reset_after_partial_short_read(self) -> None:
        # A short (partial) successful read must not reset the interrupted
        # count for the remainder of the same _read_exact() operation.
        header = _valid_header_bytes()
        side_effect = (
            [header[:10]]
            + [InterruptedError()] * (_MAX_INTERRUPTED_READ_RETRIES + 1)
        )
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            _posix(),
            mock.patch.object(
                helper_frame_reader, "_read_from_fd", side_effect=side_effect
            ) as read_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)
        self.assertEqual(read_mock.call_count, 1 + _MAX_INTERRUPTED_READ_RETRIES + 1)

    def test_keyboard_interrupt_remains_visible_during_exact_read(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=KeyboardInterrupt),
        ):
            with self.assertRaises(KeyboardInterrupt):
                reader.read_next()

    def test_system_exit_remains_visible_during_exact_read(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=SystemExit),
        ):
            with self.assertRaises(SystemExit):
                reader.read_next()

    def test_no_timeout_sleep_or_deadline_module_used(self) -> None:
        import inspect

        source = inspect.getsource(helper_frame_reader)
        for forbidden in ("time.sleep", "import time", "import threading", "signal.", "deadline"):
            self.assertNotIn(forbidden, source)


# =============================================================================
# Platform seams
# =============================================================================


class PlatformSeamsTest(unittest.TestCase):
    def test_posix_resolves_only_fd_3_and_does_not_inspect_windows_env(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="posix"),
            mock.patch.object(helper_frame_reader, "_get_env_value") as env_mock,
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)
        env_mock.assert_not_called()

    def test_windows_accepts_valid_handle_representation(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value="1234"),
            mock.patch.object(helper_frame_reader, "_adopt_windows_handle", return_value=9),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME)

    def test_windows_rejects_missing_value(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value=None),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)

    def test_windows_rejects_various_malformed_values(self) -> None:
        malformed_values = [
            "",
            " ",
            " 1234",
            "1234 ",
            "+1234",
            "1234\x00",
            "12\r34",
            "12\n34",
            "12a4",
            "12.4",
            "١٢٣",  # Arabic-Indic digits: non-ASCII
            str(helper_frame_reader._INTPTR_MAX + 1),
            str(helper_frame_reader._INTPTR_MIN - 1),
            "0",
            "-1",
            "1" * 25,
        ]
        for value in malformed_values:
            with self.subTest(value=repr(value)):
                stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
                reader = HelperFrameInputReader(stream, _reference_fnv1a32)
                with (
                    mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
                    mock.patch.object(helper_frame_reader, "_get_env_value", return_value=value),
                    mock.patch.object(helper_frame_reader, "_adopt_windows_handle") as adopt_mock,
                ):
                    outcome = reader.read_next()
                self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)
                adopt_mock.assert_not_called()

    def test_successful_windows_adoption_closes_only_adopted_fd(self) -> None:
        stream = _stream_for_lines(
            _valid_request_line_bytes(), b"\n", _valid_stop_line_bytes(), b"\n"
        )
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value="4321"),
            mock.patch.object(helper_frame_reader, "_adopt_windows_handle", return_value=42),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
            mock.patch.object(helper_frame_reader, "_close_windows_handle") as raw_close_mock,
            mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close),
        ):
            reader.read_next()
            outcome_two = reader.read_next()
        self.assertEqual(outcome_two.status, HelperFrameInputReadStatus.STOP)
        self.assertEqual(fd_fake.closed_fds, [42])
        raw_close_mock.assert_not_called()

    def test_failed_pre_adoption_path_attempts_raw_handle_close_once(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value="4321"),
            mock.patch.object(
                helper_frame_reader, "_adopt_windows_handle", side_effect=OSError("adopt failed")
            ),
            mock.patch.object(helper_frame_reader, "_close_windows_handle") as raw_close_mock,
            mock.patch.object(helper_frame_reader, "_close_fd") as close_fd_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)
        raw_close_mock.assert_called_once_with(4321)
        close_fd_mock.assert_not_called()

    def test_raw_handle_close_failure_is_swallowed(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value="4321"),
            mock.patch.object(
                helper_frame_reader, "_adopt_windows_handle", side_effect=OSError("adopt failed")
            ),
            mock.patch.object(
                helper_frame_reader, "_close_windows_handle", side_effect=OSError("close failed")
            ),
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)

    def test_invalid_adopted_fd_attempts_raw_handle_close(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value="4321"),
            mock.patch.object(helper_frame_reader, "_adopt_windows_handle", return_value=-1),
            mock.patch.object(helper_frame_reader, "_close_windows_handle") as raw_close_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)
        raw_close_mock.assert_called_once_with(4321)

    def test_unsupported_platform_fails_closed(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="unsupported"),
            mock.patch.object(helper_frame_reader, "_get_env_value") as env_mock,
            mock.patch.object(helper_frame_reader, "_resolve_posix_frame_fd") as posix_mock,
        ):
            outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)
        env_mock.assert_not_called()
        posix_mock.assert_not_called()

    def test_base_exception_from_adopt_not_swallowed(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        with (
            mock.patch.object(helper_frame_reader, "_detect_platform_kind", return_value="windows"),
            mock.patch.object(helper_frame_reader, "_get_env_value", return_value="4321"),
            mock.patch.object(
                helper_frame_reader, "_adopt_windows_handle", side_effect=KeyboardInterrupt
            ),
        ):
            with self.assertRaises(KeyboardInterrupt):
                reader.read_next()


# =============================================================================
# Cleanup and privacy
# =============================================================================


class CleanupAndPrivacyTest(unittest.TestCase):
    def test_close_before_endpoint_resolution_returns_true(self) -> None:
        reader = HelperFrameInputReader(_FakeControlStream(b""), _reference_fnv1a32)
        self.assertTrue(reader.close())

    def test_close_after_frame_success_closes_fd(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            reader.read_next()
        with mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close):
            result = reader.close()
        self.assertTrue(result)
        self.assertEqual(fd_fake.closed_fds, [helper_frame_reader._POSIX_FRAME_FD])

    def test_automatic_close_on_control_eof(self) -> None:
        reader = HelperFrameInputReader(_FakeControlStream(b""), _reference_fnv1a32)
        reader.read_next()
        # No endpoint was opened, so close() should be a no-op success.
        self.assertTrue(reader.close())

    def test_automatic_close_on_frame_failure(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(b"")
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
            mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close),
        ):
            outcome = reader.read_next()
            second = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_INCOMPLETE)
        self.assertEqual(second.status, HelperFrameInputReadStatus.CLOSED)
        self.assertEqual(fd_fake.closed_fds, [helper_frame_reader._POSIX_FRAME_FD])

    def test_idempotent_close(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            reader.read_next()
        with mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close) as close_mock:
            first_result = reader.close()
            second_result = reader.close()
        self.assertEqual(first_result, second_result)
        close_mock.assert_called_once()

    def test_close_failure_returns_false_with_no_retry(self) -> None:
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        fd_fake.close_error = OSError("close failed")
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            reader.read_next()
        with mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close) as close_mock:
            first_result = reader.close()
            second_result = reader.close()
        self.assertFalse(first_result)
        self.assertFalse(second_result)
        close_mock.assert_called_once()

    def test_control_stream_never_closed(self) -> None:
        stream = _stream_for_lines(_valid_stop_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        reader.read_next()
        reader.close()
        self.assertFalse(stream.closed)

    def test_read_next_after_close_returns_closed_without_reading(self) -> None:
        stream = _stream_for_lines(_valid_stop_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        reader.close()
        calls_before = stream.read_calls
        outcome = reader.read_next()
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.CLOSED)
        self.assertEqual(stream.read_calls, calls_before)

    def test_no_stdout_or_stderr(self) -> None:
        import contextlib
        import io

        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(_valid_frame_bytes())
        out, err = io.StringIO(), io.StringIO()
        with (
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
        ):
            reader.read_next()
            reader.close()
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_no_retained_frame_history(self) -> None:
        stream = _stream_for_lines(
            _valid_request_line_bytes(request_id=7, frame_timestamp_ms=1000),
            b"\n",
            _valid_request_line_bytes(request_id=9, frame_timestamp_ms=2000),
            b"\n",
        )
        reader = HelperFrameInputReader(stream, _reference_fnv1a32)
        fd_fake = _FakeFrameFd(
            _valid_frame_bytes(7, 1000) + _valid_frame_bytes(9, 2000)
        )
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            reader.read_next()
            for attribute_name in vars(reader):
                value = getattr(reader, attribute_name)
                self.assertNotIsInstance(value, ValidatedHelperFrameInput)
            reader.read_next()

    def test_close_returns_bool_type(self) -> None:
        reader = HelperFrameInputReader(_FakeControlStream(b""), _reference_fnv1a32)
        self.assertIs(type(reader.close()), bool)


# =============================================================================
# P2-C: session-owned checksum supplied to frame assembly
# =============================================================================


class ReaderChecksumDependencyTest(unittest.TestCase):
    def _read_one(self, checksum, frame_bytes=None):
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, checksum)
        fd_fake = _FakeFrameFd(frame_bytes if frame_bytes is not None else _valid_frame_bytes(), chunk_size=1024)
        with (
            _posix(),
            mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read),
            mock.patch.object(helper_frame_reader, "_close_fd", side_effect=fd_fake.close),
        ):
            outcome = reader.read_next()
            follow_up = reader.read_next()
        return outcome, follow_up, fd_fake

    def test_checksum_is_a_required_constructor_argument(self) -> None:
        with self.assertRaises(TypeError):
            HelperFrameInputReader(_stream_for_lines(b""))  # type: ignore[call-arg]

    def test_non_callable_checksum_rejected_at_construction(self) -> None:
        for value in (None, 0, b"", "fnv", object()):
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(TypeError):
                    HelperFrameInputReader(_stream_for_lines(b""), value)  # type: ignore[arg-type]

    def test_supplied_checksum_invoked_once_per_accepted_frame_on_payload(self) -> None:
        first_frame = _valid_frame_bytes(request_id=7, frame_timestamp_ms=1000)
        second_frame = _valid_frame_bytes(request_id=9, frame_timestamp_ms=2000)
        stream = _stream_for_lines(
            _valid_request_line_bytes(request_id=7, frame_timestamp_ms=1000),
            b"\n",
            _valid_request_line_bytes(request_id=9, frame_timestamp_ms=2000),
            b"\n",
        )
        checksum = _CountingChecksum()
        reader = HelperFrameInputReader(stream, checksum)
        fd_fake = _FakeFrameFd(first_frame + second_frame, chunk_size=1024)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            first = reader.read_next()
            second = reader.read_next()
        self.assertEqual(first.status, HelperFrameInputReadStatus.FRAME)
        self.assertEqual(second.status, HelperFrameInputReadStatus.FRAME)
        assert first.frame_input is not None and second.frame_input is not None
        self.assertEqual(len(checksum.calls), 2)
        self.assertIs(checksum.calls[0], first.frame_input.bgr24_bytes)
        self.assertIs(checksum.calls[1], second.frame_input.bgr24_bytes)
        self.assertEqual(first.frame_input.checksum, _reference_fnv1a32(_VALID_PAYLOAD))

    def test_checksum_exception_fails_frame_closed_as_assembly_failed(self) -> None:
        checksum = _CountingChecksum(error=RuntimeError("synthetic native checksum failure"))
        outcome, follow_up, fd_fake = self._read_one(checksum)
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ASSEMBLY_FAILED)
        self.assertIsNone(outcome.frame_input)
        self.assertEqual(len(checksum.calls), 1)
        # Terminal: endpoint closed exactly once, nothing further is read.
        self.assertEqual(fd_fake.closed_fds, [3])
        self.assertEqual(follow_up.status, HelperFrameInputReadStatus.CLOSED)

    def test_invalid_checksum_result_fails_frame_closed(self) -> None:
        checksum = _CountingChecksum(result="not-an-int")
        outcome, follow_up, _ = self._read_one(checksum)
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ASSEMBLY_FAILED)
        self.assertEqual(follow_up.status, HelperFrameInputReadStatus.CLOSED)

    def test_keyboard_interrupt_from_checksum_not_swallowed(self) -> None:
        checksum = _CountingChecksum(error=KeyboardInterrupt())
        stream = _stream_for_lines(_valid_request_line_bytes(), b"\n")
        reader = HelperFrameInputReader(stream, checksum)
        fd_fake = _FakeFrameFd(_valid_frame_bytes(), chunk_size=1024)
        with _posix(), mock.patch.object(helper_frame_reader, "_read_from_fd", side_effect=fd_fake.read):
            with self.assertRaises(KeyboardInterrupt):
                reader.read_next()

    def test_invalid_header_never_invokes_checksum(self) -> None:
        checksum = _CountingChecksum()
        bad_header = b"XXXX" + _valid_frame_bytes()[4:]
        outcome, _, _ = self._read_one(checksum, bad_header)
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_HEADER_INVALID)
        self.assertEqual(checksum.calls, [])

    def test_truncated_payload_never_invokes_checksum(self) -> None:
        checksum = _CountingChecksum()
        outcome, _, _ = self._read_one(checksum, _valid_frame_bytes()[:-1])
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_PAYLOAD_INCOMPLETE)
        self.assertEqual(checksum.calls, [])

    def test_correlation_mismatch_never_invokes_checksum(self) -> None:
        checksum = _CountingChecksum()
        outcome, _, _ = self._read_one(checksum, _valid_frame_bytes(request_id=8))
        self.assertEqual(outcome.status, HelperFrameInputReadStatus.FRAME_ASSEMBLY_FAILED)
        self.assertEqual(checksum.calls, [])

    def test_stop_and_eof_never_invoke_checksum(self) -> None:
        for chunks, expected in (
            ((_valid_stop_line_bytes(), b"\n"), HelperFrameInputReadStatus.STOP),
            ((), HelperFrameInputReadStatus.EOF),
        ):
            with self.subTest(expected=expected.name):
                checksum = _CountingChecksum()
                reader = HelperFrameInputReader(_stream_for_lines(*chunks), checksum)
                self.assertEqual(reader.read_next().status, expected)
                self.assertEqual(checksum.calls, [])

    def test_reader_never_loads_or_discovers_a_checksum(self) -> None:
        import inspect

        source = inspect.getsource(helper_frame_reader)
        for forbidden in ("helper_native_fnv", "load_native_fnv1a32", "_fnv1a32(", "16777619"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
