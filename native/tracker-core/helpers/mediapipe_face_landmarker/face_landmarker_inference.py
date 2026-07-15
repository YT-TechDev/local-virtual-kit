"""Single-frame MediaPipe Face Landmarker inference adapter.

This module performs exactly one synchronous IMAGE-mode `detect()` call per
invocation. It revalidates the immutable RGB24 frame from
`helper_frame_rgb`, borrows a runtime only through the ready-runtime
boundary of `face_landmarker_runtime`, and adapts pixels through an
injected minimal NumPy/MediaPipe image surface so ordinary CI requires
neither real package.

The adapter retains no frame, pixel buffer, NumPy array, MediaPipe image,
lifecycle, runtime, or result history after returning: only the returned
outcome may carry one transient raw candidate-result reference for
immediate consumption by the caller.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from time import monotonic
from typing import Callable

from face_landmarker_runtime import FaceLandmarkerRuntimeLifecycle
from helper_frame_rgb import ValidatedHelperRgb24Frame

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1

_FRAME_MIN_WIDTH = 1
_FRAME_MAX_WIDTH = 7680
_FRAME_MIN_HEIGHT = 1
_FRAME_MAX_HEIGHT = 4320
_FRAME_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024


class FaceLandmarkerInferenceStatus(Enum):
    SUCCESS = "success"
    RUNTIME_UNAVAILABLE = "runtime_unavailable"
    IMAGE_ADAPTATION_FAILED = "image_adaptation_failed"
    DETECTION_FAILED = "detection_failed"


@dataclass(frozen=True)
class FaceLandmarkerInferenceApi:
    numpy_frombuffer: Callable[..., object]
    numpy_uint8: object
    numpy_ascontiguousarray: Callable[..., object]
    image_constructor: Callable[..., object]
    srgb_image_format: object


@dataclass(frozen=True)
class FaceLandmarkerInferenceOutcome:
    status: FaceLandmarkerInferenceStatus
    request_id: int
    frame_timestamp_ms: int
    payload_bytes: int
    source_checksum: int
    inference_ms: float
    candidate_result: object | None


def _is_valid_frame(frame: object) -> bool:
    if type(frame) is not ValidatedHelperRgb24Frame:
        return False

    request_id = frame.request_id
    if type(request_id) is not int:
        return False
    if not (1 <= request_id <= _INT64_MAX):
        return False

    frame_timestamp_ms = frame.frame_timestamp_ms
    if type(frame_timestamp_ms) is not int:
        return False
    if not (_INT64_MIN <= frame_timestamp_ms <= _INT64_MAX):
        return False

    width = frame.width
    if type(width) is not int:
        return False
    if not (_FRAME_MIN_WIDTH <= width <= _FRAME_MAX_WIDTH):
        return False

    height = frame.height
    if type(height) is not int:
        return False
    if not (_FRAME_MIN_HEIGHT <= height <= _FRAME_MAX_HEIGHT):
        return False

    row_stride_bytes = frame.row_stride_bytes
    if type(row_stride_bytes) is not int:
        return False
    if row_stride_bytes != width * 3:
        return False

    payload_bytes = frame.payload_bytes
    if type(payload_bytes) is not int:
        return False
    if payload_bytes != row_stride_bytes * height:
        return False
    if payload_bytes > _FRAME_MAX_PAYLOAD_BYTES:
        return False

    rgb24_bytes = frame.rgb24_bytes
    if type(rgb24_bytes) is not bytes:
        return False
    if len(rgb24_bytes) != payload_bytes:
        return False

    source_checksum = frame.source_checksum
    if type(source_checksum) is not int:
        return False
    if not (0 <= source_checksum <= _UINT32_MAX):
        return False

    return True


def _is_valid_api(api: object) -> bool:
    if type(api) is not FaceLandmarkerInferenceApi:
        return False
    if not callable(api.numpy_frombuffer):
        return False
    if api.numpy_uint8 is None:
        return False
    if not callable(api.numpy_ascontiguousarray):
        return False
    if not callable(api.image_constructor):
        return False
    if api.srgb_image_format is None:
        return False
    return True


def _is_valid_clock_sample(sample: object) -> bool:
    if type(sample) is not float:
        return False
    return math.isfinite(sample)


def _is_valid_elapsed_ms(value: object) -> bool:
    if type(value) is not float:
        return False
    if not math.isfinite(value):
        return False
    if value < 0.0:
        return False
    return True


def run_face_landmarker_single_frame_inference(
    frame: ValidatedHelperRgb24Frame,
    lifecycle: FaceLandmarkerRuntimeLifecycle,
    api: FaceLandmarkerInferenceApi,
    monotonic_clock: Callable[[], float] = monotonic,
) -> FaceLandmarkerInferenceOutcome | None:
    if not _is_valid_frame(frame):
        return None

    request_id = frame.request_id
    frame_timestamp_ms = frame.frame_timestamp_ms
    width = frame.width
    height = frame.height
    payload_bytes = frame.payload_bytes
    rgb24_bytes = frame.rgb24_bytes
    source_checksum = frame.source_checksum

    def _outcome(
        status: FaceLandmarkerInferenceStatus,
        inference_ms: float = 0.0,
        candidate_result: object | None = None,
    ) -> FaceLandmarkerInferenceOutcome:
        return FaceLandmarkerInferenceOutcome(
            status=status,
            request_id=request_id,
            frame_timestamp_ms=frame_timestamp_ms,
            payload_bytes=payload_bytes,
            source_checksum=source_checksum,
            inference_ms=inference_ms,
            candidate_result=candidate_result,
        )

    if type(lifecycle) is not FaceLandmarkerRuntimeLifecycle:
        return _outcome(FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)

    try:
        runtime = lifecycle.borrow_ready_runtime()
    except Exception:
        return _outcome(FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)

    if runtime is None:
        return _outcome(FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)

    try:
        detect = runtime.detect
    except Exception:
        return _outcome(FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)

    if not callable(detect):
        return _outcome(FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE)

    if not _is_valid_api(api):
        return _outcome(FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)

    if not callable(monotonic_clock):
        return _outcome(FaceLandmarkerInferenceStatus.DETECTION_FAILED)

    try:
        flat_rgb = api.numpy_frombuffer(rgb24_bytes, dtype=api.numpy_uint8)
        shaped_rgb = flat_rgb.reshape((height, width, 3))
        contiguous_rgb = api.numpy_ascontiguousarray(shaped_rgb, dtype=api.numpy_uint8)

        if contiguous_rgb.shape != (height, width, 3):
            return _outcome(FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)
        if contiguous_rgb.dtype != api.numpy_uint8:
            return _outcome(FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)
        if contiguous_rgb.flags.c_contiguous is not True:
            return _outcome(FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)

        image = api.image_constructor(
            image_format=api.srgb_image_format,
            data=contiguous_rgb,
        )
        if image is None:
            return _outcome(FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)
    except Exception:
        return _outcome(FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED)

    try:
        start_seconds = monotonic_clock()
    except Exception:
        return _outcome(FaceLandmarkerInferenceStatus.DETECTION_FAILED)

    if not _is_valid_clock_sample(start_seconds):
        return _outcome(FaceLandmarkerInferenceStatus.DETECTION_FAILED)

    detect_failed = False
    try:
        candidate_result = detect(image)
    except Exception:
        detect_failed = True
        candidate_result = None

    try:
        end_seconds = monotonic_clock()
    except Exception:
        return _outcome(FaceLandmarkerInferenceStatus.DETECTION_FAILED)

    if not _is_valid_clock_sample(end_seconds):
        return _outcome(FaceLandmarkerInferenceStatus.DETECTION_FAILED)

    elapsed_ms = (end_seconds - start_seconds) * 1000.0
    if not _is_valid_elapsed_ms(elapsed_ms):
        return _outcome(FaceLandmarkerInferenceStatus.DETECTION_FAILED)

    if detect_failed:
        return _outcome(
            FaceLandmarkerInferenceStatus.DETECTION_FAILED, inference_ms=elapsed_ms
        )

    if candidate_result is None:
        return _outcome(
            FaceLandmarkerInferenceStatus.DETECTION_FAILED, inference_ms=elapsed_ms
        )

    return _outcome(
        FaceLandmarkerInferenceStatus.SUCCESS,
        inference_ms=elapsed_ms,
        candidate_result=candidate_result,
    )
