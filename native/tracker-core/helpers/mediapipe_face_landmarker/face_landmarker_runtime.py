"""Lazy lifecycle wrapper for one MediaPipe Face Landmarker runtime.

This module performs the real MediaPipe import only when construction is
explicitly requested. It resolves the official Python Tasks API surface,
constructs options through the `face_landmarker_options` factory, and
creates at most one `FaceLandmarker` runtime via `create_from_options()`.

The wrapper owns runtime availability state and bounded creation/close
classifications. It owns no frame, image, inference result, detect call,
loop, retry, thread, callback, pipe/session I/O, logging, filesystem
access, model download, camera access, or network behavior.
"""

from __future__ import annotations

from enum import Enum
from importlib import import_module
from typing import Callable

from face_landmarker_options import (
    FaceLandmarkerOptionsApi,
    FaceLandmarkerOptionsFactoryStatus,
    create_face_landmarker_options,
)


class FaceLandmarkerRuntimeState(Enum):
    READY = "ready"
    CLOSED = "closed"
    FAILED = "failed"


class FaceLandmarkerRuntimeCreationStatus(Enum):
    SUCCESS = "success"
    CONFIGURATION_FAILED = "configuration_failed"
    IMPORT_FAILED = "import_failed"
    API_RESOLUTION_FAILED = "api_resolution_failed"
    OPTIONS_CONSTRUCTION_FAILED = "options_construction_failed"
    RUNTIME_INITIALIZATION_FAILED = "runtime_initialization_failed"


class FaceLandmarkerRuntimeCloseStatus(Enum):
    CLOSED = "closed"
    CLOSE_FAILED = "close_failed"
    NOT_READY = "not_ready"


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


class FaceLandmarkerRuntimeLifecycle:
    __slots__ = (
        "_state",
        "_creation_status",
        "_runtime",
        "_close_status",
    )

    def __init__(
        self,
        state: FaceLandmarkerRuntimeState,
        creation_status: FaceLandmarkerRuntimeCreationStatus,
        runtime: object | None,
    ) -> None:
        self._state = state
        self._creation_status = creation_status
        self._runtime = runtime
        self._close_status = FaceLandmarkerRuntimeCloseStatus.NOT_READY

    @property
    def state(self) -> FaceLandmarkerRuntimeState:
        return self._state

    @property
    def creation_status(self) -> FaceLandmarkerRuntimeCreationStatus:
        return self._creation_status

    def borrow_ready_runtime(self) -> object | None:
        if self._state is FaceLandmarkerRuntimeState.READY:
            return self._runtime
        return None

    def close(self) -> FaceLandmarkerRuntimeCloseStatus:
        if self._state is FaceLandmarkerRuntimeState.FAILED:
            return FaceLandmarkerRuntimeCloseStatus.NOT_READY

        if self._state is FaceLandmarkerRuntimeState.CLOSED:
            return self._close_status

        runtime = self._runtime
        self._runtime = None
        self._state = FaceLandmarkerRuntimeState.CLOSED
        self._close_status = FaceLandmarkerRuntimeCloseStatus.CLOSE_FAILED

        try:
            runtime.close()
        except Exception:
            return self._close_status

        self._close_status = FaceLandmarkerRuntimeCloseStatus.CLOSED
        return self._close_status


def _failed(
    creation_status: FaceLandmarkerRuntimeCreationStatus,
) -> FaceLandmarkerRuntimeLifecycle:
    return FaceLandmarkerRuntimeLifecycle(
        state=FaceLandmarkerRuntimeState.FAILED,
        creation_status=creation_status,
        runtime=None,
    )


_OPTIONS_FAILURE_STATUS_MAP = {
    FaceLandmarkerOptionsFactoryStatus.INVALID_MODEL_ASSET_PATH: (
        FaceLandmarkerRuntimeCreationStatus.CONFIGURATION_FAILED
    ),
    FaceLandmarkerOptionsFactoryStatus.INVALID_API_SURFACE: (
        FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED
    ),
    FaceLandmarkerOptionsFactoryStatus.BASE_OPTIONS_CONSTRUCTION_FAILED: (
        FaceLandmarkerRuntimeCreationStatus.OPTIONS_CONSTRUCTION_FAILED
    ),
    FaceLandmarkerOptionsFactoryStatus.FACE_LANDMARKER_OPTIONS_CONSTRUCTION_FAILED: (
        FaceLandmarkerRuntimeCreationStatus.OPTIONS_CONSTRUCTION_FAILED
    ),
}


def create_face_landmarker_runtime(
    model_asset_path: str,
    module_importer: Callable[[str], object] = import_module,
) -> FaceLandmarkerRuntimeLifecycle:
    if not _is_valid_model_asset_path(model_asset_path):
        return _failed(FaceLandmarkerRuntimeCreationStatus.CONFIGURATION_FAILED)

    if not callable(module_importer):
        return _failed(FaceLandmarkerRuntimeCreationStatus.IMPORT_FAILED)

    try:
        mediapipe_module = module_importer("mediapipe")
    except Exception:
        return _failed(FaceLandmarkerRuntimeCreationStatus.IMPORT_FAILED)

    try:
        tasks = mediapipe_module.tasks
        base_options_constructor = tasks.BaseOptions
        vision = tasks.vision
        face_landmarker_options_constructor = vision.FaceLandmarkerOptions
        running_mode = vision.RunningMode
        image_running_mode = running_mode.IMAGE
        face_landmarker_type = vision.FaceLandmarker
        create_from_options = face_landmarker_type.create_from_options
    except Exception:
        return _failed(FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED)

    if not callable(base_options_constructor):
        return _failed(FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED)
    if not callable(face_landmarker_options_constructor):
        return _failed(FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED)
    if image_running_mode is None:
        return _failed(FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED)
    if not callable(create_from_options):
        return _failed(FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED)

    api = FaceLandmarkerOptionsApi(
        base_options_constructor=base_options_constructor,
        face_landmarker_options_constructor=face_landmarker_options_constructor,
        image_running_mode=image_running_mode,
    )

    options_outcome = create_face_landmarker_options(model_asset_path, api)

    if options_outcome.status is not FaceLandmarkerOptionsFactoryStatus.SUCCESS:
        return _failed(_OPTIONS_FAILURE_STATUS_MAP[options_outcome.status])

    try:
        runtime = create_from_options(options_outcome.options)
    except Exception:
        return _failed(FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED)

    if runtime is None:
        return _failed(FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED)

    try:
        runtime_close = runtime.close
    except Exception:
        return _failed(FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED)

    if not callable(runtime_close):
        return _failed(FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED)

    return FaceLandmarkerRuntimeLifecycle(
        state=FaceLandmarkerRuntimeState.READY,
        creation_status=FaceLandmarkerRuntimeCreationStatus.SUCCESS,
        runtime=runtime,
    )
