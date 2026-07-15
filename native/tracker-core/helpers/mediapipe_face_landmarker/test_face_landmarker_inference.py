"""Standard-library fake-based tests for face_landmarker_inference.py.

Run directly: python -B test_face_landmarker_inference.py

These tests use strict fakes only. They do not import or install real
NumPy or MediaPipe and claim only fake-based call-shape, ordering, and
bounded-failure evidence: no real array compatibility, image compatibility,
model loading, detection quality, or real timing/performance is proven
here.
"""

from __future__ import annotations

import contextlib
import dataclasses
import io
import math
import sys
import types
import unittest
from unittest import mock

import face_landmarker_inference
from face_landmarker_inference import (
    FaceLandmarkerInferenceApi,
    FaceLandmarkerInferenceOutcome,
    FaceLandmarkerInferenceStatus,
    run_face_landmarker_single_frame_inference,
)
from face_landmarker_runtime import (
    FaceLandmarkerRuntimeLifecycle,
    create_face_landmarker_runtime,
)
from helper_frame_rgb import ValidatedHelperRgb24Frame

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1

_MODEL_ASSET_PATH = "models/face_landmarker.task"
_UINT8_SENTINEL = object()
_SRGB_SENTINEL = object()

_REQUEST_ID = 7
_TIMESTAMP_MS = 1000
_WIDTH = 2
_HEIGHT = 2
_STRIDE = 6
_PAYLOAD_BYTES = 12
_RGB_PAYLOAD = bytes(range(12))
_SOURCE_CHECKSUM = 123456


# =============================================================================
# Frame / API fakes
# =============================================================================


def _valid_frame(**overrides: object) -> ValidatedHelperRgb24Frame:
    fields = {
        "request_id": _REQUEST_ID,
        "frame_timestamp_ms": _TIMESTAMP_MS,
        "width": _WIDTH,
        "height": _HEIGHT,
        "row_stride_bytes": _STRIDE,
        "payload_bytes": _PAYLOAD_BYTES,
        "rgb24_bytes": _RGB_PAYLOAD,
        "source_checksum": _SOURCE_CHECKSUM,
    }
    fields.update(overrides)
    return ValidatedHelperRgb24Frame(**fields)


class _FakeArray:
    def __init__(self, shape: object, dtype: object, c_contiguous: bool = True) -> None:
        self.shape = shape
        self.dtype = dtype
        self.flags = types.SimpleNamespace(c_contiguous=c_contiguous)


class _RaisingMetadataArray:
    def __init__(self, error: Exception) -> None:
        self._error = error

    @property
    def shape(self) -> object:
        raise self._error

    @property
    def dtype(self) -> object:
        raise self._error

    @property
    def flags(self) -> object:
        raise self._error


class _FloatSubclass(float):
    pass


class _ApiCalls:
    def __init__(self) -> None:
        self.frombuffer_calls: list = []
        self.reshape_calls: list = []
        self.ascontiguousarray_calls: list = []
        self.image_constructor_calls: list = []
        self.produced_contiguous_arrays: list = []


def _make_api(
    *,
    calls: _ApiCalls | None = None,
    api_type: type = FaceLandmarkerInferenceApi,
    frombuffer: object = None,
    numpy_uint8: object = _UINT8_SENTINEL,
    ascontiguousarray: object = None,
    image_constructor: object = None,
    srgb_image_format: object = _SRGB_SENTINEL,
    frombuffer_error: Exception | None = None,
    reshape_missing: bool = False,
    reshape_non_callable: bool = False,
    reshape_error: Exception | None = None,
    ascontiguousarray_error: Exception | None = None,
    final_shape: object = None,
    final_dtype: object = None,
    final_c_contiguous: bool = True,
    metadata_access_error: Exception | None = None,
    image_constructor_error: Exception | None = None,
    image_constructor_returns_none: bool = False,
):
    if calls is None:
        calls = _ApiCalls()

    def default_frombuffer(data: object, dtype: object) -> object:
        calls.frombuffer_calls.append((data, dtype))
        if frombuffer_error is not None:
            raise frombuffer_error
        flat = types.SimpleNamespace()
        if reshape_missing:
            pass
        elif reshape_non_callable:
            flat.reshape = "not callable"
        else:

            def _reshape(shape: object) -> object:
                calls.reshape_calls.append(shape)
                if reshape_error is not None:
                    raise reshape_error
                return _FakeArray(shape, dtype, True)

            flat.reshape = _reshape
        return flat

    def default_ascontiguousarray(array: object, dtype: object) -> object:
        calls.ascontiguousarray_calls.append((array, dtype))
        if ascontiguousarray_error is not None:
            raise ascontiguousarray_error
        if metadata_access_error is not None:
            produced = _RaisingMetadataArray(metadata_access_error)
        else:
            shape = final_shape if final_shape is not None else array.shape
            dtype_val = final_dtype if final_dtype is not None else dtype
            produced = _FakeArray(shape, dtype_val, final_c_contiguous)
        calls.produced_contiguous_arrays.append(produced)
        return produced

    def default_image_constructor(*, image_format: object, data: object) -> object:
        calls.image_constructor_calls.append((image_format, data))
        if image_constructor_error is not None:
            raise image_constructor_error
        if image_constructor_returns_none:
            return None
        return object()

    api = api_type(
        numpy_frombuffer=frombuffer if frombuffer is not None else default_frombuffer,
        numpy_uint8=numpy_uint8,
        numpy_ascontiguousarray=(
            ascontiguousarray if ascontiguousarray is not None else default_ascontiguousarray
        ),
        image_constructor=(
            image_constructor if image_constructor is not None else default_image_constructor
        ),
        srgb_image_format=srgb_image_format,
    )
    return api, calls


def _make_detect(*, result: object = None, error: Exception | None = None):
    calls: list = []

    def detect(image: object) -> object:
        calls.append(image)
        if error is not None:
            raise error
        return result

    detect.calls = calls
    return detect


def _sequence_clock(*values: object):
    remaining = list(values)
    calls: list = []

    def clock() -> float:
        calls.append(True)
        if not remaining:
            raise AssertionError("clock called more times than provided values")
        value = remaining.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value

    clock.calls = calls
    return clock


# =============================================================================
# Runtime / lifecycle fakes
# =============================================================================

_UNSET = object()


class _FakeRuntime:
    def __init__(self, *, detect: object = _UNSET, close_error: Exception | None = None) -> None:
        self.close_calls = 0
        self._close_error = close_error
        if detect is not _UNSET:
            self.detect = detect

    def close(self) -> None:
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error


class _RaisingDetectRuntime:
    def __init__(self, error: Exception) -> None:
        self.close_calls = 0
        self._error = error

    @property
    def detect(self) -> object:
        raise self._error

    def close(self) -> None:
        self.close_calls += 1


def _default_detect(image: object) -> object:
    return object()


def _make_ready_lifecycle(runtime: object = None) -> FaceLandmarkerRuntimeLifecycle:
    if runtime is None:
        runtime = _FakeRuntime(detect=_default_detect)

    def create_from_options(options: object) -> object:
        return runtime

    face_landmarker_type = types.SimpleNamespace(create_from_options=create_from_options)
    vision = types.SimpleNamespace(
        FaceLandmarkerOptions=lambda **kwargs: types.SimpleNamespace(kwargs=kwargs),
        RunningMode=types.SimpleNamespace(IMAGE=object()),
        FaceLandmarker=face_landmarker_type,
    )
    tasks = types.SimpleNamespace(
        BaseOptions=lambda **kwargs: types.SimpleNamespace(kwargs=kwargs),
        vision=vision,
    )
    module = types.SimpleNamespace(tasks=tasks)

    def importer(name: str) -> object:
        return module

    return create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)


def _make_closed_lifecycle(runtime: object = None) -> FaceLandmarkerRuntimeLifecycle:
    lifecycle = _make_ready_lifecycle(runtime)
    lifecycle.close()
    return lifecycle


def _make_failed_lifecycle() -> FaceLandmarkerRuntimeLifecycle:
    return create_face_landmarker_runtime("", module_importer=lambda name: None)


# =============================================================================
# Output shape
# =============================================================================


class OutputShapeTest(unittest.TestCase):
    def test_01_exact_outcome_type(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(type(result), FaceLandmarkerInferenceOutcome)

    def test_02_outcome_is_frozen(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.status = FaceLandmarkerInferenceStatus.DETECTION_FAILED  # type: ignore[misc]

    def test_03_exact_closed_status_enum(self) -> None:
        self.assertEqual(
            {member.value for member in FaceLandmarkerInferenceStatus},
            {
                "success",
                "runtime_unavailable",
                "image_adaptation_failed",
                "detection_failed",
            },
        )

    def test_04_exact_metadata_preservation_on_success(self) -> None:
        frame = _valid_frame()
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            frame, lifecycle, api, monotonic_clock=clock
        )
        self.assertEqual(result.request_id, frame.request_id)
        self.assertEqual(result.frame_timestamp_ms, frame.frame_timestamp_ms)
        self.assertEqual(result.payload_bytes, frame.payload_bytes)
        self.assertEqual(result.source_checksum, frame.source_checksum)

    def test_05_exact_metadata_preservation_on_failure(self) -> None:
        frame = _valid_frame()
        lifecycle = _make_closed_lifecycle()
        api, _ = _make_api()
        result = run_face_landmarker_single_frame_inference(frame, lifecycle, api)
        self.assertEqual(result.request_id, frame.request_id)
        self.assertEqual(result.frame_timestamp_ms, frame.frame_timestamp_ms)
        self.assertEqual(result.payload_bytes, frame.payload_bytes)
        self.assertEqual(result.source_checksum, frame.source_checksum)

    def test_06_exact_builtin_float_timing(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(type(result.inference_ms), float)

    def test_07_candidate_result_identity_on_success(self) -> None:
        candidate = object()
        detect = _make_detect(result=candidate)
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.candidate_result, candidate)

    def test_08_exact_outcome_field_set(self) -> None:
        field_names = {f.name for f in dataclasses.fields(FaceLandmarkerInferenceOutcome)}
        self.assertEqual(
            field_names,
            {
                "status",
                "request_id",
                "frame_timestamp_ms",
                "payload_bytes",
                "source_checksum",
                "inference_ms",
                "candidate_result",
            },
        )


# =============================================================================
# Frame validation
# =============================================================================


class FrameValidationTest(unittest.TestCase):
    def _assert_rejected(self, frame: object) -> None:
        detect = _make_detect(result=object())
        runtime = _FakeRuntime(detect=detect)
        lifecycle = _make_ready_lifecycle(runtime)
        api, calls = _make_api()
        clock = _sequence_clock(1.0, 2.0)

        with mock.patch.object(
            FaceLandmarkerRuntimeLifecycle,
            "borrow_ready_runtime",
            autospec=True,
            side_effect=FaceLandmarkerRuntimeLifecycle.borrow_ready_runtime,
        ) as mocked_borrow:
            result = run_face_landmarker_single_frame_inference(
                frame, lifecycle, api, monotonic_clock=clock
            )

        self.assertIsNone(result)
        self.assertEqual(mocked_borrow.call_count, 0)
        self.assertEqual(len(calls.frombuffer_calls), 0)
        self.assertEqual(len(calls.image_constructor_calls), 0)
        self.assertEqual(len(clock.calls), 0)
        self.assertEqual(len(detect.calls), 0)

    def test_01_wrong_frame_type(self) -> None:
        for bogus in (object(), None, {}, "frame", 42):
            with self.subTest(bogus=bogus):
                self._assert_rejected(bogus)

    def test_02_frame_subclass_rejected(self) -> None:
        class _Subclass(ValidatedHelperRgb24Frame):
            pass

        subclass_frame = _Subclass(**dataclasses.asdict(_valid_frame()))
        self._assert_rejected(subclass_frame)

    def test_03_request_id_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(request_id="7"))

    def test_04_request_id_bool(self) -> None:
        self._assert_rejected(_valid_frame(request_id=True))

    def test_05_request_id_zero(self) -> None:
        self._assert_rejected(_valid_frame(request_id=0))

    def test_06_request_id_above_max(self) -> None:
        self._assert_rejected(_valid_frame(request_id=_INT64_MAX + 1))

    def test_07_timestamp_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(frame_timestamp_ms="1000"))

    def test_08_timestamp_below_min(self) -> None:
        self._assert_rejected(_valid_frame(frame_timestamp_ms=_INT64_MIN - 1))

    def test_09_timestamp_above_max(self) -> None:
        self._assert_rejected(_valid_frame(frame_timestamp_ms=_INT64_MAX + 1))

    def test_10_width_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(width="2"))

    def test_11_width_zero(self) -> None:
        self._assert_rejected(_valid_frame(width=0))

    def test_12_width_above_max(self) -> None:
        self._assert_rejected(_valid_frame(width=7681))

    def test_13_height_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(height="2"))

    def test_14_height_zero(self) -> None:
        self._assert_rejected(_valid_frame(height=0))

    def test_15_height_above_max(self) -> None:
        self._assert_rejected(_valid_frame(height=4321))

    def test_16_row_stride_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(row_stride_bytes="6"))

    def test_17_row_stride_mismatch(self) -> None:
        self._assert_rejected(_valid_frame(row_stride_bytes=_STRIDE + 1))

    def test_18_payload_bytes_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(payload_bytes="12"))

    def test_19_payload_bytes_mismatch(self) -> None:
        self._assert_rejected(_valid_frame(payload_bytes=_PAYLOAD_BYTES + 1))

    def test_20_payload_exceeds_cap(self) -> None:
        self._assert_rejected(
            _valid_frame(
                width=7680,
                height=1457,
                row_stride_bytes=23040,
                payload_bytes=23040 * 1457,
                rgb24_bytes=b"",
            )
        )

    def test_21_rgb24_bytes_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(rgb24_bytes=list(_RGB_PAYLOAD)))

    def test_22_rgb24_bytes_bytearray(self) -> None:
        self._assert_rejected(_valid_frame(rgb24_bytes=bytearray(_RGB_PAYLOAD)))

    def test_23_rgb24_bytes_subclass(self) -> None:
        class _BytesSubclass(bytes):
            pass

        self._assert_rejected(_valid_frame(rgb24_bytes=_BytesSubclass(_RGB_PAYLOAD)))

    def test_24_rgb24_bytes_length_mismatch(self) -> None:
        self._assert_rejected(_valid_frame(rgb24_bytes=_RGB_PAYLOAD[:-1]))

    def test_25_source_checksum_wrong_type(self) -> None:
        self._assert_rejected(_valid_frame(source_checksum="123"))

    def test_26_source_checksum_negative(self) -> None:
        self._assert_rejected(_valid_frame(source_checksum=-1))

    def test_27_source_checksum_above_uint32_max(self) -> None:
        self._assert_rejected(_valid_frame(source_checksum=_UINT32_MAX + 1))

    def test_28_source_checksum_bool(self) -> None:
        self._assert_rejected(_valid_frame(source_checksum=True))


# =============================================================================
# Runtime availability
# =============================================================================


class RuntimeAvailabilityTest(unittest.TestCase):
    def test_01_ready_lifecycle_succeeds(self) -> None:
        candidate = object()
        detect = _make_detect(result=candidate)
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        api, _ = _make_api()
        clock = _sequence_clock(1.0, 1.5)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.SUCCESS)
        self.assertIs(result.candidate_result, candidate)

    def test_02_closed_lifecycle_returns_runtime_unavailable(self) -> None:
        lifecycle = _make_closed_lifecycle()
        api, calls = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertIsNone(result.candidate_result)
        self.assertEqual(len(calls.frombuffer_calls), 0)
        self.assertEqual(len(clock.calls), 0)

    def test_03_failed_lifecycle_returns_runtime_unavailable(self) -> None:
        lifecycle = _make_failed_lifecycle()
        api, calls = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)
        self.assertEqual(len(calls.frombuffer_calls), 0)
        self.assertEqual(len(clock.calls), 0)

    def test_04_wrong_lifecycle_type_returns_runtime_unavailable(self) -> None:
        api, _ = _make_api()
        clock = _sequence_clock(1.0, 2.0, 1.0, 2.0, 1.0, 2.0, 1.0, 2.0, 1.0, 2.0)
        for bogus in (
            object(),
            None,
            "lifecycle",
            5,
            types.SimpleNamespace(borrow_ready_runtime=lambda: None),
        ):
            with self.subTest(bogus=bogus):
                result = run_face_landmarker_single_frame_inference(
                    _valid_frame(), bogus, api, monotonic_clock=clock
                )
                self.assertIs(
                    result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE
                )

    def test_05_borrow_called_exactly_once_on_success(self) -> None:
        detect = _make_detect(result=object())
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        api, _ = _make_api()
        clock = _sequence_clock(1.0, 1.5)
        with mock.patch.object(
            FaceLandmarkerRuntimeLifecycle,
            "borrow_ready_runtime",
            autospec=True,
            side_effect=FaceLandmarkerRuntimeLifecycle.borrow_ready_runtime,
        ) as mocked_borrow:
            run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )
        self.assertEqual(mocked_borrow.call_count, 1)

    def test_06_borrow_ordinary_exception_returns_runtime_unavailable(self) -> None:
        lifecycle = _make_ready_lifecycle()
        api, _ = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        with mock.patch.object(
            FaceLandmarkerRuntimeLifecycle,
            "borrow_ready_runtime",
            side_effect=RuntimeError("boom"),
        ):
            result = run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)

    def test_07_runtime_missing_detect(self) -> None:
        lifecycle = _make_ready_lifecycle(_FakeRuntime())
        api, calls = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)
        self.assertEqual(len(calls.frombuffer_calls), 0)

    def test_08_detect_attribute_access_raises(self) -> None:
        lifecycle = _make_ready_lifecycle(_RaisingDetectRuntime(RuntimeError("boom")))
        api, calls = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)
        self.assertEqual(len(calls.frombuffer_calls), 0)

    def test_09_detect_non_callable(self) -> None:
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect="not callable"))
        api, calls = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)
        self.assertEqual(len(calls.frombuffer_calls), 0)

    def test_10_no_clock_call_on_runtime_failure(self) -> None:
        lifecycle = _make_closed_lifecycle()
        api, _ = _make_api()
        clock = _sequence_clock(1.0, 2.0)
        run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertEqual(len(clock.calls), 0)

    def test_11_keyboard_interrupt_from_borrow_not_swallowed(self) -> None:
        lifecycle = _make_ready_lifecycle()
        api, _ = _make_api()
        with mock.patch.object(
            FaceLandmarkerRuntimeLifecycle,
            "borrow_ready_runtime",
            side_effect=KeyboardInterrupt(),
        ):
            with self.assertRaises(KeyboardInterrupt):
                run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)

    def test_12_system_exit_from_borrow_not_swallowed(self) -> None:
        lifecycle = _make_ready_lifecycle()
        api, _ = _make_api()
        with mock.patch.object(
            FaceLandmarkerRuntimeLifecycle,
            "borrow_ready_runtime",
            side_effect=SystemExit(),
        ):
            with self.assertRaises(SystemExit):
                run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)


# =============================================================================
# API validation
# =============================================================================


class ApiValidationTest(unittest.TestCase):
    def _assert_image_adaptation_failed(self, api: object) -> None:
        detect = _make_detect(result=object())
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertIsNone(result.candidate_result)
        self.assertEqual(len(detect.calls), 0)
        self.assertEqual(len(clock.calls), 0)

    def test_01_wrong_api_type(self) -> None:
        for bogus in (object(), None, {}, "api"):
            with self.subTest(bogus=bogus):
                self._assert_image_adaptation_failed(bogus)

    def test_02_api_subclass_rejected(self) -> None:
        class _ApiSubclass(FaceLandmarkerInferenceApi):
            pass

        api, _ = _make_api(api_type=_ApiSubclass)
        self._assert_image_adaptation_failed(api)

    def test_03_non_callable_numpy_frombuffer(self) -> None:
        api, _ = _make_api(frombuffer="not callable")
        self._assert_image_adaptation_failed(api)

    def test_04_numpy_uint8_none(self) -> None:
        api, _ = _make_api(numpy_uint8=None)
        self._assert_image_adaptation_failed(api)

    def test_05_non_callable_ascontiguousarray(self) -> None:
        api, _ = _make_api(ascontiguousarray="not callable")
        self._assert_image_adaptation_failed(api)

    def test_06_non_callable_image_constructor(self) -> None:
        api, _ = _make_api(image_constructor="not callable")
        self._assert_image_adaptation_failed(api)

    def test_07_srgb_image_format_none(self) -> None:
        api, _ = _make_api(srgb_image_format=None)
        self._assert_image_adaptation_failed(api)


# =============================================================================
# Image adaptation
# =============================================================================


class ImageAdaptationTest(unittest.TestCase):
    def test_01_exact_call_order_and_identity(self) -> None:
        order: list = []
        source_bytes_holder: list = []
        produced_holder: list = []

        def numpy_frombuffer(data: object, dtype: object) -> object:
            order.append("frombuffer")
            source_bytes_holder.append(data)
            self.assertIs(dtype, _UINT8_SENTINEL)
            flat = types.SimpleNamespace()

            def _reshape(shape: object) -> object:
                order.append("reshape")
                self.assertEqual(shape, (_HEIGHT, _WIDTH, 3))
                return _FakeArray(shape, dtype, True)

            flat.reshape = _reshape
            return flat

        def numpy_ascontiguousarray(array: object, dtype: object) -> object:
            order.append("ascontiguousarray")
            produced = _FakeArray(array.shape, dtype, True)
            produced_holder.append(produced)
            return produced

        def image_constructor(*, image_format: object, data: object) -> object:
            order.append("image_constructor")
            self.assertIs(image_format, _SRGB_SENTINEL)
            self.assertIs(data, produced_holder[-1])
            return object()

        api = FaceLandmarkerInferenceApi(
            numpy_frombuffer=numpy_frombuffer,
            numpy_uint8=_UINT8_SENTINEL,
            numpy_ascontiguousarray=numpy_ascontiguousarray,
            image_constructor=image_constructor,
            srgb_image_format=_SRGB_SENTINEL,
        )

        def clock() -> float:
            order.append("clock")
            return float(len(order))

        def detect(image: object) -> object:
            order.append("detect")
            return object()

        frame = _valid_frame()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        result = run_face_landmarker_single_frame_inference(
            frame, lifecycle, api, monotonic_clock=clock
        )

        self.assertIs(result.status, FaceLandmarkerInferenceStatus.SUCCESS)
        self.assertEqual(
            order,
            [
                "frombuffer",
                "reshape",
                "ascontiguousarray",
                "image_constructor",
                "clock",
                "detect",
                "clock",
            ],
        )
        self.assertIs(source_bytes_holder[0], frame.rgb24_bytes)

    def _assert_adaptation_failed(self, api: object) -> None:
        detect = _make_detect(result=object())
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertIsNone(result.candidate_result)
        self.assertEqual(len(detect.calls), 0)
        self.assertEqual(len(clock.calls), 0)

    def test_02_frombuffer_ordinary_exception(self) -> None:
        api, _ = _make_api(frombuffer_error=RuntimeError("boom"))
        self._assert_adaptation_failed(api)

    def test_03_reshape_missing(self) -> None:
        api, _ = _make_api(reshape_missing=True)
        self._assert_adaptation_failed(api)

    def test_04_reshape_non_callable(self) -> None:
        api, _ = _make_api(reshape_non_callable=True)
        self._assert_adaptation_failed(api)

    def test_05_reshape_ordinary_exception(self) -> None:
        api, _ = _make_api(reshape_error=RuntimeError("boom"))
        self._assert_adaptation_failed(api)

    def test_06_ascontiguousarray_ordinary_exception(self) -> None:
        api, _ = _make_api(ascontiguousarray_error=RuntimeError("boom"))
        self._assert_adaptation_failed(api)

    def test_07_wrong_final_shape(self) -> None:
        api, _ = _make_api(final_shape=(1, 1, 3))
        self._assert_adaptation_failed(api)

    def test_08_wrong_final_dtype(self) -> None:
        api, _ = _make_api(final_dtype=object())
        self._assert_adaptation_failed(api)

    def test_09_non_contiguous_final_array(self) -> None:
        api, _ = _make_api(final_c_contiguous=False)
        self._assert_adaptation_failed(api)

    def test_10_metadata_access_raises(self) -> None:
        api, _ = _make_api(metadata_access_error=RuntimeError("boom"))
        self._assert_adaptation_failed(api)

    def test_11_image_constructor_ordinary_exception(self) -> None:
        api, _ = _make_api(image_constructor_error=RuntimeError("boom"))
        self._assert_adaptation_failed(api)

    def test_12_image_constructor_returns_none(self) -> None:
        api, _ = _make_api(image_constructor_returns_none=True)
        self._assert_adaptation_failed(api)

    def test_13_keyboard_interrupt_from_frombuffer_not_swallowed(self) -> None:
        api, _ = _make_api(frombuffer_error=KeyboardInterrupt())
        detect = _make_detect(result=object())
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        with self.assertRaises(KeyboardInterrupt):
            run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)

    def test_14_system_exit_from_image_constructor_not_swallowed(self) -> None:
        api, _ = _make_api(image_constructor_error=SystemExit())
        detect = _make_detect(result=object())
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        with self.assertRaises(SystemExit):
            run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)

    def test_15_source_bytes_unchanged(self) -> None:
        frame = _valid_frame()
        before = bytes(frame.rgb24_bytes)
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        run_face_landmarker_single_frame_inference(
            frame, lifecycle, api, monotonic_clock=clock
        )
        self.assertEqual(frame.rgb24_bytes, before)


# =============================================================================
# Detection
# =============================================================================


class DetectionTest(unittest.TestCase):
    def test_01_detect_called_exactly_once_with_exact_image(self) -> None:
        constructed_image = object()
        api, _ = _make_api(
            image_constructor=lambda *, image_format, data: constructed_image
        )
        detect = _make_detect(result=object())
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertEqual(len(detect.calls), 1)
        self.assertIs(detect.calls[0], constructed_image)

    def test_02_no_extra_arguments(self) -> None:
        received: list = []

        def detect(image: object) -> object:
            received.append(image)
            return object()

        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.SUCCESS)
        self.assertEqual(len(received), 1)

    def test_03_result_identity_preserved_on_success(self) -> None:
        candidate = object()
        detect = _make_detect(result=candidate)
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.candidate_result, candidate)

    def test_04_none_result_maps_to_detection_failed(self) -> None:
        detect = _make_detect(result=None)
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertIsNone(result.candidate_result)

    def test_05_ordinary_exception_maps_to_detection_failed(self) -> None:
        detect = _make_detect(error=RuntimeError("very specific detect failure"))
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertIsNone(result.candidate_result)
        self.assertNotIn("very specific detect failure", repr(result))
        self.assertNotIn("very specific detect failure", str(result))

    def test_06_keyboard_interrupt_not_swallowed(self) -> None:
        detect = _make_detect(error=KeyboardInterrupt())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        with self.assertRaises(KeyboardInterrupt):
            run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )

    def test_07_system_exit_not_swallowed(self) -> None:
        detect = _make_detect(error=SystemExit())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.2)
        with self.assertRaises(SystemExit):
            run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )


# =============================================================================
# Timing
# =============================================================================


class TimingTest(unittest.TestCase):
    def test_01_non_callable_clock_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, calls = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock="not callable"
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(calls.frombuffer_calls), 0)
        self.assertEqual(len(detect.calls), 0)

    def test_02_exact_millisecond_conversion(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.25)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertEqual(result.inference_ms, 250.0)

    def test_03_zero_duration(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(2.0, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertEqual(result.inference_ms, 0.0)
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.SUCCESS)

    def test_04_negative_elapsed_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(5.0, 4.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertIsNone(result.candidate_result)

    def test_05_nan_sample_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(float("nan"), 1.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(detect.calls), 0)

    def test_06_infinite_sample_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(float("inf"), 1.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(detect.calls), 0)

    def test_07_int_sample_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(detect.calls), 0)

    def test_08_bool_sample_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(True, 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(detect.calls), 0)

    def test_09_float_subclass_sample_rejected(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(_FloatSubclass(1.0), 2.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(detect.calls), 0)

    def test_10_start_clock_ordinary_exception_prevents_detect(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(RuntimeError("boom"), 1.0)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertEqual(len(detect.calls), 0)

    def test_11_end_clock_ordinary_exception_discards_candidate(self) -> None:
        candidate = object()
        detect = _make_detect(result=candidate)
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, RuntimeError("boom"))
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertEqual(result.inference_ms, 0.0)
        self.assertIsNone(result.candidate_result)
        self.assertEqual(len(detect.calls), 1)

    def test_12_detect_failure_with_valid_samples_preserves_elapsed_timing(self) -> None:
        detect = _make_detect(error=RuntimeError("boom"))
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.DETECTION_FAILED)
        self.assertAlmostEqual(result.inference_ms, 100.0)
        self.assertIsNone(result.candidate_result)

    def test_13_timing_always_finite_and_non_negative(self) -> None:
        for clock_values in ((1.0, 1.5), (1.0, 1.0)):
            with self.subTest(clock_values=clock_values):
                detect = _make_detect(result=object())
                api, _ = _make_api()
                lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
                clock = _sequence_clock(*clock_values)
                result = run_face_landmarker_single_frame_inference(
                    _valid_frame(), lifecycle, api, monotonic_clock=clock
                )
                self.assertIs(result.status, FaceLandmarkerInferenceStatus.SUCCESS)
                self.assertTrue(math.isfinite(result.inference_ms))
                self.assertGreaterEqual(result.inference_ms, 0.0)


# =============================================================================
# Ownership and privacy
# =============================================================================


class OwnershipAndPrivacyTest(unittest.TestCase):
    def test_01_repeated_calls_share_no_state(self) -> None:
        candidate_a = object()
        candidate_b = object()
        detect_a = _make_detect(result=candidate_a)
        detect_b = _make_detect(result=candidate_b)
        api, _ = _make_api()
        lifecycle_a = _make_ready_lifecycle(_FakeRuntime(detect=detect_a))
        lifecycle_b = _make_ready_lifecycle(_FakeRuntime(detect=detect_b))
        clock_a = _sequence_clock(1.0, 1.1)
        clock_b = _sequence_clock(2.0, 2.3)

        result_a = run_face_landmarker_single_frame_inference(
            _valid_frame(request_id=1), lifecycle_a, api, monotonic_clock=clock_a
        )
        result_b = run_face_landmarker_single_frame_inference(
            _valid_frame(request_id=2), lifecycle_b, api, monotonic_clock=clock_b
        )

        self.assertIsNot(result_a.candidate_result, result_b.candidate_result)
        self.assertEqual(result_a.request_id, 1)
        self.assertEqual(result_b.request_id, 2)

    def test_02_failure_outcomes_contain_no_raw_result(self) -> None:
        lifecycle = _make_closed_lifecycle()
        api, _ = _make_api()
        result = run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)
        self.assertIsNone(result.candidate_result)

    def test_03_no_private_or_exception_field_on_outcome(self) -> None:
        field_names = {f.name for f in dataclasses.fields(FaceLandmarkerInferenceOutcome)}
        self.assertNotIn("exception", field_names)
        self.assertNotIn("error", field_names)
        self.assertNotIn("path", field_names)
        self.assertNotIn("model_asset_path", field_names)

    def test_04_repr_contains_no_exception_text(self) -> None:
        detect = _make_detect(error=RuntimeError("very specific secret text"))
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        result = run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertNotIn("very specific secret text", repr(result))
        self.assertNotIn("very specific secret text", str(result))

    def test_05_no_stdout_on_success(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )
        self.assertEqual(stdout.getvalue(), "")

    def test_06_no_stderr_on_success(self) -> None:
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )
        self.assertEqual(stderr.getvalue(), "")

    def test_07_no_stdout_on_failure(self) -> None:
        lifecycle = _make_closed_lifecycle()
        api, _ = _make_api()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)
        self.assertEqual(stdout.getvalue(), "")

    def test_08_no_stderr_on_failure(self) -> None:
        lifecycle = _make_closed_lifecycle()
        api, _ = _make_api()
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            run_face_landmarker_single_frame_inference(_valid_frame(), lifecycle, api)
        self.assertEqual(stderr.getvalue(), "")

    def test_09_no_filesystem_calls(self) -> None:
        import builtins

        original_open = builtins.open

        def _forbidden_open(*args: object, **kwargs: object) -> object:
            raise AssertionError("filesystem access is not permitted")

        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        builtins.open = _forbidden_open
        try:
            result = run_face_landmarker_single_frame_inference(
                _valid_frame(), lifecycle, api, monotonic_clock=clock
            )
        finally:
            builtins.open = original_open
        self.assertIs(result.status, FaceLandmarkerInferenceStatus.SUCCESS)

    def test_10_no_actual_numpy_or_mediapipe_import(self) -> None:
        self.assertNotIn("numpy", sys.modules)
        self.assertNotIn("mediapipe", sys.modules)
        detect = _make_detect(result=object())
        api, _ = _make_api()
        lifecycle = _make_ready_lifecycle(_FakeRuntime(detect=detect))
        clock = _sequence_clock(1.0, 1.1)
        run_face_landmarker_single_frame_inference(
            _valid_frame(), lifecycle, api, monotonic_clock=clock
        )
        self.assertNotIn("numpy", sys.modules)
        self.assertNotIn("mediapipe", sys.modules)

    def test_11_module_does_not_import_disallowed_names(self) -> None:
        module_globals = set(vars(face_landmarker_inference).keys())
        disallowed = {"numpy", "cv2", "PIL", "mediapipe", "create_face_landmarker_runtime"}
        self.assertEqual(module_globals & disallowed, set())


if __name__ == "__main__":
    unittest.main()
