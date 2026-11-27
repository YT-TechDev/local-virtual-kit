"""Standard-library tests for helper_frame_rgb.py.

Run directly: python -B test_helper_frame_rgb.py

P2-C native integration (actual compiled lvk-fnv1a32 library, both Python
validation stages, no fake checksum):

    python -B test_helper_frame_rgb.py --native-library <absolute path>

Integrated preprocessing benchmark (synthetic BGR24 only; no camera, no
MediaPipe):

    python -B test_helper_frame_rgb.py --native-library <absolute path> \
        --benchmark [--samples N] [--warmup N] [--build-config LABEL] \
        [--enforce-acceptance]

Without --native-library the NativeLibraryIntegrationTest cases are reported
as skipped (never silently); Native CI always passes the library.
"""

from __future__ import annotations

import contextlib
import dataclasses
import inspect
import io
import json
import math
import os
import platform
import sys
import time
import unittest
from dataclasses import FrozenInstanceError
from unittest import mock

import helper_frame_rgb
from helper_frame_input import (
    HelperFramePacketHeader,
    HelperFrameRequest,
    ValidatedHelperFrameInput,
    assemble_validated_helper_frame_input,
)
from helper_frame_rgb import (
    ValidatedHelperRgb24Frame,
    convert_validated_helper_frame_input_to_rgb24,
)
from helper_native_fnv import load_native_fnv1a32

# Set by main() from --native-library. Never derived or searched for.
_NATIVE_LIBRARY_PATH: str | None = None


def _reference_fnv1a32(data: bytes) -> int:
    """Test-only deterministic FNV-1a32 oracle (P2-C).

    Production RGB conversion no longer contains a checksum implementation:
    the helper session injects the verified native callable. These tests
    supply this pure-Python reference explicitly as the deterministic oracle.
    """
    hash_value = 2166136261
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


class _CountingChecksum:
    """Records every invocation; delegates to `delegate` unless overridden."""

    def __init__(
        self,
        delegate=_reference_fnv1a32,
        *,
        result: object = None,
        error: BaseException | None = None,
    ):
        self.calls: list = []
        self._delegate = delegate
        self._result = result
        self._error = error

    def __call__(self, data: bytes) -> object:
        self.calls.append(data)
        if self._error is not None:
            raise self._error
        if self._result is not None:
            return self._result
        return self._delegate(data)

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1
_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

_REQUEST_ID = 7
_TIMESTAMP_MS = 1000
_WIDTH = 2
_HEIGHT = 2
_STRIDE = 6
_PAYLOAD_BYTES = 12
_PAYLOAD = bytes(range(12))


class _IntSubclass(int):
    pass


class _BytesSubclass(bytes):
    pass


class _ValidatedHelperFrameInputSubclass(ValidatedHelperFrameInput):
    pass


def _checksum_of(data: bytes) -> int:
    return _reference_fnv1a32(data)


def _valid_frame(**overrides) -> ValidatedHelperFrameInput:
    fields = {
        "request_id": _REQUEST_ID,
        "frame_timestamp_ms": _TIMESTAMP_MS,
        "width": _WIDTH,
        "height": _HEIGHT,
        "row_stride_bytes": _STRIDE,
        "payload_bytes": _PAYLOAD_BYTES,
        "bgr24_bytes": _PAYLOAD,
        "checksum": _checksum_of(_PAYLOAD),
    }
    fields.update(overrides)
    return ValidatedHelperFrameInput(**fields)


# =============================================================================
# Valid conversion cases
# =============================================================================


class ValidConversionCasesTest(unittest.TestCase):
    def test_01_exact_output_type(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        self.assertIs(type(result), ValidatedHelperRgb24Frame)

    def test_02_output_is_frozen(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        assert result is not None
        with self.assertRaises(FrozenInstanceError):
            result.rgb24_bytes = b""  # type: ignore[misc]

    def test_03_one_pixel_conversion(self) -> None:
        payload = bytes([10, 20, 30])
        frame = _valid_frame(
            width=1,
            height=1,
            row_stride_bytes=3,
            payload_bytes=3,
            bgr24_bytes=payload,
            checksum=_checksum_of(payload),
        )
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(result.rgb24_bytes, bytes([30, 20, 10]))

    def test_04_multiple_pixel_single_row_conversion(self) -> None:
        payload = bytes([0, 1, 2, 3, 4, 5, 6, 7, 8])
        frame = _valid_frame(
            width=3,
            height=1,
            row_stride_bytes=9,
            payload_bytes=9,
            bgr24_bytes=payload,
            checksum=_checksum_of(payload),
        )
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(
            result.rgb24_bytes, bytes([2, 1, 0, 5, 4, 3, 8, 7, 6])
        )

    def test_05_multiple_row_conversion(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        assert result is not None
        self.assertEqual(
            result.rgb24_bytes,
            bytes([2, 1, 0, 5, 4, 3, 8, 7, 6, 11, 10, 9]),
        )

    def test_06_channel_values_zero_and_255(self) -> None:
        payload = bytes([0, 0, 255, 255, 0, 0])
        frame = _valid_frame(
            width=2,
            height=1,
            row_stride_bytes=6,
            payload_bytes=6,
            bgr24_bytes=payload,
            checksum=_checksum_of(payload),
        )
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(result.rgb24_bytes, bytes([255, 0, 0, 0, 0, 255]))

    def test_07_pixel_and_row_order_unchanged(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        assert result is not None
        # Row 1 (pixels 0-1) precedes row 2 (pixels 2-3); within each pixel,
        # only R/B are swapped.
        self.assertEqual(result.rgb24_bytes[0:6], bytes([2, 1, 0, 5, 4, 3]))
        self.assertEqual(result.rgb24_bytes[6:12], bytes([8, 7, 6, 11, 10, 9]))

    def test_08_exact_metadata_preservation(self) -> None:
        frame = _valid_frame()
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(result.request_id, frame.request_id)
        self.assertEqual(result.frame_timestamp_ms, frame.frame_timestamp_ms)
        self.assertEqual(result.width, frame.width)
        self.assertEqual(result.height, frame.height)
        self.assertEqual(result.row_stride_bytes, frame.row_stride_bytes)
        self.assertEqual(result.payload_bytes, frame.payload_bytes)

    def test_09_exact_source_checksum_preservation(self) -> None:
        frame = _valid_frame()
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(result.source_checksum, frame.checksum)

    def test_10_output_bytes_exact_builtin_type(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        assert result is not None
        self.assertIs(type(result.rgb24_bytes), bytes)

    def test_11_output_length_equals_payload_bytes(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        assert result is not None
        self.assertEqual(len(result.rgb24_bytes), result.payload_bytes)

    def test_12_no_input_mutation(self) -> None:
        frame = _valid_frame()
        before = dataclasses.astuple(frame)
        before_bytes = bytes(frame.bgr24_bytes)

        convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)

        self.assertEqual(dataclasses.astuple(frame), before)
        self.assertEqual(frame.bgr24_bytes, before_bytes)

    def test_13_repeated_calls_do_not_share_state(self) -> None:
        payload_a = bytes(range(12))
        payload_b = bytes(range(12, 24))
        frame_a = _valid_frame(bgr24_bytes=payload_a, checksum=_checksum_of(payload_a))
        frame_b = _valid_frame(bgr24_bytes=payload_b, checksum=_checksum_of(payload_b))

        result_a = convert_validated_helper_frame_input_to_rgb24(frame_a, _reference_fnv1a32)
        result_b = convert_validated_helper_frame_input_to_rgb24(frame_b, _reference_fnv1a32)

        assert result_a is not None
        assert result_b is not None
        self.assertNotEqual(result_a.rgb24_bytes, result_b.rgb24_bytes)
        self.assertEqual(result_a.rgb24_bytes, bytes([2, 1, 0, 5, 4, 3, 8, 7, 6, 11, 10, 9]))


# =============================================================================
# Input type contract
# =============================================================================


class InputTypeContractTest(unittest.TestCase):
    def test_14_none_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(None, _reference_fnv1a32))  # type: ignore[arg-type]

    def test_15_unrelated_object_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(object(), _reference_fnv1a32))  # type: ignore[arg-type]

    def test_16_dict_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24({}, _reference_fnv1a32))  # type: ignore[arg-type]

    def test_17_str_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24("frame", _reference_fnv1a32))  # type: ignore[arg-type]

    def test_18_output_type_itself_returns_none(self) -> None:
        bogus = ValidatedHelperRgb24Frame(
            request_id=_REQUEST_ID,
            frame_timestamp_ms=_TIMESTAMP_MS,
            width=_WIDTH,
            height=_HEIGHT,
            row_stride_bytes=_STRIDE,
            payload_bytes=_PAYLOAD_BYTES,
            rgb24_bytes=_PAYLOAD,
            source_checksum=0,
        )
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(bogus, _reference_fnv1a32))  # type: ignore[arg-type]

    def test_19_input_subclass_returns_none(self) -> None:
        subclass_frame = _ValidatedHelperFrameInputSubclass(
            request_id=_REQUEST_ID,
            frame_timestamp_ms=_TIMESTAMP_MS,
            width=_WIDTH,
            height=_HEIGHT,
            row_stride_bytes=_STRIDE,
            payload_bytes=_PAYLOAD_BYTES,
            bgr24_bytes=_PAYLOAD,
            checksum=_checksum_of(_PAYLOAD),
        )
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(subclass_frame, _reference_fnv1a32))


# =============================================================================
# Manually constructed field inconsistency
# =============================================================================


class ManuallyConstructedInconsistencyTest(unittest.TestCase):
    def test_20_request_id_bool_returns_none(self) -> None:
        frame = _valid_frame(request_id=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_21_request_id_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(request_id=_IntSubclass(_REQUEST_ID))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_22_request_id_zero_returns_none(self) -> None:
        frame = _valid_frame(request_id=0)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_23_request_id_above_max_returns_none(self) -> None:
        frame = _valid_frame(request_id=_INT64_MAX + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_24_request_id_max_accepted(self) -> None:
        frame = _valid_frame(request_id=_INT64_MAX)
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(result.request_id, _INT64_MAX)

    def test_25_timestamp_bool_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_26_timestamp_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_IntSubclass(_TIMESTAMP_MS))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_27_timestamp_below_min_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_INT64_MIN - 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_28_timestamp_above_max_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_INT64_MAX + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_29_timestamp_min_accepted(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_INT64_MIN)
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        assert result is not None
        self.assertEqual(result.frame_timestamp_ms, _INT64_MIN)

    def test_30_width_bool_returns_none(self) -> None:
        frame = _valid_frame(width=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_31_width_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(width=_IntSubclass(_WIDTH))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_32_width_zero_returns_none(self) -> None:
        frame = _valid_frame(width=0, row_stride_bytes=0, payload_bytes=0, bgr24_bytes=b"")
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_33_width_above_max_returns_none(self) -> None:
        frame = _valid_frame(width=7681)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_34_width_max_accepted_alone_with_matching_stride(self) -> None:
        payload = bytes(7680 * 3)
        frame = _valid_frame(
            width=7680,
            height=1,
            row_stride_bytes=7680 * 3,
            payload_bytes=7680 * 3,
            bgr24_bytes=payload,
            checksum=_checksum_of(payload),
        )
        result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        self.assertIsNotNone(result)

    def test_35_height_bool_returns_none(self) -> None:
        frame = _valid_frame(height=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_36_height_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(height=_IntSubclass(_HEIGHT))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_37_height_zero_returns_none(self) -> None:
        frame = _valid_frame(height=0, payload_bytes=0, bgr24_bytes=b"")
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_38_height_above_max_returns_none(self) -> None:
        frame = _valid_frame(height=4321)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_39_row_stride_bool_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_40_row_stride_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=_IntSubclass(_STRIDE))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_41_row_stride_below_expected_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=_STRIDE - 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_42_row_stride_above_expected_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=_STRIDE + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_43_payload_bytes_bool_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_44_payload_bytes_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=_IntSubclass(_PAYLOAD_BYTES))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_45_payload_bytes_below_expected_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=_PAYLOAD_BYTES - 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_46_payload_bytes_above_expected_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=_PAYLOAD_BYTES + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_47_payload_bytes_cap_enforced_without_oversized_allocation(self) -> None:
        # The cap check runs before the exact bgr24_bytes length check, so a
        # tiny dummy payload proves rejection without allocating 32+ MiB.
        frame = _valid_frame(
            width=7680,
            height=1457,
            row_stride_bytes=23040,
            payload_bytes=23040 * 1457,
            bgr24_bytes=b"",
        )
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_48_bgr24_bytes_bytearray_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=bytearray(_PAYLOAD))  # type: ignore[arg-type]
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_49_bgr24_bytes_memoryview_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=memoryview(_PAYLOAD))  # type: ignore[arg-type]
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_50_bgr24_bytes_subclass_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=_BytesSubclass(_PAYLOAD))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_51_truncated_payload_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=_PAYLOAD[:-1])
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_52_overlong_payload_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=_PAYLOAD + b"\x00")
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_53_checksum_bool_returns_none(self) -> None:
        frame = _valid_frame(checksum=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_54_checksum_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(checksum=_IntSubclass(_checksum_of(_PAYLOAD)))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_55_checksum_negative_returns_none(self) -> None:
        frame = _valid_frame(checksum=-1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_56_checksum_above_uint32_max_returns_none(self) -> None:
        frame = _valid_frame(checksum=_UINT32_MAX + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_57_checksum_uint32_max_type_valid_but_mismatched_returns_none(self) -> None:
        frame = _valid_frame(checksum=_UINT32_MAX)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))

    def test_58_checksum_mismatch_returns_none(self) -> None:
        frame = _valid_frame(checksum=_checksum_of(_PAYLOAD) ^ 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32))


# =============================================================================
# Validation-before-conversion ordering
# =============================================================================


class ValidationBeforeConversionTest(unittest.TestCase):
    def test_59_checksum_mismatch_rejected_before_conversion(self) -> None:
        frame = _valid_frame(checksum=_checksum_of(_PAYLOAD) ^ 1)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_60_stride_mismatch_rejected_before_conversion(self) -> None:
        frame = _valid_frame(row_stride_bytes=_STRIDE + 1)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_61_length_mismatch_rejected_before_conversion(self) -> None:
        frame = _valid_frame(bgr24_bytes=_PAYLOAD[:-1])
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(frame, _reference_fnv1a32)
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_62_type_rejection_before_conversion(self) -> None:
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(None, _reference_fnv1a32)  # type: ignore[arg-type]
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_63_checksum_recomputed_before_conversion(self) -> None:
        frame = _valid_frame(checksum=_checksum_of(_PAYLOAD) ^ 1)
        checksum = _CountingChecksum()
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            convert_validated_helper_frame_input_to_rgb24(frame, checksum)
        self.assertEqual(len(checksum.calls), 1)
        mocked_convert.assert_not_called()


# =============================================================================
# No I/O / exception policy
# =============================================================================


class NoIoExceptionPolicyTest(unittest.TestCase):
    def test_64_valid_conversion_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            convert_validated_helper_frame_input_to_rgb24(_valid_frame(), _reference_fnv1a32)
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_65_invalid_conversion_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            convert_validated_helper_frame_input_to_rgb24(None, _reference_fnv1a32)  # type: ignore[arg-type]
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_66_base_exception_from_checksum_helper_not_swallowed(self) -> None:
        checksum = _CountingChecksum(error=KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            convert_validated_helper_frame_input_to_rgb24(_valid_frame(), checksum)


# =============================================================================
# P2-C: explicit, required, independent checksum dependency
# =============================================================================


class ExplicitChecksumDependencyTest(unittest.TestCase):
    def test_checksum_is_a_required_parameter(self) -> None:
        with self.assertRaises(TypeError):
            convert_validated_helper_frame_input_to_rgb24(_valid_frame())  # type: ignore[call-arg]

    def test_non_callable_checksum_returns_none(self) -> None:
        for value in (None, 0, b"", "fnv", object()):
            with self.subTest(value=type(value).__name__):
                with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
                    result = convert_validated_helper_frame_input_to_rgb24(
                        _valid_frame(), value  # type: ignore[arg-type]
                    )
                self.assertIsNone(result)
                mocked_convert.assert_not_called()

    def test_recomputed_from_the_actual_bgr24_bytes_exactly_once(self) -> None:
        frame = _valid_frame()
        checksum = _CountingChecksum()
        result = convert_validated_helper_frame_input_to_rgb24(frame, checksum)
        assert result is not None
        self.assertEqual(len(checksum.calls), 1)
        self.assertIs(checksum.calls[0], frame.bgr24_bytes)
        self.assertEqual(result.source_checksum, frame.checksum)

    def test_stored_checksum_is_never_trusted_in_place_of_recomputation(self) -> None:
        # The stored value is correct, but the (independent) recomputation
        # disagrees: conversion must be refused.
        checksum = _CountingChecksum(result=_checksum_of(_PAYLOAD) ^ 0x80000000)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(_valid_frame(), checksum)
        self.assertIsNone(result)
        self.assertEqual(len(checksum.calls), 1)
        mocked_convert.assert_not_called()

    def test_non_int_recomputation_rejected_before_conversion(self) -> None:
        stored = _checksum_of(_PAYLOAD)
        for value in (True, float(stored), str(stored), _IntSubclass(stored)):
            with self.subTest(value=type(value).__name__):
                checksum = _CountingChecksum(result=value)
                with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
                    result = convert_validated_helper_frame_input_to_rgb24(
                        _valid_frame(), checksum
                    )
                self.assertIsNone(result)
                mocked_convert.assert_not_called()

    def test_checksum_exception_propagates_before_conversion(self) -> None:
        error = RuntimeError("synthetic native checksum failure")
        checksum = _CountingChecksum(error=error)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            with self.assertRaises(RuntimeError) as raised:
                convert_validated_helper_frame_input_to_rgb24(_valid_frame(), checksum)
        self.assertIs(raised.exception, error)
        mocked_convert.assert_not_called()

    def test_every_structural_rejection_happens_before_checksum(self) -> None:
        cases = [
            None,
            _valid_frame(request_id=0),
            _valid_frame(width=0),
            _valid_frame(height=0),
            _valid_frame(row_stride_bytes=_STRIDE + 1),
            _valid_frame(payload_bytes=_PAYLOAD_BYTES + 1),
            _valid_frame(bgr24_bytes=bytearray(_PAYLOAD)),
            _valid_frame(bgr24_bytes=_PAYLOAD[:-1]),
            _valid_frame(checksum=-1),
            _valid_frame(checksum=_UINT32_MAX + 1),
            _valid_frame(checksum=float(_checksum_of(_PAYLOAD))),
        ]
        for index, frame in enumerate(cases):
            with self.subTest(case=index):
                checksum = _CountingChecksum()
                self.assertIsNone(
                    convert_validated_helper_frame_input_to_rgb24(frame, checksum)  # type: ignore[arg-type]
                )
                self.assertEqual(checksum.calls, [])

    def test_production_module_has_no_checksum_implementation(self) -> None:
        self.assertFalse(hasattr(helper_frame_rgb, "_fnv1a32"))
        self.assertFalse(hasattr(helper_frame_rgb, "_FNV_OFFSET_BASIS"))
        self.assertFalse(hasattr(helper_frame_rgb, "_FNV_PRIME"))
        source = inspect.getsource(helper_frame_rgb)
        for forbidden in ("ctypes", "import os", "open(", "helper_native_fnv", "16777619"):
            self.assertNotIn(forbidden, source)


# =============================================================================
# P2-C: actual compiled native library through BOTH validation stages
# =============================================================================


def _bgr24_frame(width: int, height: int, seed: bytes) -> bytes:
    """Deterministic synthetic BGR24 payload that includes NUL bytes."""
    size = width * height * 3
    pattern = bytes((index * 37 + seed[index % len(seed)]) & 0xFF for index in range(251))
    repeats, remainder = divmod(size, len(pattern))
    return pattern * repeats + pattern[:remainder]


def _assemble(payload: bytes, width: int, height: int, checksum, request_id: int = 1):
    request = HelperFrameRequest(request_id=request_id, frame_timestamp_ms=1000)
    header = HelperFramePacketHeader(
        sequence=request_id,
        frame_timestamp_ms=1000,
        width=width,
        height=height,
        row_stride_bytes=width * 3,
        payload_bytes=width * height * 3,
    )
    return assemble_validated_helper_frame_input(request, header, payload, checksum)


@unittest.skipIf(
    _NATIVE_LIBRARY_PATH is None and "--native-library" not in sys.argv,
    "requires --native-library <absolute path> (always supplied by Native CI)",
)
class NativeLibraryIntegrationTest(unittest.TestCase):
    """Uses the real loader and the real compiled library: no fake checksum.

    `_CountingChecksum(native)` only counts invocations; every value is
    computed by the native library itself.
    """

    @classmethod
    def setUpClass(cls) -> None:
        if _NATIVE_LIBRARY_PATH is None:
            raise RuntimeError("--native-library <absolute path> is required")
        cls.native = load_native_fnv1a32(_NATIVE_LIBRARY_PATH)

    def test_both_stages_execute_independently_for_every_accepted_frame(self) -> None:
        counting = _CountingChecksum(self.native)
        for request_id, (width, height) in enumerate(((2, 2), (64, 48), (640, 480)), start=1):
            with self.subTest(size=f"{width}x{height}"):
                counting.calls.clear()
                payload = _bgr24_frame(width, height, b"p2c-stage")
                frame = _assemble(payload, width, height, counting, request_id)
                assert frame is not None
                rgb = convert_validated_helper_frame_input_to_rgb24(frame, counting)
                assert rgb is not None
                # Exactly two independent native invocations, each over the
                # actual BGR24 bytes object, agreeing with the oracle.
                self.assertEqual(len(counting.calls), 2)
                self.assertIs(counting.calls[0], payload)
                self.assertIs(counting.calls[1], frame.bgr24_bytes)
                if width <= 64:
                    self.assertEqual(frame.checksum, _reference_fnv1a32(payload))
                self.assertEqual(rgb.source_checksum, frame.checksum)
                self.assertEqual(rgb.rgb24_bytes[0::3], payload[2::3])
                self.assertEqual(rgb.rgb24_bytes[2::3], payload[0::3])

    def test_embedded_nul_payloads_preserve_exact_fnv_semantics(self) -> None:
        for label, payload in (
            ("all-nul", b"\x00" * 12),
            ("leading-nul", b"\x00" + bytes(range(1, 12))),
            ("interior-nul", b"foo\x00bar\x00\x00\xff\x01\x02"),
            ("trailing-nul", bytes(range(1, 12)) + b"\x00"),
        ):
            with self.subTest(vector=label):
                frame = _assemble(payload, 2, 2, self.native)
                assert frame is not None
                self.assertEqual(frame.checksum, _reference_fnv1a32(payload))
                # NUL bytes are hashed, never treated as terminators.
                self.assertNotEqual(
                    frame.checksum, _reference_fnv1a32(payload.replace(b"\x00", b""))
                )
                rgb = convert_validated_helper_frame_input_to_rgb24(frame, self.native)
                assert rgb is not None

    def test_maximum_length_payload_through_both_stages(self) -> None:
        # 7680x1456x3 = 33,546,240 bytes: the largest accepted frame (<= 32 MiB).
        width, height = 7680, 1456
        payload = _bgr24_frame(width, height, b"p2c-max")
        counting = _CountingChecksum(self.native)
        frame = _assemble(payload, width, height, counting)
        assert frame is not None
        rgb = convert_validated_helper_frame_input_to_rgb24(frame, counting)
        assert rgb is not None
        self.assertEqual(len(counting.calls), 2)
        self.assertEqual(self.native(payload), frame.checksum)
        self.assertEqual(rgb.payload_bytes, 33546240)

    def test_checksum_mismatch_rejected_before_rgb_conversion(self) -> None:
        payload = _bgr24_frame(64, 48, b"p2c-mismatch")
        frame = _assemble(payload, 64, 48, self.native)
        assert frame is not None
        tampered = dataclasses.replace(frame, checksum=frame.checksum ^ 1)
        counting = _CountingChecksum(self.native)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(tampered, counting))
        self.assertEqual(len(counting.calls), 1)
        mocked_convert.assert_not_called()

    def test_tampered_bytes_rejected_before_rgb_conversion(self) -> None:
        payload = _bgr24_frame(64, 48, b"p2c-bytes")
        frame = _assemble(payload, 64, 48, self.native)
        assert frame is not None
        flipped = bytearray(payload)
        flipped[len(flipped) // 2] ^= 0x01
        tampered = dataclasses.replace(frame, bgr24_bytes=bytes(flipped))
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(tampered, self.native))
        mocked_convert.assert_not_called()

    def test_structural_rejection_never_invokes_native(self) -> None:
        counting = _CountingChecksum(self.native)
        payload = _bgr24_frame(2, 2, b"p2c-reject")
        self.assertIsNone(_assemble(payload[:-1], 2, 2, counting))
        self.assertIsNone(_assemble(payload + b"\x00", 2, 2, counting))
        frame = _assemble(payload, 2, 2, self.native)
        assert frame is not None
        self.assertIsNone(
            convert_validated_helper_frame_input_to_rgb24(
                dataclasses.replace(frame, row_stride_bytes=7), counting
            )
        )
        self.assertEqual(counting.calls, [])


# =============================================================================
# P2-C: bounded integrated preprocessing benchmark (synthetic only)
# =============================================================================


def _percentile(sorted_values, percent):
    rank = max(1, math.ceil(percent / 100.0 * len(sorted_values)))
    return sorted_values[rank - 1]


def _measure(operation, samples, warmup):
    for _ in range(warmup):
        operation()
    timings = []
    for _ in range(samples):
        start = time.perf_counter_ns()
        operation()
        timings.append((time.perf_counter_ns() - start) / 1e6)
    timings.sort()
    return {
        "samples": samples,
        "warmup": warmup,
        "p50_ms": round(_percentile(timings, 50), 4),
        "p95_ms": round(_percentile(timings, 95), 4),
        "p99_ms": round(_percentile(timings, 99), 4),
        "max_ms": round(timings[-1], 4),
    }


def _run_benchmark(library_path, samples, warmup, build_config, enforce):
    native = load_native_fnv1a32(library_path)
    width, height = 640, 480
    payload = _bgr24_frame(width, height, b"p2c-benchmark")
    if native(payload) != _reference_fnv1a32(payload):
        raise AssertionError("benchmark payload parity failure")
    frame = _assemble(payload, width, height, native)
    if frame is None or convert_validated_helper_frame_input_to_rgb24(frame, native) is None:
        raise AssertionError("benchmark frame rejected")

    def checksum_single():
        native(payload)

    def checksum_two():
        native(payload)
        native(payload)

    def assemble_stage():
        _assemble(payload, width, height, native)

    def rgb_stage():
        convert_validated_helper_frame_input_to_rgb24(frame, native)

    def assemble_and_rgb():
        assembled = _assemble(payload, width, height, native)
        convert_validated_helper_frame_input_to_rgb24(assembled, native)

    report = {
        "environment": {
            "python": sys.version.split()[0],
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "build_config": build_config,
            "library": os.path.basename(library_path),
            "payload": "synthetic 640x480 BGR24 (no camera, no MediaPipe)",
        },
        "results_640x480": {
            "checksum_single": _measure(checksum_single, samples, warmup),
            "checksum_two_independent": _measure(checksum_two, samples, warmup),
            "frame_assembly_stage": _measure(assemble_stage, samples, warmup),
            "rgb_validation_and_conversion_stage": _measure(rgb_stage, samples, warmup),
            "assembly_plus_rgb_total": _measure(assemble_and_rgb, samples, warmup),
        },
    }
    results = report["results_640x480"]
    acceptance = {
        "checksum_single_p95_le_3ms": results["checksum_single"]["p95_ms"] <= 3.0,
        "checksum_two_p95_le_6ms": results["checksum_two_independent"]["p95_ms"] <= 6.0,
    }
    report["acceptance_640x480"] = acceptance
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    if enforce and not all(acceptance.values()):
        return 1
    return 0


def main(argv):
    global _NATIVE_LIBRARY_PATH
    remaining = [argv[0]]
    benchmark = False
    enforce = False
    samples = 500
    warmup = 50
    build_config = "unspecified"
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument in ("--native-library", "--samples", "--warmup", "--build-config"):
            if index + 1 >= len(argv):
                sys.stderr.write(f"{argument} requires a value\n")
                return 2
            value = argv[index + 1]
            if argument == "--native-library":
                _NATIVE_LIBRARY_PATH = value
            elif argument == "--samples":
                samples = int(value)
            elif argument == "--warmup":
                warmup = int(value)
            else:
                build_config = value
            index += 2
            continue
        if argument == "--benchmark":
            benchmark = True
        elif argument == "--enforce-acceptance":
            enforce = True
        else:
            remaining.append(argument)
        index += 1
    if benchmark:
        if _NATIVE_LIBRARY_PATH is None:
            sys.stderr.write("error: --benchmark requires --native-library <absolute path>\n")
            return 2
        return _run_benchmark(_NATIVE_LIBRARY_PATH, samples, warmup, build_config, enforce)
    program = unittest.main(module=__name__, argv=remaining, exit=False)
    return 0 if program.result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
