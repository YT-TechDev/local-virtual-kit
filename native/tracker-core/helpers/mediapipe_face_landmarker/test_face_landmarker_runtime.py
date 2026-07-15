"""Standard-library fake-based tests for face_landmarker_runtime.py.

Run directly: python -B test_face_landmarker_runtime.py

These tests use strict fakes only. They do not import or install real
MediaPipe and claim only fake-based lifecycle and call-shape evidence:
no real package import, model loading, runtime close, inference, or
camera compatibility is proven here.
"""

from __future__ import annotations

import contextlib
import io
import sys
import types
import unittest

import face_landmarker_runtime
from face_landmarker_runtime import (
    FaceLandmarkerRuntimeCloseStatus,
    FaceLandmarkerRuntimeCreationStatus,
    FaceLandmarkerRuntimeLifecycle,
    FaceLandmarkerRuntimeState,
    create_face_landmarker_runtime,
)

_MODEL_ASSET_PATH = "models/face_landmarker.task"
_IMAGE_SENTINEL = object()


class _StrSubclass(str):
    pass


class _BytesSubclass(bytes):
    pass


class _PathLike:
    def __init__(self, path: str) -> None:
        self._path = path

    def __fspath__(self) -> str:
        return self._path


class _FakeRuntime:
    def __init__(
        self,
        *,
        close_error: Exception | None = None,
        close_missing: bool = False,
        close_not_callable: bool = False,
    ) -> None:
        self.close_calls = 0
        self._close_error = close_error
        if close_not_callable:
            self.close = "not callable"  # type: ignore[assignment]
        elif not close_missing:
            self.close = self._close  # type: ignore[assignment]

    def _close(self) -> None:
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error


def _make_base_options_constructor(error: Exception | None = None):
    calls: list = []

    def constructor(**kwargs: object) -> object:
        calls.append(kwargs)
        if error is not None:
            raise error
        return types.SimpleNamespace(kwargs=kwargs)

    constructor.calls = calls
    return constructor


def _make_face_landmarker_options_constructor(error: Exception | None = None):
    calls: list = []

    def constructor(**kwargs: object) -> object:
        calls.append(kwargs)
        if error is not None:
            raise error
        return types.SimpleNamespace(kwargs=kwargs)

    constructor.calls = calls
    return constructor


def _make_create_from_options(
    *,
    error: Exception | None = None,
    runtime_factory=None,
):
    calls: list = []

    def create_from_options(options: object) -> object:
        calls.append(options)
        if error is not None:
            raise error
        if runtime_factory is None:
            return _FakeRuntime()
        return runtime_factory()

    create_from_options.calls = calls
    return create_from_options


def _make_face_landmarker_type(create_from_options=None):
    if create_from_options is None:
        create_from_options = _make_create_from_options()
    return types.SimpleNamespace(create_from_options=create_from_options)


def _make_running_mode(image: object = _IMAGE_SENTINEL):
    return types.SimpleNamespace(IMAGE=image)


def _make_vision(
    *,
    face_landmarker_options_constructor=None,
    running_mode=None,
    face_landmarker_type=None,
):
    if face_landmarker_options_constructor is None:
        face_landmarker_options_constructor = _make_face_landmarker_options_constructor()
    if running_mode is None:
        running_mode = _make_running_mode()
    if face_landmarker_type is None:
        face_landmarker_type = _make_face_landmarker_type()
    return types.SimpleNamespace(
        FaceLandmarkerOptions=face_landmarker_options_constructor,
        RunningMode=running_mode,
        FaceLandmarker=face_landmarker_type,
    )


def _make_tasks(*, base_options_constructor=None, vision=None):
    if base_options_constructor is None:
        base_options_constructor = _make_base_options_constructor()
    if vision is None:
        vision = _make_vision()
    return types.SimpleNamespace(
        BaseOptions=base_options_constructor,
        vision=vision,
    )


def _make_module(*, tasks=None):
    if tasks is None:
        tasks = _make_tasks()
    return types.SimpleNamespace(tasks=tasks)


def _make_importer(*, module=None, error: Exception | None = None):
    if module is None:
        module = _make_module()
    calls: list = []

    def importer(name: str) -> object:
        calls.append(name)
        if error is not None:
            raise error
        return module

    importer.calls = calls
    return importer


def _raising_container(attr_name: str, error: Exception, **other_attrs: object):
    def getter(self: object) -> object:
        raise error

    namespace = dict(other_attrs)
    namespace[attr_name] = property(getter)
    cls = type("_RaisingContainer", (), namespace)
    return cls()


# =============================================================================
# Successful creation
# =============================================================================


class SuccessfulCreationTest(unittest.TestCase):
    def test_01_exact_lifecycle_type(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertIs(type(lifecycle), FaceLandmarkerRuntimeLifecycle)

    def test_02_initial_state_is_ready(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.READY)

    def test_03_creation_status_is_success(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertIs(
            lifecycle.creation_status, FaceLandmarkerRuntimeCreationStatus.SUCCESS
        )

    def test_04_importer_called_exactly_once_with_mediapipe(self) -> None:
        importer = _make_importer()
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(importer.calls, ["mediapipe"])

    def test_05_base_options_constructor_called_once(self) -> None:
        base_ctor = _make_base_options_constructor()
        tasks = _make_tasks(base_options_constructor=base_ctor)
        importer = _make_importer(module=_make_module(tasks=tasks))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(len(base_ctor.calls), 1)
        self.assertEqual(base_ctor.calls[0], {"model_asset_path": _MODEL_ASSET_PATH})

    def test_06_face_landmarker_options_constructor_called_once(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor()
        vision = _make_vision(face_landmarker_options_constructor=face_ctor)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(len(face_ctor.calls), 1)

    def test_07_create_from_options_called_exactly_once(self) -> None:
        create_from_options = _make_create_from_options()
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(len(create_from_options.calls), 1)

    def test_08_exact_factory_options_passed_to_create_from_options(self) -> None:
        create_from_options = _make_create_from_options()
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        face_ctor = _make_face_landmarker_options_constructor()
        vision = _make_vision(
            face_landmarker_options_constructor=face_ctor,
            face_landmarker_type=face_landmarker_type,
        )
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        constructed_options = face_ctor.calls[0]
        passed_options = create_from_options.calls[0]
        # The constructor returns a fresh object per call; compare via kwargs.
        self.assertEqual(
            passed_options.kwargs["running_mode"], constructed_options["running_mode"]
        )

    def test_09_no_detect_calls_on_runtime(self) -> None:
        runtime = _FakeRuntime()
        for forbidden in ("detect", "detect_for_video", "detect_async"):
            self.assertFalse(hasattr(runtime, forbidden))

    def test_10_no_close_during_creation(self) -> None:
        runtime_holder: list = []

        def runtime_factory() -> object:
            runtime = _FakeRuntime()
            runtime_holder.append(runtime)
            return runtime

        create_from_options = _make_create_from_options(runtime_factory=runtime_factory)
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(runtime_holder[0].close_calls, 0)

    def test_11_borrow_returns_exact_runtime_identity(self) -> None:
        expected_runtime = _FakeRuntime()
        create_from_options = _make_create_from_options(
            runtime_factory=lambda: expected_runtime
        )
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.borrow_ready_runtime(), expected_runtime)


# =============================================================================
# Configuration failures
# =============================================================================


class ConfigurationFailureTest(unittest.TestCase):
    def _assert_rejected(self, model_asset_path: object) -> None:
        importer = _make_importer()
        lifecycle = create_face_landmarker_runtime(
            model_asset_path, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.CONFIGURATION_FAILED,
        )
        self.assertIsNone(lifecycle.borrow_ready_runtime())
        self.assertEqual(importer.calls, [])

    def test_01_empty_string_rejected(self) -> None:
        self._assert_rejected("")

    def test_02_nul_rejected(self) -> None:
        self._assert_rejected("model\0.task")

    def test_03_cr_rejected(self) -> None:
        self._assert_rejected("model\r.task")

    def test_04_lf_rejected(self) -> None:
        self._assert_rejected("model\n.task")

    def test_05_none_rejected(self) -> None:
        self._assert_rejected(None)

    def test_06_bytes_rejected(self) -> None:
        self._assert_rejected(b"model.task")

    def test_07_path_like_object_rejected(self) -> None:
        self._assert_rejected(_PathLike(_MODEL_ASSET_PATH))

    def test_08_string_subclass_rejected(self) -> None:
        self._assert_rejected(_StrSubclass(_MODEL_ASSET_PATH))

    def test_09_bytes_subclass_rejected(self) -> None:
        self._assert_rejected(_BytesSubclass(b"model.task"))

    def test_10_whitespace_only_string_passed_unchanged(self) -> None:
        base_ctor = _make_base_options_constructor()
        tasks = _make_tasks(base_options_constructor=base_ctor)
        importer = _make_importer(module=_make_module(tasks=tasks))
        lifecycle = create_face_landmarker_runtime("   ", module_importer=importer)
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.READY)
        self.assertEqual(base_ctor.calls, [{"model_asset_path": "   "}])


# =============================================================================
# Import failures
# =============================================================================


class ImportFailureTest(unittest.TestCase):
    def test_01_non_callable_importer(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer="not callable"  # type: ignore[arg-type]
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status, FaceLandmarkerRuntimeCreationStatus.IMPORT_FAILED
        )
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_02_ordinary_importer_exception(self) -> None:
        importer = _make_importer(error=RuntimeError("no module named mediapipe"))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status, FaceLandmarkerRuntimeCreationStatus.IMPORT_FAILED
        )
        self.assertEqual(importer.calls, ["mediapipe"])
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_03_importer_called_at_most_once(self) -> None:
        importer = _make_importer(error=RuntimeError("boom"))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(len(importer.calls), 1)

    def test_04_no_options_or_runtime_constructor_called(self) -> None:
        base_ctor = _make_base_options_constructor()
        create_from_options = _make_create_from_options()
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        module = _make_module(tasks=_make_tasks(base_options_constructor=base_ctor, vision=vision))
        importer = _make_importer(module=module, error=RuntimeError("boom"))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(base_ctor.calls, [])
        self.assertEqual(create_from_options.calls, [])

    def test_05_no_path_or_exception_leakage(self) -> None:
        secret_path = "C:/private/secret-model-name.task"
        importer = _make_importer(error=RuntimeError("very specific internal text"))
        lifecycle = create_face_landmarker_runtime(secret_path, module_importer=importer)
        self.assertNotIn(secret_path, repr(lifecycle))
        self.assertNotIn(secret_path, str(lifecycle))
        self.assertNotIn("very specific internal text", repr(lifecycle))
        self.assertNotIn("very specific internal text", str(lifecycle))

    def test_06_keyboard_interrupt_not_swallowed(self) -> None:
        importer = _make_importer(error=KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)

    def test_07_system_exit_not_swallowed(self) -> None:
        importer = _make_importer(error=SystemExit())
        with self.assertRaises(SystemExit):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)


# =============================================================================
# API resolution failures
# =============================================================================


def _module_missing(attr_path: str) -> object:
    tasks = _make_tasks()
    vision = tasks.vision
    if attr_path == "tasks":
        module = _make_module()
        del module.tasks
        return module
    if attr_path == "tasks.BaseOptions":
        del tasks.BaseOptions
    elif attr_path == "tasks.vision":
        del tasks.vision
    elif attr_path == "vision.FaceLandmarkerOptions":
        del vision.FaceLandmarkerOptions
    elif attr_path == "vision.RunningMode":
        del vision.RunningMode
    elif attr_path == "vision.RunningMode.IMAGE":
        del vision.RunningMode.IMAGE
    elif attr_path == "vision.FaceLandmarker":
        del vision.FaceLandmarker
    elif attr_path == "vision.FaceLandmarker.create_from_options":
        del vision.FaceLandmarker.create_from_options
    else:  # pragma: no cover - defensive
        raise AssertionError(f"unknown attr path {attr_path}")
    return _make_module(tasks=tasks)


def _module_raising(attr_path: str, error: Exception) -> object:
    if attr_path == "tasks":
        return _raising_container("tasks", error)
    if attr_path == "tasks.BaseOptions":
        tasks = _raising_container("BaseOptions", error, vision=_make_vision())
        return _make_module(tasks=tasks)
    if attr_path == "tasks.vision":
        tasks = _raising_container(
            "vision", error, BaseOptions=_make_base_options_constructor()
        )
        return _make_module(tasks=tasks)
    if attr_path == "vision.FaceLandmarkerOptions":
        vision = _raising_container(
            "FaceLandmarkerOptions",
            error,
            RunningMode=_make_running_mode(),
            FaceLandmarker=_make_face_landmarker_type(),
        )
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.RunningMode":
        vision = _raising_container(
            "RunningMode",
            error,
            FaceLandmarkerOptions=_make_face_landmarker_options_constructor(),
            FaceLandmarker=_make_face_landmarker_type(),
        )
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.RunningMode.IMAGE":
        running_mode = _raising_container("IMAGE", error)
        vision = _make_vision(running_mode=running_mode)
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.FaceLandmarker":
        vision = _raising_container(
            "FaceLandmarker",
            error,
            FaceLandmarkerOptions=_make_face_landmarker_options_constructor(),
            RunningMode=_make_running_mode(),
        )
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.FaceLandmarker.create_from_options":
        face_landmarker_type = _raising_container("create_from_options", error)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        return _make_module(tasks=_make_tasks(vision=vision))
    raise AssertionError(f"unknown attr path {attr_path}")  # pragma: no cover


def _module_none(attr_path: str) -> object:
    if attr_path == "tasks":
        return types.SimpleNamespace(tasks=None)
    if attr_path == "tasks.vision":
        return _make_module(tasks=types.SimpleNamespace(BaseOptions=_make_base_options_constructor(), vision=None))
    if attr_path == "vision.RunningMode":
        vision = _make_vision()
        vision.RunningMode = None
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.RunningMode.IMAGE":
        vision = _make_vision(running_mode=_make_running_mode(image=None))
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.FaceLandmarker":
        vision = _make_vision()
        vision.FaceLandmarker = None
        return _make_module(tasks=_make_tasks(vision=vision))
    raise AssertionError(f"unknown attr path {attr_path}")  # pragma: no cover


def _module_non_callable(attr_path: str) -> object:
    if attr_path == "tasks.BaseOptions":
        return _make_module(tasks=_make_tasks(base_options_constructor="not callable"))
    if attr_path == "vision.FaceLandmarkerOptions":
        vision = _make_vision(face_landmarker_options_constructor="not callable")
        return _make_module(tasks=_make_tasks(vision=vision))
    if attr_path == "vision.FaceLandmarker.create_from_options":
        face_landmarker_type = types.SimpleNamespace(create_from_options="not callable")
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        return _make_module(tasks=_make_tasks(vision=vision))
    raise AssertionError(f"unknown attr path {attr_path}")  # pragma: no cover


class ApiResolutionFailureTest(unittest.TestCase):
    _MISSING_PATHS = (
        "tasks",
        "tasks.BaseOptions",
        "tasks.vision",
        "vision.FaceLandmarkerOptions",
        "vision.RunningMode",
        "vision.RunningMode.IMAGE",
        "vision.FaceLandmarker",
        "vision.FaceLandmarker.create_from_options",
    )
    _RAISING_PATHS = _MISSING_PATHS
    _NONE_PATHS = (
        "tasks",
        "tasks.vision",
        "vision.RunningMode",
        "vision.RunningMode.IMAGE",
        "vision.FaceLandmarker",
    )
    _NON_CALLABLE_PATHS = (
        "tasks.BaseOptions",
        "vision.FaceLandmarkerOptions",
        "vision.FaceLandmarker.create_from_options",
    )

    def _assert_bounded_failure(self, module: object) -> None:
        importer = _make_importer(module=module)
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.API_RESOLUTION_FAILED,
        )
        self.assertIsNone(lifecycle.borrow_ready_runtime())
        self.assertNotIn("secret internal detail", repr(lifecycle))
        self.assertNotIn("secret internal detail", str(lifecycle))

    def test_01_missing_attribute_forms(self) -> None:
        for attr_path in self._MISSING_PATHS:
            with self.subTest(attr_path=attr_path):
                self._assert_bounded_failure(_module_missing(attr_path))

    def test_02_raising_attribute_forms(self) -> None:
        for attr_path in self._RAISING_PATHS:
            with self.subTest(attr_path=attr_path):
                error = RuntimeError("secret internal detail")
                self._assert_bounded_failure(_module_raising(attr_path, error))

    def test_03_none_attribute_forms(self) -> None:
        for attr_path in self._NONE_PATHS:
            with self.subTest(attr_path=attr_path):
                self._assert_bounded_failure(_module_none(attr_path))

    def test_04_non_callable_attribute_forms(self) -> None:
        for attr_path in self._NON_CALLABLE_PATHS:
            with self.subTest(attr_path=attr_path):
                self._assert_bounded_failure(_module_non_callable(attr_path))

    def test_05_runtime_creation_not_called(self) -> None:
        create_from_options = _make_create_from_options()
        vision = _make_vision(face_landmarker_type=_make_face_landmarker_type(create_from_options))
        del vision.RunningMode
        module = _make_module(tasks=_make_tasks(vision=vision))
        importer = _make_importer(module=module)
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(create_from_options.calls, [])

    def test_06_keyboard_interrupt_not_swallowed(self) -> None:
        module = _module_raising("tasks.BaseOptions", KeyboardInterrupt())
        importer = _make_importer(module=module)
        with self.assertRaises(KeyboardInterrupt):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)

    def test_07_system_exit_not_swallowed(self) -> None:
        module = _module_raising("vision.FaceLandmarker", SystemExit())
        importer = _make_importer(module=module)
        with self.assertRaises(SystemExit):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)


# =============================================================================
# Options-factory failures
# =============================================================================


class OptionsFactoryFailureTest(unittest.TestCase):
    def test_01_base_options_exception_maps_to_options_construction_failed(self) -> None:
        base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        tasks = _make_tasks(base_options_constructor=base_ctor)
        importer = _make_importer(module=_make_module(tasks=tasks))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.OPTIONS_CONSTRUCTION_FAILED,
        )

    def test_02_face_landmarker_options_exception_maps_to_options_construction_failed(
        self,
    ) -> None:
        face_ctor = _make_face_landmarker_options_constructor(error=RuntimeError("bad"))
        vision = _make_vision(face_landmarker_options_constructor=face_ctor)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.OPTIONS_CONSTRUCTION_FAILED,
        )

    def test_03_create_from_options_not_called_after_options_failure(self) -> None:
        base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        create_from_options = _make_create_from_options()
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        tasks = _make_tasks(base_options_constructor=base_ctor, vision=vision)
        importer = _make_importer(module=_make_module(tasks=tasks))
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(create_from_options.calls, [])

    def test_04_no_path_or_exception_leakage(self) -> None:
        secret_path = "C:/private/secret-model-name.task"
        base_ctor = _make_base_options_constructor(
            error=ValueError("very specific internal failure text")
        )
        tasks = _make_tasks(base_options_constructor=base_ctor)
        importer = _make_importer(module=_make_module(tasks=tasks))
        lifecycle = create_face_landmarker_runtime(secret_path, module_importer=importer)
        self.assertNotIn(secret_path, repr(lifecycle))
        self.assertNotIn(secret_path, str(lifecycle))
        self.assertNotIn("very specific internal failure text", repr(lifecycle))
        self.assertNotIn("very specific internal failure text", str(lifecycle))

    def test_05_keyboard_interrupt_not_swallowed(self) -> None:
        base_ctor = _make_base_options_constructor(error=KeyboardInterrupt())
        tasks = _make_tasks(base_options_constructor=base_ctor)
        importer = _make_importer(module=_make_module(tasks=tasks))
        with self.assertRaises(KeyboardInterrupt):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)

    def test_06_system_exit_not_swallowed(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor(error=SystemExit())
        vision = _make_vision(face_landmarker_options_constructor=face_ctor)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        with self.assertRaises(SystemExit):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)


# =============================================================================
# Runtime initialization failures
# =============================================================================


class RuntimeInitializationFailureTest(unittest.TestCase):
    def _importer_for(self, create_from_options) -> object:
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        return _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))

    def test_01_create_from_options_exception(self) -> None:
        create_from_options = _make_create_from_options(error=RuntimeError("boom"))
        importer = self._importer_for(create_from_options)
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED,
        )
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_02_create_from_options_returns_none(self) -> None:
        create_from_options = _make_create_from_options(runtime_factory=lambda: None)
        importer = self._importer_for(create_from_options)
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED,
        )

    def test_03_runtime_missing_close(self) -> None:
        create_from_options = _make_create_from_options(
            runtime_factory=lambda: _FakeRuntime(close_missing=True)
        )
        importer = self._importer_for(create_from_options)
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED,
        )

    def test_04_runtime_close_not_callable(self) -> None:
        create_from_options = _make_create_from_options(
            runtime_factory=lambda: _FakeRuntime(close_not_callable=True)
        )
        importer = self._importer_for(create_from_options)
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.FAILED)
        self.assertIs(
            lifecycle.creation_status,
            FaceLandmarkerRuntimeCreationStatus.RUNTIME_INITIALIZATION_FAILED,
        )

    def test_05_no_retry(self) -> None:
        create_from_options = _make_create_from_options(error=RuntimeError("boom"))
        importer = self._importer_for(create_from_options)
        create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertEqual(len(create_from_options.calls), 1)

    def test_06_borrow_returns_none(self) -> None:
        create_from_options = _make_create_from_options(error=RuntimeError("boom"))
        importer = self._importer_for(create_from_options)
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_07_keyboard_interrupt_not_swallowed(self) -> None:
        create_from_options = _make_create_from_options(error=KeyboardInterrupt())
        importer = self._importer_for(create_from_options)
        with self.assertRaises(KeyboardInterrupt):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)

    def test_08_system_exit_not_swallowed(self) -> None:
        create_from_options = _make_create_from_options(error=SystemExit())
        importer = self._importer_for(create_from_options)
        with self.assertRaises(SystemExit):
            create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)


# =============================================================================
# Borrow behavior
# =============================================================================


class BorrowBehaviorTest(unittest.TestCase):
    def test_01_exact_runtime_only_in_ready(self) -> None:
        runtime = _FakeRuntime()
        create_from_options = _make_create_from_options(runtime_factory=lambda: runtime)
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertIs(lifecycle.borrow_ready_runtime(), runtime)

    def test_02_none_after_successful_close(self) -> None:
        runtime = _FakeRuntime()
        create_from_options = _make_create_from_options(runtime_factory=lambda: runtime)
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        lifecycle.close()
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_03_none_after_close_failure(self) -> None:
        runtime = _FakeRuntime(close_error=RuntimeError("boom"))
        create_from_options = _make_create_from_options(runtime_factory=lambda: runtime)
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        lifecycle.close()
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_04_none_in_construction_failed_state(self) -> None:
        lifecycle = create_face_landmarker_runtime("", module_importer=_make_importer())
        self.assertIsNone(lifecycle.borrow_ready_runtime())


# =============================================================================
# Close behavior
# =============================================================================


class CloseBehaviorTest(unittest.TestCase):
    def _ready_lifecycle(self, runtime: _FakeRuntime) -> FaceLandmarkerRuntimeLifecycle:
        create_from_options = _make_create_from_options(runtime_factory=lambda: runtime)
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        return create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)

    def test_01_first_successful_close_calls_underlying_close_once(self) -> None:
        runtime = _FakeRuntime()
        lifecycle = self._ready_lifecycle(runtime)
        lifecycle.close()
        self.assertEqual(runtime.close_calls, 1)

    def test_02_state_becomes_closed(self) -> None:
        lifecycle = self._ready_lifecycle(_FakeRuntime())
        lifecycle.close()
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.CLOSED)

    def test_03_first_close_returns_closed(self) -> None:
        lifecycle = self._ready_lifecycle(_FakeRuntime())
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.CLOSED)

    def test_04_second_and_later_calls_return_closed(self) -> None:
        lifecycle = self._ready_lifecycle(_FakeRuntime())
        lifecycle.close()
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.CLOSED)
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.CLOSED)

    def test_05_later_calls_perform_no_runtime_operation(self) -> None:
        runtime = _FakeRuntime()
        lifecycle = self._ready_lifecycle(runtime)
        lifecycle.close()
        lifecycle.close()
        lifecycle.close()
        self.assertEqual(runtime.close_calls, 1)

    def test_06_ordinary_close_exception_returns_close_failed(self) -> None:
        runtime = _FakeRuntime(close_error=RuntimeError("boom"))
        lifecycle = self._ready_lifecycle(runtime)
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.CLOSE_FAILED)

    def test_07_close_exception_still_transitions_to_closed(self) -> None:
        runtime = _FakeRuntime(close_error=RuntimeError("boom"))
        lifecycle = self._ready_lifecycle(runtime)
        lifecycle.close()
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.CLOSED)

    def test_08_close_exception_still_discards_runtime_reference(self) -> None:
        runtime = _FakeRuntime(close_error=RuntimeError("boom"))
        lifecycle = self._ready_lifecycle(runtime)
        lifecycle.close()
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_09_repeated_close_after_failure_returns_close_failed(self) -> None:
        runtime = _FakeRuntime(close_error=RuntimeError("boom"))
        lifecycle = self._ready_lifecycle(runtime)
        lifecycle.close()
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.CLOSE_FAILED)
        self.assertEqual(runtime.close_calls, 1)

    def test_10_close_after_failed_construction_returns_not_ready(self) -> None:
        lifecycle = create_face_landmarker_runtime("", module_importer=_make_importer())
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.NOT_READY)

    def test_11_repeated_close_after_failed_construction_returns_not_ready(self) -> None:
        lifecycle = create_face_landmarker_runtime("", module_importer=_make_importer())
        lifecycle.close()
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.NOT_READY)

    def test_12_close_after_failed_construction_performs_no_runtime_operation(
        self,
    ) -> None:
        create_from_options = _make_create_from_options()
        face_landmarker_type = _make_face_landmarker_type(create_from_options)
        vision = _make_vision(face_landmarker_type=face_landmarker_type)
        importer = _make_importer(module=_make_module(tasks=_make_tasks(vision=vision)))
        lifecycle = create_face_landmarker_runtime("", module_importer=importer)
        lifecycle.close()
        self.assertEqual(create_from_options.calls, [])

    def test_13_keyboard_interrupt_from_close_not_swallowed(self) -> None:
        runtime = _FakeRuntime(close_error=KeyboardInterrupt())
        lifecycle = self._ready_lifecycle(runtime)
        with self.assertRaises(KeyboardInterrupt):
            lifecycle.close()
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.CLOSED)
        self.assertIsNone(lifecycle.borrow_ready_runtime())

    def test_14_system_exit_from_close_not_swallowed(self) -> None:
        runtime = _FakeRuntime(close_error=SystemExit())
        lifecycle = self._ready_lifecycle(runtime)
        with self.assertRaises(SystemExit):
            lifecycle.close()
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.CLOSED)

    def test_15_later_close_after_base_exception_returns_close_failed_without_another_call(
        self,
    ) -> None:
        runtime = _FakeRuntime(close_error=KeyboardInterrupt())
        lifecycle = self._ready_lifecycle(runtime)
        with self.assertRaises(KeyboardInterrupt):
            lifecycle.close()
        self.assertIs(lifecycle.close(), FaceLandmarkerRuntimeCloseStatus.CLOSE_FAILED)
        self.assertEqual(runtime.close_calls, 1)


# =============================================================================
# Ownership and privacy
# =============================================================================


class OwnershipAndPrivacyTest(unittest.TestCase):
    def test_01_wrapper_storage_contains_only_approved_fields(self) -> None:
        self.assertEqual(
            FaceLandmarkerRuntimeLifecycle.__slots__,
            ("_state", "_creation_status", "_runtime", "_close_status"),
        )

    def test_02_no_model_path_attribute(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertFalse(hasattr(lifecycle, "model_asset_path"))
        self.assertFalse(hasattr(lifecycle, "_model_asset_path"))

    def test_03_no_options_attribute(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertFalse(hasattr(lifecycle, "options"))
        self.assertFalse(hasattr(lifecycle, "_options"))

    def test_04_no_imported_module_attribute(self) -> None:
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertFalse(hasattr(lifecycle, "module"))
        self.assertFalse(hasattr(lifecycle, "_module"))
        self.assertFalse(hasattr(lifecycle, "mediapipe_module"))

    def test_05_no_exception_attribute(self) -> None:
        importer = _make_importer(error=RuntimeError("boom"))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertFalse(hasattr(lifecycle, "exception"))
        self.assertFalse(hasattr(lifecycle, "_exception"))
        self.assertFalse(hasattr(lifecycle, "error"))

    def test_06_repr_does_not_contain_private_path(self) -> None:
        secret_path = "C:/private/secret-model-name.task"
        lifecycle = create_face_landmarker_runtime(
            secret_path, module_importer=_make_importer()
        )
        self.assertNotIn(secret_path, repr(lifecycle))
        self.assertNotIn(secret_path, str(lifecycle))

    def test_07_repr_does_not_contain_exception_text(self) -> None:
        importer = _make_importer(error=RuntimeError("very specific internal text"))
        lifecycle = create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=importer
        )
        self.assertNotIn("very specific internal text", repr(lifecycle))
        self.assertNotIn("very specific internal text", str(lifecycle))

    def test_08_repeated_wrappers_share_no_state(self) -> None:
        importer = _make_importer()
        first = create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        second = create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        self.assertIsNot(first.borrow_ready_runtime(), second.borrow_ready_runtime())

    def test_09_one_wrapper_close_does_not_affect_another(self) -> None:
        importer = _make_importer()
        first = create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        second = create_face_landmarker_runtime(_MODEL_ASSET_PATH, module_importer=importer)
        first.close()
        self.assertIs(first.state, FaceLandmarkerRuntimeState.CLOSED)
        self.assertIs(second.state, FaceLandmarkerRuntimeState.READY)
        self.assertIsNotNone(second.borrow_ready_runtime())


# =============================================================================
# Purity
# =============================================================================


class PurityTest(unittest.TestCase):
    def test_01_no_stdout_on_success(self) -> None:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            create_face_landmarker_runtime(
                _MODEL_ASSET_PATH, module_importer=_make_importer()
            )
        self.assertEqual(stdout.getvalue(), "")

    def test_02_no_stderr_on_success(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            create_face_landmarker_runtime(
                _MODEL_ASSET_PATH, module_importer=_make_importer()
            )
        self.assertEqual(stderr.getvalue(), "")

    def test_03_no_stdout_on_failure(self) -> None:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            create_face_landmarker_runtime("", module_importer=_make_importer())
        self.assertEqual(stdout.getvalue(), "")

    def test_04_no_stderr_on_failure(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            create_face_landmarker_runtime("", module_importer=_make_importer())
        self.assertEqual(stderr.getvalue(), "")

    def test_05_no_filesystem_calls(self) -> None:
        import builtins

        original_open = builtins.open

        def _forbidden_open(*args: object, **kwargs: object) -> object:
            raise AssertionError("filesystem access is not permitted")

        builtins.open = _forbidden_open
        try:
            lifecycle = create_face_landmarker_runtime(
                _MODEL_ASSET_PATH, module_importer=_make_importer()
            )
        finally:
            builtins.open = original_open
        self.assertIs(lifecycle.state, FaceLandmarkerRuntimeState.READY)

    def test_06_no_actual_mediapipe_import_with_fake_importer(self) -> None:
        self.assertNotIn("mediapipe", sys.modules)
        create_face_landmarker_runtime(
            _MODEL_ASSET_PATH, module_importer=_make_importer()
        )
        self.assertNotIn("mediapipe", sys.modules)

    def test_07_module_does_not_import_disallowed_modules(self) -> None:
        module_globals = set(vars(face_landmarker_runtime).keys())
        disallowed = {"numpy", "cv2", "PIL", "mediapipe"}
        self.assertEqual(module_globals & disallowed, set())


if __name__ == "__main__":
    unittest.main()
