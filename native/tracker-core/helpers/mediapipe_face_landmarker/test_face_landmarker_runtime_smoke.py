"""Standard-library fake-based tests for face_landmarker_runtime_smoke.py.

Run directly: python -B test_face_landmarker_runtime_smoke.py

These tests use strict fakes and synthetic MediaPipe-like objects only.
They do not import or install real NumPy or MediaPipe and claim only
fake-based orchestration, opt-in/configuration, and sanitized-evidence
behavior: no real MediaPipe compatibility, model behavior, inference
quality, tracking quality, or camera behavior is proven here.
"""

from __future__ import annotations

import contextlib
import dataclasses
import io
import json
import math
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

import face_landmarker_runtime_smoke as smoke
from face_landmarker_runtime import FaceLandmarkerRuntimeCreationStatus
from face_landmarker_runtime_smoke import (
    SmokeReport,
    SmokeStatus,
    build_skipped_report,
    is_opted_in,
    main,
    run_real_local_smoke,
    serialize_smoke_report,
)

_SECRET_PATH = "C:/private/secret-model-name.task"
_SECRET_TEXT = "very specific secret failure text"


# =============================================================================
# Fakes
# =============================================================================


def _identity_matrix() -> list:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


class _FakeCategory:
    def __init__(self, category_name: str, score: float) -> None:
        self.category_name = category_name
        self.score = score


def _full_categories() -> list:
    return [
        _FakeCategory("eyeBlinkLeft", 0.0),
        _FakeCategory("eyeBlinkRight", 0.0),
        _FakeCategory("jawOpen", 0.0),
        _FakeCategory("mouthSmileLeft", 0.0),
        _FakeCategory("mouthSmileRight", 0.0),
    ]


class _FakeCandidateResult:
    def __init__(self, face_landmarks, face_blendshapes, facial_transformation_matrixes) -> None:
        self.face_landmarks = face_landmarks
        self.face_blendshapes = face_blendshapes
        self.facial_transformation_matrixes = facial_transformation_matrixes


def _no_face_result() -> _FakeCandidateResult:
    return _FakeCandidateResult([], [], [])


def _single_face_result() -> _FakeCandidateResult:
    return _FakeCandidateResult([object()], [_full_categories()], [_identity_matrix()])


class _FakeFlatArray:
    def __init__(self, dtype: object) -> None:
        self._dtype = dtype

    def reshape(self, shape: object) -> "_FakeArray":
        return _FakeArray(shape, self._dtype, True)


class _FakeArray:
    def __init__(self, shape: object, dtype: object, c_contiguous: bool) -> None:
        self.shape = shape
        self.dtype = dtype
        self.flags = types.SimpleNamespace(c_contiguous=c_contiguous)


def _make_fake_numpy_module() -> object:
    uint8_sentinel = object()

    def frombuffer(data: object, dtype: object) -> object:
        return _FakeFlatArray(dtype)

    def ascontiguousarray(array: object, dtype: object) -> object:
        return _FakeArray(array.shape, dtype, True)

    return types.SimpleNamespace(
        frombuffer=frombuffer, uint8=uint8_sentinel, ascontiguousarray=ascontiguousarray
    )


class _FakeRuntime:
    def __init__(self, *, detect=None, close_error: Exception | None = None) -> None:
        self.close_calls = 0
        self._close_error = close_error
        self.detect = detect if detect is not None else (lambda image: _no_face_result())

    def close(self) -> None:
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error


def _make_fake_mediapipe_module(
    *,
    version: object = "0.10.99",
    runtime: object | None = None,
    create_from_options_error: Exception | None = None,
) -> object:
    if runtime is None:
        runtime = _FakeRuntime()

    def create_from_options(options: object) -> object:
        if create_from_options_error is not None:
            raise create_from_options_error
        return runtime

    face_landmarker_type = types.SimpleNamespace(create_from_options=create_from_options)
    vision = types.SimpleNamespace(
        FaceLandmarkerOptions=lambda **kwargs: types.SimpleNamespace(kwargs=kwargs),
        RunningMode=types.SimpleNamespace(IMAGE=object()),
        FaceLandmarker=face_landmarker_type,
    )
    tasks = types.SimpleNamespace(
        BaseOptions=lambda **kwargs: types.SimpleNamespace(kwargs=kwargs), vision=vision
    )
    module = types.SimpleNamespace(
        tasks=tasks,
        Image=lambda *, image_format, data: object(),
        ImageFormat=types.SimpleNamespace(SRGB=object()),
        __version__=version,
    )
    return module


def _make_importer(
    *,
    mediapipe_module: object | None = None,
    numpy_module: object | None = None,
    numpy_error: Exception | None = None,
    mediapipe_error: Exception | None = None,
):
    calls: list = []

    def importer(name: str) -> object:
        calls.append(name)
        if name == "numpy":
            if numpy_error is not None:
                raise numpy_error
            return numpy_module if numpy_module is not None else _make_fake_numpy_module()
        if name == "mediapipe":
            if mediapipe_error is not None:
                raise mediapipe_error
            return mediapipe_module if mediapipe_module is not None else _make_fake_mediapipe_module()
        raise AssertionError(f"unexpected import request: {name}")

    importer.calls = calls
    return importer


class _TempModelFile:
    def __enter__(self) -> str:
        fd, path = tempfile.mkstemp(suffix=".task")
        os.close(fd)
        self._path = path
        return path

    def __exit__(self, *exc_info: object) -> None:
        try:
            os.remove(self._path)
        except OSError:
            pass


# =============================================================================
# Skipped report / serialization
# =============================================================================


class SkippedReportTests(unittest.TestCase):
    def test_shape(self) -> None:
        report = build_skipped_report()
        self.assertIs(report.status, SmokeStatus.SKIPPED)
        self.assertEqual(report.reason, "opt_in_required")
        for field in dataclasses.fields(SmokeReport):
            if field.name in ("status", "reason"):
                continue
            self.assertIsNone(getattr(report, field.name))


class ReportSerializationTests(unittest.TestCase):
    def test_exact_field_set(self) -> None:
        line = serialize_smoke_report(build_skipped_report())
        document = json.loads(line)
        self.assertEqual(
            set(document.keys()),
            {
                "schemaVersion",
                "check",
                "status",
                "reason",
                "pythonVersion",
                "mediapipeVersion",
                "inputCategory",
                "inputWidth",
                "inputHeight",
                "runtimeCreationStatus",
                "inferenceStatus",
                "inferenceMs",
                "payloadStatus",
                "closeStatus",
            },
        )

    def test_schema_version_and_check_name(self) -> None:
        document = json.loads(serialize_smoke_report(build_skipped_report()))
        self.assertEqual(document["schemaVersion"], 1)
        self.assertEqual(document["check"], "mediapipe-face-landmarker-runtime-smoke")

    def test_trailing_newline_exactly_one_line(self) -> None:
        line = serialize_smoke_report(build_skipped_report())
        self.assertTrue(line.endswith("\n"))
        self.assertEqual(line.count("\n"), 1)

    def test_bounded_length(self) -> None:
        line = serialize_smoke_report(build_skipped_report())
        self.assertLessEqual(len(line.encode("utf-8")), 2048)

    def test_deterministic(self) -> None:
        report = build_skipped_report()
        self.assertEqual(serialize_smoke_report(report), serialize_smoke_report(report))

    def test_wrong_type_rejected(self) -> None:
        with self.assertRaises(TypeError):
            serialize_smoke_report({"status": "SKIPPED"})  # type: ignore[arg-type]

    def test_subclass_rejected(self) -> None:
        class _Subclass(SmokeReport):
            pass

        bad = _Subclass(**dataclasses.asdict(build_skipped_report()) | {"status": SmokeStatus.SKIPPED})
        with self.assertRaises(TypeError):
            serialize_smoke_report(bad)


# =============================================================================
# Opt-in
# =============================================================================


class OptInTests(unittest.TestCase):
    def test_exact_one_is_opted_in(self) -> None:
        self.assertTrue(is_opted_in({"LVK_MEDIAPIPE_SMOKE": "1"}))

    def test_missing_is_not_opted_in(self) -> None:
        self.assertFalse(is_opted_in({}))

    def test_zero_is_not_opted_in(self) -> None:
        self.assertFalse(is_opted_in({"LVK_MEDIAPIPE_SMOKE": "0"}))

    def test_true_string_is_not_opted_in(self) -> None:
        self.assertFalse(is_opted_in({"LVK_MEDIAPIPE_SMOKE": "true"}))

    def test_whitespace_padded_is_not_opted_in(self) -> None:
        self.assertFalse(is_opted_in({"LVK_MEDIAPIPE_SMOKE": " 1 "}))


# =============================================================================
# Model asset path configuration
# =============================================================================


class ModelPathResolutionTests(unittest.TestCase):
    def test_missing_env_var_invalid(self) -> None:
        path, reason = smoke._resolve_model_asset_path({})
        self.assertIsNone(path)
        self.assertEqual(reason, "model_configuration_invalid")

    def test_empty_string_invalid(self) -> None:
        path, reason = smoke._resolve_model_asset_path(
            {"LVK_MEDIAPIPE_MODEL_ASSET_PATH": ""}
        )
        self.assertIsNone(path)
        self.assertEqual(reason, "model_configuration_invalid")

    def test_non_string_invalid(self) -> None:
        path, reason = smoke._resolve_model_asset_path(
            {"LVK_MEDIAPIPE_MODEL_ASSET_PATH": 123}
        )
        self.assertIsNone(path)
        self.assertEqual(reason, "model_configuration_invalid")

    def test_nul_rejected(self) -> None:
        path, reason = smoke._resolve_model_asset_path(
            {"LVK_MEDIAPIPE_MODEL_ASSET_PATH": "model\0.task"}
        )
        self.assertIsNone(path)
        self.assertEqual(reason, "model_configuration_invalid")

    def test_relative_path_invalid(self) -> None:
        path, reason = smoke._resolve_model_asset_path(
            {"LVK_MEDIAPIPE_MODEL_ASSET_PATH": "models/face_landmarker.task"}
        )
        self.assertIsNone(path)
        self.assertEqual(reason, "model_configuration_invalid")

    def test_absolute_missing_file_unavailable(self) -> None:
        missing = os.path.join(tempfile.gettempdir(), "lvk-nonexistent-model-99999999.task")
        self.assertFalse(os.path.exists(missing))
        path, reason = smoke._resolve_model_asset_path(
            {"LVK_MEDIAPIPE_MODEL_ASSET_PATH": missing}
        )
        self.assertIsNone(path)
        self.assertEqual(reason, "model_unavailable")

    def test_absolute_existing_file_resolved(self) -> None:
        with _TempModelFile() as model_path:
            path, reason = smoke._resolve_model_asset_path(
                {"LVK_MEDIAPIPE_MODEL_ASSET_PATH": model_path}
            )
            self.assertEqual(path, model_path)
            self.assertIsNone(reason)


# =============================================================================
# Version sanitization
# =============================================================================


class VersionSanitizationTests(unittest.TestCase):
    def test_current_python_version_is_bounded(self) -> None:
        version = smoke._python_version_string()
        self.assertIsNotNone(version)
        self.assertLessEqual(len(version), 32)

    def test_non_string_rejected(self) -> None:
        self.assertIsNone(smoke._sanitize_version(1.0))
        self.assertIsNone(smoke._sanitize_version(None))

    def test_empty_string_rejected(self) -> None:
        self.assertIsNone(smoke._sanitize_version(""))

    def test_overlong_string_rejected(self) -> None:
        self.assertIsNone(smoke._sanitize_version("9" * 33))

    def test_path_like_string_rejected(self) -> None:
        self.assertIsNone(smoke._sanitize_version("C:/private/secret.task"))

    def test_whitespace_rejected(self) -> None:
        self.assertIsNone(smoke._sanitize_version("1.0 dev"))

    def test_simple_semver_accepted(self) -> None:
        self.assertEqual(smoke._sanitize_version("0.10.35"), "0.10.35")


# =============================================================================
# Frame preparation
# =============================================================================


class FramePreparationTests(unittest.TestCase):
    def test_success_shape(self) -> None:
        frame = smoke._prepare_synthetic_frame()
        self.assertIsNotNone(frame)
        self.assertEqual(frame.width, 64)
        self.assertEqual(frame.height, 64)
        self.assertEqual(frame.row_stride_bytes, 192)
        self.assertEqual(frame.payload_bytes, 12288)
        self.assertEqual(frame.request_id, 1)
        self.assertEqual(frame.frame_timestamp_ms, 0)
        self.assertEqual(len(frame.rgb24_bytes), 12288)

    def test_assemble_failure_returns_none(self) -> None:
        with mock.patch.object(
            smoke, "assemble_validated_helper_frame_input", return_value=None
        ):
            self.assertIsNone(smoke._prepare_synthetic_frame())

    def test_convert_failure_returns_none(self) -> None:
        with mock.patch.object(
            smoke, "convert_validated_helper_frame_input_to_rgb24", return_value=None
        ):
            self.assertIsNone(smoke._prepare_synthetic_frame())

    def test_ordinary_exception_returns_none(self) -> None:
        with mock.patch.object(
            smoke, "assemble_validated_helper_frame_input", side_effect=RuntimeError("boom")
        ):
            self.assertIsNone(smoke._prepare_synthetic_frame())


# =============================================================================
# Existing-path orchestration
# =============================================================================


class OrchestrationOrderTests(unittest.TestCase):
    def test_exact_call_order_and_at_most_once_on_success(self) -> None:
        order: list = []

        real_assemble = smoke.assemble_validated_helper_frame_input
        real_convert = smoke.convert_validated_helper_frame_input_to_rgb24
        real_create = smoke.create_face_landmarker_runtime
        real_infer = smoke.run_face_landmarker_single_frame_inference
        real_compose = smoke.compose_face_landmarker_inference_outcome

        def _assemble(*args, **kwargs):
            order.append("assemble")
            return real_assemble(*args, **kwargs)

        def _convert(*args, **kwargs):
            order.append("convert")
            return real_convert(*args, **kwargs)

        def _create(*args, **kwargs):
            order.append("create_runtime")
            return real_create(*args, **kwargs)

        def _infer(*args, **kwargs):
            order.append("inference")
            return real_infer(*args, **kwargs)

        def _compose(*args, **kwargs):
            order.append("composition")
            return real_compose(*args, **kwargs)

        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))

        with mock.patch.object(
            smoke, "assemble_validated_helper_frame_input", side_effect=_assemble
        ), mock.patch.object(
            smoke, "convert_validated_helper_frame_input_to_rgb24", side_effect=_convert
        ), mock.patch.object(
            smoke, "create_face_landmarker_runtime", side_effect=_create
        ), mock.patch.object(
            smoke, "run_face_landmarker_single_frame_inference", side_effect=_infer
        ), mock.patch.object(
            smoke, "compose_face_landmarker_inference_outcome", side_effect=_compose
        ):
            report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)

        self.assertIs(report.status, SmokeStatus.PASSED)
        self.assertEqual(
            order, ["assemble", "convert", "create_runtime", "inference", "composition"]
        )
        self.assertEqual(runtime.close_calls, 1)

    def test_mediapipe_module_injected_through_runtime_importer(self) -> None:
        mediapipe_module = _make_fake_mediapipe_module()
        importer = _make_importer(mediapipe_module=mediapipe_module)
        captured: dict = {}

        real_create = smoke.create_face_landmarker_runtime

        def _create(model_asset_path, *, module_importer):
            captured["injected_module"] = module_importer("mediapipe")
            return real_create(model_asset_path, module_importer=module_importer)

        with mock.patch.object(smoke, "create_face_landmarker_runtime", side_effect=_create):
            run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)

        self.assertIs(captured["injected_module"], mediapipe_module)


# =============================================================================
# Pass and failure behavior
# =============================================================================


class PassAndFailureBehaviorTests(unittest.TestCase):
    def test_no_face_result_passes_with_canonical_lost(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.PASSED)
        self.assertEqual(report.payload_status, "lost")
        self.assertEqual(report.runtime_creation_status, "success")
        self.assertEqual(report.inference_status, "success")
        self.assertEqual(report.close_status, "closed")
        self.assertEqual(report.input_category, "synthetic-solid-bgr24")
        self.assertEqual(report.input_width, 64)
        self.assertEqual(report.input_height, 64)
        self.assertTrue(math.isfinite(report.inference_ms))
        self.assertGreaterEqual(report.inference_ms, 0.0)
        self.assertEqual(runtime.close_calls, 1)

    def test_valid_face_passes_with_tracking(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _single_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.PASSED)
        self.assertEqual(report.payload_status, "tracking")
        self.assertEqual(runtime.close_calls, 1)

    def test_numpy_import_failure(self) -> None:
        importer = _make_importer(numpy_error=RuntimeError(_SECRET_TEXT))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "numpy_import_failed")
        self.assertNotIn("mediapipe", importer.calls)

    def test_mediapipe_import_failure(self) -> None:
        importer = _make_importer(mediapipe_error=RuntimeError(_SECRET_TEXT))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "mediapipe_import_failed")

    def test_mediapipe_version_missing(self) -> None:
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(version=None))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "mediapipe_version_unavailable")

    def test_mediapipe_version_path_like_rejected(self) -> None:
        importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(version=_SECRET_PATH)
        )
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "mediapipe_version_unavailable")

    def test_runtime_creation_failure(self) -> None:
        importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(
                create_from_options_error=RuntimeError(_SECRET_TEXT)
            )
        )
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "runtime_creation_failed")
        self.assertEqual(report.runtime_creation_status, "runtime_initialization_failed")
        self.assertEqual(report.close_status, "not_ready")

    def test_image_api_resolution_failure(self) -> None:
        mediapipe_module = _make_fake_mediapipe_module()
        del mediapipe_module.ImageFormat
        importer = _make_importer(mediapipe_module=mediapipe_module)
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "image_api_resolution_failed")
        self.assertEqual(report.close_status, "closed")

    def test_non_success_inference_failure(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: None)
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "inference_failed")
        self.assertEqual(report.inference_status, "detection_failed")
        self.assertEqual(runtime.close_calls, 1)

    def test_composition_failure(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        with mock.patch.object(
            smoke, "compose_face_landmarker_inference_outcome", return_value=None
        ):
            report = run_real_local_smoke(
                "/models/face_landmarker.task", module_importer=importer
            )
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "composition_failed")
        self.assertEqual(runtime.close_calls, 1)

    def test_close_failure(self) -> None:
        runtime = _FakeRuntime(
            detect=lambda image: _no_face_result(), close_error=RuntimeError(_SECRET_TEXT)
        )
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "close_failed")
        self.assertEqual(report.close_status, "close_failed")
        self.assertEqual(report.payload_status, "lost")
        self.assertEqual(runtime.close_calls, 1)

    def test_close_occurs_after_every_post_runtime_failure(self) -> None:
        cases = [
            _make_importer(
                mediapipe_module=_make_fake_mediapipe_module(
                    runtime=_FakeRuntime(detect=lambda image: None)
                )
            ),
        ]
        for importer in cases:
            report = run_real_local_smoke(
                "/models/face_landmarker.task", module_importer=importer
            )
            self.assertIs(report.status, SmokeStatus.FAILED)

    def test_no_stale_state_across_calls(self) -> None:
        lost_importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(
                runtime=_FakeRuntime(detect=lambda image: _no_face_result())
            )
        )
        tracking_importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(
                runtime=_FakeRuntime(detect=lambda image: _single_face_result())
            )
        )
        first = run_real_local_smoke("/models/a.task", module_importer=lost_importer)
        second = run_real_local_smoke("/models/b.task", module_importer=tracking_importer)
        third = run_real_local_smoke("/models/a.task", module_importer=lost_importer)
        self.assertEqual(first.payload_status, "lost")
        self.assertEqual(second.payload_status, "tracking")
        self.assertEqual(third.payload_status, "lost")


# =============================================================================
# KeyboardInterrupt / SystemExit visibility
# =============================================================================


class ExceptionVisibilityTests(unittest.TestCase):
    def test_keyboard_interrupt_from_numpy_import_not_swallowed(self) -> None:
        importer = _make_importer(numpy_error=KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)

    def test_system_exit_from_mediapipe_import_not_swallowed(self) -> None:
        importer = _make_importer(mediapipe_error=SystemExit())
        with self.assertRaises(SystemExit):
            run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)

    def test_keyboard_interrupt_from_detect_closes_lifecycle_and_propagates(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: (_ for _ in ()).throw(KeyboardInterrupt()))
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        with self.assertRaises(KeyboardInterrupt):
            run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertEqual(runtime.close_calls, 1)

    def test_ordinary_unexpected_exception_maps_to_bounded_reason(self) -> None:
        with mock.patch.object(
            smoke, "_prepare_synthetic_frame", side_effect=RuntimeError(_SECRET_TEXT)
        ):
            report = run_real_local_smoke(
                "/models/face_landmarker.task", module_importer=_make_importer()
            )
        self.assertIs(report.status, SmokeStatus.FAILED)
        self.assertEqual(report.reason, "unexpected_runtime_failure")


# =============================================================================
# Privacy and evidence
# =============================================================================


class PrivacyAndEvidenceTests(unittest.TestCase):
    def test_no_secret_text_in_serialized_failure_report(self) -> None:
        importer = _make_importer(mediapipe_error=RuntimeError(_SECRET_TEXT))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        line = serialize_smoke_report(report)
        self.assertNotIn(_SECRET_TEXT, line)

    def test_no_secret_model_path_in_serialized_report(self) -> None:
        report = run_real_local_smoke(_SECRET_PATH, module_importer=_make_importer())
        line = serialize_smoke_report(report)
        self.assertNotIn(_SECRET_PATH, line)

    def test_no_raw_candidate_or_landmark_text_in_report(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _single_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        report = run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        line = serialize_smoke_report(report)
        for forbidden in (
            "face_landmarks",
            "blendshape",
            "facial_transformation_matrixes",
            "eyeBlinkLeft",
        ):
            self.assertNotIn(forbidden, line)

    def test_no_stdout_from_run_real_local_smoke_itself(self) -> None:
        importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(
                runtime=_FakeRuntime(detect=lambda image: _no_face_result())
            )
        )
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertEqual(buffer.getvalue(), "")

    def test_no_actual_numpy_or_mediapipe_import(self) -> None:
        self.assertNotIn("numpy", sys.modules)
        importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(
                runtime=_FakeRuntime(detect=lambda image: _no_face_result())
            )
        )
        run_real_local_smoke("/models/face_landmarker.task", module_importer=importer)
        self.assertNotIn("numpy", sys.modules)

    def test_module_does_not_eagerly_import_numpy_or_mediapipe(self) -> None:
        module_globals = set(vars(smoke).keys())
        self.assertNotIn("numpy", module_globals)
        self.assertNotIn("mediapipe", module_globals)


# =============================================================================
# CLI entry point
# =============================================================================


class CliTests(unittest.TestCase):
    def _run_main(self, argv: list, env: dict) -> tuple[int, str]:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            exit_code = main(argv, env)
        return exit_code, buffer.getvalue()

    def test_no_real_run_flag_is_skipped(self) -> None:
        exit_code, output = self._run_main([], {"LVK_MEDIAPIPE_SMOKE": "1"})
        self.assertEqual(exit_code, 0)
        document = json.loads(output)
        self.assertEqual(document["status"], "SKIPPED")

    def test_real_run_flag_without_opt_in_is_skipped(self) -> None:
        exit_code, output = self._run_main(["--real-run"], {})
        self.assertEqual(exit_code, 0)
        document = json.loads(output)
        self.assertEqual(document["status"], "SKIPPED")

    def test_real_run_with_opt_in_but_invalid_model_fails(self) -> None:
        exit_code, output = self._run_main(
            ["--real-run"],
            {"LVK_MEDIAPIPE_SMOKE": "1", "LVK_MEDIAPIPE_MODEL_ASSET_PATH": "relative.task"},
        )
        self.assertEqual(exit_code, 1)
        document = json.loads(output)
        self.assertEqual(document["status"], "FAILED")
        self.assertEqual(document["reason"], "model_configuration_invalid")
        self.assertNotIn("relative.task", output)

    def test_real_run_passed_maps_to_exit_zero(self) -> None:
        with _TempModelFile() as model_path:
            with mock.patch.object(
                smoke,
                "run_real_local_smoke",
                return_value=smoke._passed_report(),
            ):
                exit_code, output = self._run_main(
                    ["--real-run"],
                    {
                        "LVK_MEDIAPIPE_SMOKE": "1",
                        "LVK_MEDIAPIPE_MODEL_ASSET_PATH": model_path,
                    },
                )
            self.assertEqual(exit_code, 0)
            document = json.loads(output)
            self.assertEqual(document["status"], "PASSED")
            self.assertNotIn(model_path, output)

    def test_real_run_failed_maps_to_exit_one(self) -> None:
        with _TempModelFile() as model_path:
            with mock.patch.object(
                smoke,
                "run_real_local_smoke",
                return_value=smoke._failed_report("inference_failed"),
            ):
                exit_code, output = self._run_main(
                    ["--real-run"],
                    {
                        "LVK_MEDIAPIPE_SMOKE": "1",
                        "LVK_MEDIAPIPE_MODEL_ASSET_PATH": model_path,
                    },
                )
            self.assertEqual(exit_code, 1)
            document = json.loads(output)
            self.assertEqual(document["status"], "FAILED")


if __name__ == "__main__":
    unittest.main()
