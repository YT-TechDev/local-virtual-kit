"""Constructs the approved development-only MediaPipe Face Landmarker options.

This module is dependency-free (standard library only) and must not import
MediaPipe, NumPy, OpenCV, PIL, or any other runtime/helper module. It performs
no I/O of any kind: it only validates already-supplied in-memory values and
calls two caller-injected constructors.

The factory owns only syntactic validation of an explicit model asset path
and an injected minimal MediaPipe API surface, plus construction of
`BaseOptions` and `FaceLandmarkerOptions` through that surface. It does not
import MediaPipe itself, does not resolve, normalize, or inspect the path,
does not create a runtime, and retains no path, API surface, constructed
object, or exception after returning. The caller owns the returned options
object.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable


class FaceLandmarkerOptionsFactoryStatus(Enum):
    SUCCESS = "success"
    INVALID_MODEL_ASSET_PATH = "invalid_model_asset_path"
    INVALID_API_SURFACE = "invalid_api_surface"
    BASE_OPTIONS_CONSTRUCTION_FAILED = "base_options_construction_failed"
    FACE_LANDMARKER_OPTIONS_CONSTRUCTION_FAILED = (
        "face_landmarker_options_construction_failed"
    )


@dataclass(frozen=True)
class FaceLandmarkerOptionsApi:
    base_options_constructor: Callable[..., object]
    face_landmarker_options_constructor: Callable[..., object]
    image_running_mode: object


@dataclass(frozen=True)
class FaceLandmarkerOptionsFactoryOutcome:
    status: FaceLandmarkerOptionsFactoryStatus
    options: object | None


def _is_valid_model_asset_path(model_asset_path: object) -> bool:
    if type(model_asset_path) is not str:
        return False
    if len(model_asset_path) == 0:
        return False
    if "\0" in model_asset_path:
        return False
    if "\r" in model_asset_path:
        return False
    if "\n" in model_asset_path:
        return False
    return True


def _is_valid_api(api: object) -> bool:
    if type(api) is not FaceLandmarkerOptionsApi:
        return False
    if not callable(api.base_options_constructor):
        return False
    if not callable(api.face_landmarker_options_constructor):
        return False
    if api.image_running_mode is None:
        return False
    return True


def create_face_landmarker_options(
    model_asset_path: str,
    api: FaceLandmarkerOptionsApi,
) -> FaceLandmarkerOptionsFactoryOutcome:
    """Validates inputs and constructs the approved Face Landmarker options.

    `model_asset_path` must be exactly `type(model_asset_path) is str`
    (subclasses, bytes, bytearray, path-like objects, and `None` rejected),
    non-empty, and free of NUL, CR, and LF. The path is passed through
    unchanged: it is never stripped, normalized, resolved, or inspected.

    `api` must be exactly `type(api) is FaceLandmarkerOptionsApi` (subclasses
    rejected), with two callable constructors and a non-`None`
    `image_running_mode`.

    On a valid model asset path and API surface, calls
    `api.base_options_constructor` at most once and, only if that succeeds,
    calls `api.face_landmarker_options_constructor` at most once with the
    approved development option values and no `result_callback`. An ordinary
    exception from either constructor is mapped to a bounded failure status
    without retaining the exception, the path, or the constructor arguments.
    `BaseException` subclasses such as `KeyboardInterrupt` and `SystemExit`
    are not caught and remain visible to the caller.
    """
    if not _is_valid_model_asset_path(model_asset_path):
        return FaceLandmarkerOptionsFactoryOutcome(
            status=FaceLandmarkerOptionsFactoryStatus.INVALID_MODEL_ASSET_PATH,
            options=None,
        )

    if not _is_valid_api(api):
        return FaceLandmarkerOptionsFactoryOutcome(
            status=FaceLandmarkerOptionsFactoryStatus.INVALID_API_SURFACE,
            options=None,
        )

    try:
        base_options = api.base_options_constructor(
            model_asset_path=model_asset_path,
        )
    except Exception:
        return FaceLandmarkerOptionsFactoryOutcome(
            status=FaceLandmarkerOptionsFactoryStatus.BASE_OPTIONS_CONSTRUCTION_FAILED,
            options=None,
        )

    try:
        options = api.face_landmarker_options_constructor(
            base_options=base_options,
            running_mode=api.image_running_mode,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
    except Exception:
        failed_status = (
            FaceLandmarkerOptionsFactoryStatus.FACE_LANDMARKER_OPTIONS_CONSTRUCTION_FAILED
        )
        return FaceLandmarkerOptionsFactoryOutcome(
            status=failed_status,
            options=None,
        )

    return FaceLandmarkerOptionsFactoryOutcome(
        status=FaceLandmarkerOptionsFactoryStatus.SUCCESS,
        options=options,
    )
