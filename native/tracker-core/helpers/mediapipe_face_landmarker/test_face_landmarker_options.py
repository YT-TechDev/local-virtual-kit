"""Standard-library tests for face_landmarker_options.py.

Run directly: python -B test_face_landmarker_options.py
"""

from __future__ import annotations

import contextlib
import io
import sys
import unittest
from dataclasses import FrozenInstanceError

import face_landmarker_options
from face_landmarker_options import (
    FaceLandmarkerOptionsApi,
    FaceLandmarkerOptionsFactoryOutcome,
    FaceLandmarkerOptionsFactoryStatus,
    create_face_landmarker_options,
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


class _FaceLandmarkerOptionsApiSubclass(FaceLandmarkerOptionsApi):
    pass


class _ConstructedBaseOptions:
    def __init__(self, kwargs: dict) -> None:
        self.kwargs = kwargs


class _ConstructedFaceLandmarkerOptions:
    def __init__(self, kwargs: dict) -> None:
        self.kwargs = kwargs


def _make_base_options_constructor(error: Exception | None = None):
    calls: list = []

    def constructor(**kwargs: object) -> object:
        calls.append(kwargs)
        if error is not None:
            raise error
        return _ConstructedBaseOptions(kwargs)

    constructor.calls = calls
    return constructor


def _make_face_landmarker_options_constructor(error: Exception | None = None):
    calls: list = []

    def constructor(**kwargs: object) -> object:
        calls.append(kwargs)
        if error is not None:
            raise error
        return _ConstructedFaceLandmarkerOptions(kwargs)

    constructor.calls = calls
    return constructor


def _make_api(
    *,
    base_options_constructor=None,
    face_landmarker_options_constructor=None,
    image_running_mode: object = _IMAGE_SENTINEL,
) -> FaceLandmarkerOptionsApi:
    if base_options_constructor is None:
        base_options_constructor = _make_base_options_constructor()
    if face_landmarker_options_constructor is None:
        face_landmarker_options_constructor = _make_face_landmarker_options_constructor()
    return FaceLandmarkerOptionsApi(
        base_options_constructor=base_options_constructor,
        face_landmarker_options_constructor=face_landmarker_options_constructor,
        image_running_mode=image_running_mode,
    )


# =============================================================================
# Success outcome and construction shape
# =============================================================================


class SuccessOutcomeTest(unittest.TestCase):
    def test_01_exact_outcome_type(self) -> None:
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        self.assertIs(type(result), FaceLandmarkerOptionsFactoryOutcome)

    def test_02_status_is_success(self) -> None:
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        self.assertIs(result.status, FaceLandmarkerOptionsFactoryStatus.SUCCESS)

    def test_03_options_is_constructor_return_value(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertIs(type(result.options), _ConstructedFaceLandmarkerOptions)

    def test_04_api_is_frozen(self) -> None:
        api = _make_api()
        with self.assertRaises(FrozenInstanceError):
            api.image_running_mode = object()  # type: ignore[misc]

    def test_05_outcome_is_frozen(self) -> None:
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        with self.assertRaises(FrozenInstanceError):
            result.options = None  # type: ignore[misc]


# =============================================================================
# Exact constructor call shape
# =============================================================================


class ConstructorCallShapeTest(unittest.TestCase):
    def test_01_base_options_kwargs_exact(self) -> None:
        base_ctor = _make_base_options_constructor()
        api = _make_api(base_options_constructor=base_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(
            base_ctor.calls, [{"model_asset_path": _MODEL_ASSET_PATH}]
        )

    def test_02_face_landmarker_options_kwargs_exact(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(len(face_ctor.calls), 1)
        kwargs = face_ctor.calls[0]
        self.assertIs(type(kwargs["base_options"]), _ConstructedBaseOptions)
        self.assertEqual(
            {key: value for key, value in kwargs.items() if key != "base_options"},
            {
                "running_mode": _IMAGE_SENTINEL,
                "num_faces": 1,
                "min_face_detection_confidence": 0.5,
                "min_face_presence_confidence": 0.5,
                "min_tracking_confidence": 0.5,
                "output_face_blendshapes": True,
                "output_facial_transformation_matrixes": True,
            },
        )

    def test_03_running_mode_sentinel_identity(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertIs(face_ctor.calls[0]["running_mode"], _IMAGE_SENTINEL)

    def test_04_no_result_callback(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertNotIn("result_callback", face_ctor.calls[0])

    def test_05_base_options_constructor_called_exactly_once(self) -> None:
        base_ctor = _make_base_options_constructor()
        api = _make_api(base_options_constructor=base_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(len(base_ctor.calls), 1)

    def test_06_face_landmarker_options_constructor_called_exactly_once(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(len(face_ctor.calls), 1)


# =============================================================================
# Model asset path validation
# =============================================================================


class ModelAssetPathValidationTest(unittest.TestCase):
    def _assert_rejected(self, model_asset_path: object) -> None:
        result = create_face_landmarker_options(model_asset_path, _make_api())
        self.assertIs(
            result.status,
            FaceLandmarkerOptionsFactoryStatus.INVALID_MODEL_ASSET_PATH,
        )
        self.assertIsNone(result.options)

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

    def test_07_bytearray_rejected(self) -> None:
        self._assert_rejected(bytearray(b"model.task"))

    def test_08_path_like_object_rejected(self) -> None:
        self._assert_rejected(_PathLike(_MODEL_ASSET_PATH))

    def test_09_string_subclass_rejected(self) -> None:
        self._assert_rejected(_StrSubclass(_MODEL_ASSET_PATH))

    def test_10_bytes_subclass_rejected(self) -> None:
        self._assert_rejected(_BytesSubclass(b"model.task"))

    def test_11_whitespace_only_string_passed_unchanged(self) -> None:
        base_ctor = _make_base_options_constructor()
        api = _make_api(base_options_constructor=base_ctor)
        result = create_face_landmarker_options("   ", api)
        self.assertIs(result.status, FaceLandmarkerOptionsFactoryStatus.SUCCESS)
        self.assertEqual(base_ctor.calls, [{"model_asset_path": "   "}])


# =============================================================================
# Injected API validation
# =============================================================================


class ApiValidationTest(unittest.TestCase):
    def _assert_rejected(self, api: object) -> None:
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertIs(
            result.status, FaceLandmarkerOptionsFactoryStatus.INVALID_API_SURFACE
        )
        self.assertIsNone(result.options)

    def test_01_none_api_rejected(self) -> None:
        self._assert_rejected(None)

    def test_02_wrong_type_api_rejected(self) -> None:
        self._assert_rejected({"base_options_constructor": lambda **_: object()})

    def test_03_api_subclass_rejected(self) -> None:
        api = _FaceLandmarkerOptionsApiSubclass(
            base_options_constructor=_make_base_options_constructor(),
            face_landmarker_options_constructor=(
                _make_face_landmarker_options_constructor()
            ),
            image_running_mode=_IMAGE_SENTINEL,
        )
        self._assert_rejected(api)

    def test_04_non_callable_base_options_constructor_rejected(self) -> None:
        api = _make_api(base_options_constructor="not callable")
        self._assert_rejected(api)

    def test_05_non_callable_face_landmarker_options_constructor_rejected(
        self,
    ) -> None:
        api = _make_api(face_landmarker_options_constructor="not callable")
        self._assert_rejected(api)

    def test_06_none_image_running_mode_rejected(self) -> None:
        api = _make_api(image_running_mode=None)
        self._assert_rejected(api)


# =============================================================================
# No constructor calls on invalid input
# =============================================================================


class NoConstructorCallsOnInvalidInputTest(unittest.TestCase):
    def test_01_invalid_path_calls_neither_constructor(self) -> None:
        base_ctor = _make_base_options_constructor()
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(
            base_options_constructor=base_ctor,
            face_landmarker_options_constructor=face_ctor,
        )
        create_face_landmarker_options("", api)
        self.assertEqual(base_ctor.calls, [])
        self.assertEqual(face_ctor.calls, [])

    def test_02_invalid_api_calls_neither_constructor(self) -> None:
        base_ctor = _make_base_options_constructor()
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(
            base_options_constructor=base_ctor,
            face_landmarker_options_constructor=face_ctor,
            image_running_mode=None,
        )
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(base_ctor.calls, [])
        self.assertEqual(face_ctor.calls, [])


# =============================================================================
# Bounded construction failures
# =============================================================================


class ConstructionFailureTest(unittest.TestCase):
    def test_01_base_options_exception_maps_to_bounded_failure(self) -> None:
        base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        api = _make_api(base_options_constructor=base_ctor)
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertIs(
            result.status,
            FaceLandmarkerOptionsFactoryStatus.BASE_OPTIONS_CONSTRUCTION_FAILED,
        )
        self.assertIsNone(result.options)

    def test_02_face_landmarker_options_not_called_after_base_options_failure(
        self,
    ) -> None:
        base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        face_ctor = _make_face_landmarker_options_constructor()
        api = _make_api(
            base_options_constructor=base_ctor,
            face_landmarker_options_constructor=face_ctor,
        )
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(face_ctor.calls, [])

    def test_03_face_landmarker_options_exception_maps_to_bounded_failure(
        self,
    ) -> None:
        face_ctor = _make_face_landmarker_options_constructor(error=RuntimeError("bad"))
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertIs(
            result.status,
            (
                FaceLandmarkerOptionsFactoryStatus
                .FACE_LANDMARKER_OPTIONS_CONSTRUCTION_FAILED
            ),
        )
        self.assertIsNone(result.options)


# =============================================================================
# No leakage of path or exception content
# =============================================================================


class NoLeakageTest(unittest.TestCase):
    def test_01_path_not_in_outcome_repr(self) -> None:
        secret_path = "C:/private/secret-model-name.task"
        base_ctor = _make_base_options_constructor(error=ValueError(secret_path))
        api = _make_api(base_options_constructor=base_ctor)
        result = create_face_landmarker_options(secret_path, api)
        self.assertNotIn(secret_path, repr(result))
        self.assertNotIn(secret_path, str(result))

    def test_02_exception_text_not_in_outcome_repr(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor(
            error=RuntimeError("very specific internal failure text")
        )
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        result = create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertNotIn("very specific internal failure text", repr(result))
        self.assertNotIn("very specific internal failure text", str(result))

    def test_03_no_stdout_on_success(self) -> None:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        self.assertEqual(stdout.getvalue(), "")

    def test_04_no_stderr_on_success(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        self.assertEqual(stderr.getvalue(), "")

    def test_05_no_stdout_on_construction_failure(self) -> None:
        base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        api = _make_api(base_options_constructor=base_ctor)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(stdout.getvalue(), "")

    def test_06_no_stderr_on_construction_failure(self) -> None:
        base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        api = _make_api(base_options_constructor=base_ctor)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(stderr.getvalue(), "")


# =============================================================================
# Exception propagation for BaseException subclasses
# =============================================================================


class ExceptionPropagationTest(unittest.TestCase):
    def test_01_keyboard_interrupt_not_swallowed_from_base_options(self) -> None:
        base_ctor = _make_base_options_constructor(error=KeyboardInterrupt())
        api = _make_api(base_options_constructor=base_ctor)
        with self.assertRaises(KeyboardInterrupt):
            create_face_landmarker_options(_MODEL_ASSET_PATH, api)

    def test_02_system_exit_not_swallowed_from_base_options(self) -> None:
        base_ctor = _make_base_options_constructor(error=SystemExit())
        api = _make_api(base_options_constructor=base_ctor)
        with self.assertRaises(SystemExit):
            create_face_landmarker_options(_MODEL_ASSET_PATH, api)

    def test_03_keyboard_interrupt_not_swallowed_from_face_landmarker_options(
        self,
    ) -> None:
        face_ctor = _make_face_landmarker_options_constructor(error=KeyboardInterrupt())
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        with self.assertRaises(KeyboardInterrupt):
            create_face_landmarker_options(_MODEL_ASSET_PATH, api)

    def test_04_system_exit_not_swallowed_from_face_landmarker_options(self) -> None:
        face_ctor = _make_face_landmarker_options_constructor(error=SystemExit())
        api = _make_api(face_landmarker_options_constructor=face_ctor)
        with self.assertRaises(SystemExit):
            create_face_landmarker_options(_MODEL_ASSET_PATH, api)


# =============================================================================
# No shared or retained state
# =============================================================================


class NoSharedStateTest(unittest.TestCase):
    def test_01_repeated_calls_share_no_constructor_state(self) -> None:
        base_ctor = _make_base_options_constructor()
        api = _make_api(base_options_constructor=base_ctor)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        create_face_landmarker_options(_MODEL_ASSET_PATH, api)
        self.assertEqual(len(base_ctor.calls), 2)

    def test_02_failed_call_does_not_affect_next_successful_call(self) -> None:
        failing_base_ctor = _make_base_options_constructor(error=ValueError("boom"))
        failing_api = _make_api(base_options_constructor=failing_base_ctor)
        first_result = create_face_landmarker_options(_MODEL_ASSET_PATH, failing_api)
        self.assertIs(
            first_result.status,
            FaceLandmarkerOptionsFactoryStatus.BASE_OPTIONS_CONSTRUCTION_FAILED,
        )

        second_result = create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        self.assertIs(
            second_result.status, FaceLandmarkerOptionsFactoryStatus.SUCCESS
        )

    def test_03_module_has_no_cache_attribute(self) -> None:
        module_attrs = set(vars(face_landmarker_options).keys())
        suspicious_names = {"_cache", "_current", "_state", "_last"}
        self.assertEqual(module_attrs & suspicious_names, set())


# =============================================================================
# No filesystem access or MediaPipe import
# =============================================================================


class NoFilesystemOrImportTest(unittest.TestCase):
    def test_01_no_open_call_on_success(self) -> None:
        import builtins

        original_open = builtins.open

        def _forbidden_open(*args: object, **kwargs: object) -> object:
            raise AssertionError("filesystem access is not permitted")

        builtins.open = _forbidden_open
        try:
            result = create_face_landmarker_options(_MODEL_ASSET_PATH, _make_api())
        finally:
            builtins.open = original_open
        self.assertIs(result.status, FaceLandmarkerOptionsFactoryStatus.SUCCESS)

    def test_02_mediapipe_not_imported_by_module(self) -> None:
        self.assertNotIn("mediapipe", sys.modules)

    def test_03_module_does_not_import_disallowed_modules(self) -> None:
        module_globals = set(vars(face_landmarker_options).keys())
        disallowed = {"os", "pathlib", "mediapipe", "numpy", "cv2", "PIL"}
        self.assertEqual(module_globals & disallowed, set())


if __name__ == "__main__":
    unittest.main()
