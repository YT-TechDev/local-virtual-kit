"""Standard-library tests for helper_frame_rgb.py.

Run directly: python -B test_helper_frame_rgb.py
"""

from __future__ import annotations

import contextlib
import dataclasses
import io
import unittest
from dataclasses import FrozenInstanceError
from unittest import mock

import helper_frame_rgb
from helper_frame_input import ValidatedHelperFrameInput
from helper_frame_rgb import (
    ValidatedHelperRgb24Frame,
    convert_validated_helper_frame_input_to_rgb24,
)

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
    return helper_frame_rgb._fnv1a32(data)


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
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame())
        self.assertIs(type(result), ValidatedHelperRgb24Frame)

    def test_02_output_is_frozen(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame())
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
        result = convert_validated_helper_frame_input_to_rgb24(frame)
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
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        assert result is not None
        self.assertEqual(
            result.rgb24_bytes, bytes([2, 1, 0, 5, 4, 3, 8, 7, 6])
        )

    def test_05_multiple_row_conversion(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame())
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
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        assert result is not None
        self.assertEqual(result.rgb24_bytes, bytes([255, 0, 0, 0, 0, 255]))

    def test_07_pixel_and_row_order_unchanged(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame())
        assert result is not None
        # Row 1 (pixels 0-1) precedes row 2 (pixels 2-3); within each pixel,
        # only R/B are swapped.
        self.assertEqual(result.rgb24_bytes[0:6], bytes([2, 1, 0, 5, 4, 3]))
        self.assertEqual(result.rgb24_bytes[6:12], bytes([8, 7, 6, 11, 10, 9]))

    def test_08_exact_metadata_preservation(self) -> None:
        frame = _valid_frame()
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        assert result is not None
        self.assertEqual(result.request_id, frame.request_id)
        self.assertEqual(result.frame_timestamp_ms, frame.frame_timestamp_ms)
        self.assertEqual(result.width, frame.width)
        self.assertEqual(result.height, frame.height)
        self.assertEqual(result.row_stride_bytes, frame.row_stride_bytes)
        self.assertEqual(result.payload_bytes, frame.payload_bytes)

    def test_09_exact_source_checksum_preservation(self) -> None:
        frame = _valid_frame()
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        assert result is not None
        self.assertEqual(result.source_checksum, frame.checksum)

    def test_10_output_bytes_exact_builtin_type(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame())
        assert result is not None
        self.assertIs(type(result.rgb24_bytes), bytes)

    def test_11_output_length_equals_payload_bytes(self) -> None:
        result = convert_validated_helper_frame_input_to_rgb24(_valid_frame())
        assert result is not None
        self.assertEqual(len(result.rgb24_bytes), result.payload_bytes)

    def test_12_no_input_mutation(self) -> None:
        frame = _valid_frame()
        before = dataclasses.astuple(frame)
        before_bytes = bytes(frame.bgr24_bytes)

        convert_validated_helper_frame_input_to_rgb24(frame)

        self.assertEqual(dataclasses.astuple(frame), before)
        self.assertEqual(frame.bgr24_bytes, before_bytes)

    def test_13_repeated_calls_do_not_share_state(self) -> None:
        payload_a = bytes(range(12))
        payload_b = bytes(range(12, 24))
        frame_a = _valid_frame(bgr24_bytes=payload_a, checksum=_checksum_of(payload_a))
        frame_b = _valid_frame(bgr24_bytes=payload_b, checksum=_checksum_of(payload_b))

        result_a = convert_validated_helper_frame_input_to_rgb24(frame_a)
        result_b = convert_validated_helper_frame_input_to_rgb24(frame_b)

        assert result_a is not None
        assert result_b is not None
        self.assertNotEqual(result_a.rgb24_bytes, result_b.rgb24_bytes)
        self.assertEqual(result_a.rgb24_bytes, bytes([2, 1, 0, 5, 4, 3, 8, 7, 6, 11, 10, 9]))


# =============================================================================
# Input type contract
# =============================================================================


class InputTypeContractTest(unittest.TestCase):
    def test_14_none_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(None))  # type: ignore[arg-type]

    def test_15_unrelated_object_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(object()))  # type: ignore[arg-type]

    def test_16_dict_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24({}))  # type: ignore[arg-type]

    def test_17_str_returns_none(self) -> None:
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24("frame"))  # type: ignore[arg-type]

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
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(bogus))  # type: ignore[arg-type]

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
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(subclass_frame))


# =============================================================================
# Manually constructed field inconsistency
# =============================================================================


class ManuallyConstructedInconsistencyTest(unittest.TestCase):
    def test_20_request_id_bool_returns_none(self) -> None:
        frame = _valid_frame(request_id=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_21_request_id_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(request_id=_IntSubclass(_REQUEST_ID))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_22_request_id_zero_returns_none(self) -> None:
        frame = _valid_frame(request_id=0)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_23_request_id_above_max_returns_none(self) -> None:
        frame = _valid_frame(request_id=_INT64_MAX + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_24_request_id_max_accepted(self) -> None:
        frame = _valid_frame(request_id=_INT64_MAX)
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        assert result is not None
        self.assertEqual(result.request_id, _INT64_MAX)

    def test_25_timestamp_bool_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_26_timestamp_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_IntSubclass(_TIMESTAMP_MS))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_27_timestamp_below_min_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_INT64_MIN - 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_28_timestamp_above_max_returns_none(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_INT64_MAX + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_29_timestamp_min_accepted(self) -> None:
        frame = _valid_frame(frame_timestamp_ms=_INT64_MIN)
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        assert result is not None
        self.assertEqual(result.frame_timestamp_ms, _INT64_MIN)

    def test_30_width_bool_returns_none(self) -> None:
        frame = _valid_frame(width=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_31_width_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(width=_IntSubclass(_WIDTH))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_32_width_zero_returns_none(self) -> None:
        frame = _valid_frame(width=0, row_stride_bytes=0, payload_bytes=0, bgr24_bytes=b"")
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_33_width_above_max_returns_none(self) -> None:
        frame = _valid_frame(width=7681)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

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
        result = convert_validated_helper_frame_input_to_rgb24(frame)
        self.assertIsNotNone(result)

    def test_35_height_bool_returns_none(self) -> None:
        frame = _valid_frame(height=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_36_height_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(height=_IntSubclass(_HEIGHT))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_37_height_zero_returns_none(self) -> None:
        frame = _valid_frame(height=0, payload_bytes=0, bgr24_bytes=b"")
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_38_height_above_max_returns_none(self) -> None:
        frame = _valid_frame(height=4321)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_39_row_stride_bool_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_40_row_stride_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=_IntSubclass(_STRIDE))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_41_row_stride_below_expected_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=_STRIDE - 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_42_row_stride_above_expected_returns_none(self) -> None:
        frame = _valid_frame(row_stride_bytes=_STRIDE + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_43_payload_bytes_bool_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_44_payload_bytes_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=_IntSubclass(_PAYLOAD_BYTES))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_45_payload_bytes_below_expected_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=_PAYLOAD_BYTES - 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_46_payload_bytes_above_expected_returns_none(self) -> None:
        frame = _valid_frame(payload_bytes=_PAYLOAD_BYTES + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

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
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_48_bgr24_bytes_bytearray_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=bytearray(_PAYLOAD))  # type: ignore[arg-type]
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_49_bgr24_bytes_memoryview_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=memoryview(_PAYLOAD))  # type: ignore[arg-type]
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_50_bgr24_bytes_subclass_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=_BytesSubclass(_PAYLOAD))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_51_truncated_payload_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=_PAYLOAD[:-1])
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_52_overlong_payload_returns_none(self) -> None:
        frame = _valid_frame(bgr24_bytes=_PAYLOAD + b"\x00")
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_53_checksum_bool_returns_none(self) -> None:
        frame = _valid_frame(checksum=True)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_54_checksum_int_subclass_returns_none(self) -> None:
        frame = _valid_frame(checksum=_IntSubclass(_checksum_of(_PAYLOAD)))
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_55_checksum_negative_returns_none(self) -> None:
        frame = _valid_frame(checksum=-1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_56_checksum_above_uint32_max_returns_none(self) -> None:
        frame = _valid_frame(checksum=_UINT32_MAX + 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_57_checksum_uint32_max_type_valid_but_mismatched_returns_none(self) -> None:
        frame = _valid_frame(checksum=_UINT32_MAX)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))

    def test_58_checksum_mismatch_returns_none(self) -> None:
        frame = _valid_frame(checksum=_checksum_of(_PAYLOAD) ^ 1)
        self.assertIsNone(convert_validated_helper_frame_input_to_rgb24(frame))


# =============================================================================
# Validation-before-conversion ordering
# =============================================================================


class ValidationBeforeConversionTest(unittest.TestCase):
    def test_59_checksum_mismatch_rejected_before_conversion(self) -> None:
        frame = _valid_frame(checksum=_checksum_of(_PAYLOAD) ^ 1)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(frame)
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_60_stride_mismatch_rejected_before_conversion(self) -> None:
        frame = _valid_frame(row_stride_bytes=_STRIDE + 1)
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(frame)
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_61_length_mismatch_rejected_before_conversion(self) -> None:
        frame = _valid_frame(bgr24_bytes=_PAYLOAD[:-1])
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(frame)
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_62_type_rejection_before_conversion(self) -> None:
        with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
            result = convert_validated_helper_frame_input_to_rgb24(None)  # type: ignore[arg-type]
        self.assertIsNone(result)
        mocked_convert.assert_not_called()

    def test_63_checksum_recomputed_before_conversion(self) -> None:
        frame = _valid_frame(checksum=_checksum_of(_PAYLOAD) ^ 1)
        with mock.patch("helper_frame_rgb._fnv1a32", wraps=helper_frame_rgb._fnv1a32) as mocked_fnv:
            with mock.patch("helper_frame_rgb._bgr24_to_rgb24") as mocked_convert:
                convert_validated_helper_frame_input_to_rgb24(frame)
        mocked_fnv.assert_called_once()
        mocked_convert.assert_not_called()


# =============================================================================
# No I/O / exception policy
# =============================================================================


class NoIoExceptionPolicyTest(unittest.TestCase):
    def test_64_valid_conversion_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            convert_validated_helper_frame_input_to_rgb24(_valid_frame())
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_65_invalid_conversion_emits_no_output(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            convert_validated_helper_frame_input_to_rgb24(None)  # type: ignore[arg-type]
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")

    def test_66_base_exception_from_checksum_helper_not_swallowed(self) -> None:
        with mock.patch("helper_frame_rgb._fnv1a32", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                convert_validated_helper_frame_input_to_rgb24(_valid_frame())


if __name__ == "__main__":
    unittest.main()
