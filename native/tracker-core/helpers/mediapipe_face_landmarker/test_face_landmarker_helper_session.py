"""Standard-library fake-based tests for face_landmarker_helper_session.py.

Run directly: python -B test_face_landmarker_helper_session.py

These tests use fake streams, fake modules, fake reader outcomes, and a fake
closeable runtime only. They never require real NumPy, MediaPipe, a model, a
real frame endpoint, a subprocess, a camera, a file, or a network resource.

Also supports one test-only CLI fixture mode used by
tools/check-mediapipe-face-landmarker-helper-session.mjs to exercise the real
production main()/session function end to end at the process level:

    python -B test_face_landmarker_helper_session.py --process-fixture <scenario>

Scenarios: frame-stop, clean-eof, startup-failure, input-failure.
"""

from __future__ import annotations

import contextlib
import inspect
import io
import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

import face_landmarker_helper_session as session
from face_landmarker_helper_session import (
    FaceLandmarkerHelperSessionStatus,
    main,
    run_face_landmarker_helper_session,
)
from face_landmarker_inference import FaceLandmarkerInferenceOutcome
from face_landmarker_result_composition import FaceLandmarkerResultComposition
from face_landmarker_runtime import (
    FaceLandmarkerRuntimeCloseStatus,
    FaceLandmarkerRuntimeCreationStatus,
    FaceLandmarkerRuntimeLifecycle,
    FaceLandmarkerRuntimeState,
)
from helper_frame_input import (
    HelperFramePacketHeader,
    HelperFrameRequest,
    ValidatedHelperFrameInput,
    assemble_validated_helper_frame_input,
)
from helper_frame_reader import HelperFrameInputReadOutcome, HelperFrameInputReadStatus
from helper_frame_rgb import ValidatedHelperRgb24Frame

_SECRET_MODEL_PATH_MARKER = "very-secret-model-marker-9f31c2"
_SECRET_EXCEPTION_TEXT = "very-secret-exception-text-4b7a1"

_ABS_MODEL_PATH = os.path.join(tempfile.gettempdir(), "lvk-fixture-model.task")


# =============================================================================
# Fakes: NumPy / MediaPipe module surfaces
# =============================================================================


class _FakeCandidateResult:
    def __init__(self, face_landmarks=(), face_blendshapes=(), facial_transformation_matrixes=()):
        self.face_landmarks = face_landmarks
        self.face_blendshapes = face_blendshapes
        self.facial_transformation_matrixes = facial_transformation_matrixes


def _no_face_result() -> _FakeCandidateResult:
    return _FakeCandidateResult()


def _malformed_candidate_result() -> _FakeCandidateResult:
    # One landmark entry but no matching blendshape/matrix entry: a
    # deliberately inconsistent parallel-array shape.
    return _FakeCandidateResult(face_landmarks=[object()], face_blendshapes=[], facial_transformation_matrixes=[])


class _FakeRuntime:
    def __init__(self, *, detect=None, close_error: Exception | None = None):
        self.close_calls = 0
        self._close_error = close_error
        self.detect = detect if detect is not None else (lambda image: _no_face_result())

    def close(self) -> None:
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error


class _FakeFlatArray:
    def __init__(self, dtype):
        self._dtype = dtype

    def reshape(self, shape):
        return _FakeArray(shape, self._dtype, True)


class _FakeArray:
    def __init__(self, shape, dtype, c_contiguous):
        self.shape = shape
        self.dtype = dtype
        self.flags = types.SimpleNamespace(c_contiguous=c_contiguous)


def _make_fake_numpy_module():
    uint8_sentinel = object()

    def frombuffer(data, dtype):
        return _FakeFlatArray(dtype)

    def ascontiguousarray(array, dtype):
        return _FakeArray(array.shape, dtype, True)

    return types.SimpleNamespace(
        frombuffer=frombuffer, uint8=uint8_sentinel, ascontiguousarray=ascontiguousarray
    )


def _make_fake_mediapipe_module(*, runtime=None, create_from_options_error=None):
    if runtime is None:
        runtime = _FakeRuntime()

    def create_from_options(options):
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
    return types.SimpleNamespace(
        tasks=tasks,
        Image=lambda *, image_format, data: object(),
        ImageFormat=types.SimpleNamespace(SRGB=object()),
    )


def _make_importer(
    *,
    mediapipe_module=None,
    numpy_module=None,
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


# =============================================================================
# Fakes: reader / frame input
# =============================================================================


class _FakeReader:
    def __init__(self, outcomes, *, close_result: bool = True, close_error: Exception | None = None):
        self._outcomes = list(outcomes)
        self.read_calls = 0
        self.close_calls = 0
        self._close_result = close_result
        self._close_error = close_error

    def read_next(self) -> HelperFrameInputReadOutcome:
        self.read_calls += 1
        if not self._outcomes:
            return HelperFrameInputReadOutcome(HelperFrameInputReadStatus.CLOSED, None)
        return self._outcomes.pop(0)

    def close(self) -> bool:
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error
        return self._close_result


def _make_valid_frame_input(request_id: int = 7, frame_timestamp_ms: int = 1000) -> ValidatedHelperFrameInput:
    request = HelperFrameRequest(request_id=request_id, frame_timestamp_ms=frame_timestamp_ms)
    payload = bytes(range(12))
    header = HelperFramePacketHeader(
        sequence=request_id,
        frame_timestamp_ms=frame_timestamp_ms,
        width=2,
        height=2,
        row_stride_bytes=6,
        payload_bytes=12,
    )
    frame_input = assemble_validated_helper_frame_input(request, header, payload)
    assert frame_input is not None
    return frame_input


def _frame_outcome(request_id: int = 7, frame_timestamp_ms: int = 1000) -> HelperFrameInputReadOutcome:
    return HelperFrameInputReadOutcome(
        HelperFrameInputReadStatus.FRAME, _make_valid_frame_input(request_id, frame_timestamp_ms)
    )


_STOP_OUTCOME = HelperFrameInputReadOutcome(HelperFrameInputReadStatus.STOP, None)
_EOF_OUTCOME = HelperFrameInputReadOutcome(HelperFrameInputReadStatus.EOF, None)
_CONTROL_INVALID_OUTCOME = HelperFrameInputReadOutcome(
    HelperFrameInputReadStatus.CONTROL_INVALID, None
)


# =============================================================================
# Session-running helper
# =============================================================================


def _run_session(
    *,
    model_asset_path: str = _ABS_MODEL_PATH,
    reader: _FakeReader | None = None,
    importer=None,
    output_stream: io.StringIO | None = None,
    error_stream: io.StringIO | None = None,
):
    output_stream = output_stream if output_stream is not None else io.StringIO()
    error_stream = error_stream if error_stream is not None else io.StringIO()
    importer = importer if importer is not None else _make_importer()
    reader = reader if reader is not None else _FakeReader([_EOF_OUTCOME])

    with mock.patch.object(session, "HelperFrameInputReader", return_value=reader) as reader_ctor:
        status = run_face_landmarker_helper_session(
            model_asset_path, object(), output_stream, error_stream, module_importer=importer
        )

    return status, output_stream.getvalue(), error_stream.getvalue(), reader, reader_ctor


def _lines(stdout_text: str) -> list:
    if stdout_text == "":
        return []
    return stdout_text.splitlines(keepends=False)


# =============================================================================
# Public/CLI contract
# =============================================================================


class PublicContractTests(unittest.TestCase):
    def test_status_enum_exact_members(self) -> None:
        expected = {
            "STOPPED",
            "EOF_STOPPED",
            "STARTUP_FAILED",
            "INPUT_FAILED",
            "FRAME_CONVERSION_FAILED",
            "INFERENCE_CONTRACT_FAILED",
            "COMPOSITION_FAILED",
            "SERIALIZATION_FAILED",
            "OUTPUT_FAILED",
            "CLOSE_FAILED",
            "INTERNAL_FAILURE",
        }
        self.assertEqual({member.name for member in FaceLandmarkerHelperSessionStatus}, expected)


class CliContractTests(unittest.TestCase):
    def test_valid_cli_accepted(self) -> None:
        self.assertEqual(
            session._parse_startup_arguments(["--model-asset-path", _ABS_MODEL_PATH]),
            _ABS_MODEL_PATH,
        )

    def test_missing_value(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(["--model-asset-path"]))

    def test_extra_arguments(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(["--model-asset-path", _ABS_MODEL_PATH, "extra"])
        )

    def test_wrong_flag(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(["--bad-flag", _ABS_MODEL_PATH]))

    def test_empty_value(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(["--model-asset-path", ""]))

    def test_relative_path_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(["--model-asset-path", "relative/model.task"])
        )

    def test_nul_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(["--model-asset-path", _ABS_MODEL_PATH + "\0x"])
        )

    def test_cr_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(["--model-asset-path", _ABS_MODEL_PATH + "\r"])
        )

    def test_lf_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(["--model-asset-path", _ABS_MODEL_PATH + "\n"])
        )

    def test_non_string_value_rejected(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(["--model-asset-path", 123]))

    def test_no_environment_fallback_source_check(self) -> None:
        source = inspect.getsource(session)
        self.assertNotIn("os.environ", source)
        self.assertNotIn("getenv", source)

    def test_invalid_config_emits_no_ready_and_hides_supplied_text(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(["--model-asset-path", _SECRET_MODEL_PATH_MARKER])
        self.assertEqual(code, 1)
        self.assertEqual(out.getvalue(), "")
        self.assertNotIn(_SECRET_MODEL_PATH_MARKER, err.getvalue())
        self.assertEqual(err.getvalue(), "[helper] session: failed (code=startup_failed)\n")


class MainDispatchTests(unittest.TestCase):
    def test_maps_stopped_to_exit_zero(self) -> None:
        with mock.patch.object(
            session,
            "run_face_landmarker_helper_session",
            return_value=FaceLandmarkerHelperSessionStatus.STOPPED,
        ):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main(["--model-asset-path", _ABS_MODEL_PATH])
        self.assertEqual(code, 0)

    def test_maps_eof_stopped_to_exit_zero(self) -> None:
        with mock.patch.object(
            session,
            "run_face_landmarker_helper_session",
            return_value=FaceLandmarkerHelperSessionStatus.EOF_STOPPED,
        ):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main(["--model-asset-path", _ABS_MODEL_PATH])
        self.assertEqual(code, 0)

    def test_maps_failure_status_to_exit_one(self) -> None:
        with mock.patch.object(
            session,
            "run_face_landmarker_helper_session",
            return_value=FaceLandmarkerHelperSessionStatus.INTERNAL_FAILURE,
        ):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main(["--model-asset-path", _ABS_MODEL_PATH])
        self.assertEqual(code, 1)

    def test_passes_stdin_buffer_stdout_stderr(self) -> None:
        captured = {}

        def fake_run(model_asset_path, control_stream, output_stream, error_stream, *, module_importer=None):
            captured["model_asset_path"] = model_asset_path
            captured["control_stream"] = control_stream
            captured["output_stream"] = output_stream
            captured["error_stream"] = error_stream
            return FaceLandmarkerHelperSessionStatus.EOF_STOPPED

        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(
            session, "run_face_landmarker_helper_session", side_effect=fake_run
        ), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            expected_stdout = sys.stdout
            expected_stderr = sys.stderr
            expected_stdin_buffer = sys.stdin.buffer
            main(["--model-asset-path", _ABS_MODEL_PATH])

        self.assertEqual(captured["model_asset_path"], _ABS_MODEL_PATH)
        self.assertIs(captured["output_stream"], expected_stdout)
        self.assertIs(captured["error_stream"], expected_stderr)
        self.assertIs(captured["control_stream"], expected_stdin_buffer)


# =============================================================================
# Startup sequence
# =============================================================================


class StartupTests(unittest.TestCase):
    def test_exact_call_order_and_ready_on_success(self) -> None:
        order: list = []

        importer = _make_importer()

        real_create = session.create_face_landmarker_runtime

        def create_spy(*args, **kwargs):
            order.append("runtime_creation")
            return real_create(*args, **kwargs)

        real_reader_cls = session.HelperFrameInputReader

        def reader_spy(control_stream):
            order.append("reader_construction")
            return real_reader_cls(control_stream)

        class _OrderedStream(io.StringIO):
            def write(self_inner, s):
                order.append("write")
                return super().write(s)

            def flush(self_inner):
                order.append("flush")
                return super().flush()

        output_stream = _OrderedStream()
        control_stream = io.BytesIO(b"")

        with mock.patch.object(
            session, "create_face_landmarker_runtime", side_effect=create_spy
        ), mock.patch.object(session, "HelperFrameInputReader", side_effect=reader_spy):
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, control_stream, output_stream, io.StringIO(), module_importer=importer
            )

        self.assertEqual(importer.calls[:2], ["numpy", "mediapipe"])
        self.assertEqual(order[:2], ["runtime_creation", "reader_construction"])
        self.assertIn("write", order)
        self.assertIn("flush", order)
        self.assertLess(order.index("reader_construction"), order.index("write"))
        # Empty control stream => immediate clean EOF after ready.
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.EOF_STOPPED)

    def test_numpy_import_failure(self) -> None:
        importer = _make_importer(numpy_error=RuntimeError(_SECRET_EXCEPTION_TEXT))
        status, out, err, _, _ = _run_session(importer=importer)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)
        self.assertNotIn("mediapipe", importer.calls)

    def test_mediapipe_import_failure(self) -> None:
        importer = _make_importer(mediapipe_error=RuntimeError(_SECRET_EXCEPTION_TEXT))
        status, out, err, _, _ = _run_session(importer=importer)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)

    def test_invalid_api_surface_missing_image_format(self) -> None:
        module = _make_fake_mediapipe_module()
        del module.ImageFormat
        importer = _make_importer(mediapipe_module=module)
        status, out, err, _, _ = _run_session(importer=importer)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")

    def test_invalid_api_surface_non_callable_image(self) -> None:
        module = _make_fake_mediapipe_module()
        module.Image = None
        importer = _make_importer(mediapipe_module=module)
        status, _, _, _, _ = _run_session(importer=importer)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

    def test_runtime_factory_exception(self) -> None:
        importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(
                create_from_options_error=RuntimeError(_SECRET_EXCEPTION_TEXT)
            )
        )
        status, out, err, _, _ = _run_session(importer=importer)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)

    def test_wrong_lifecycle_type_from_runtime_creation(self) -> None:
        with mock.patch.object(
            session, "create_face_landmarker_runtime", return_value="not-a-lifecycle"
        ):
            status, out, err, _, _ = _run_session()
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")

    def test_non_success_creation_status(self) -> None:
        bad_lifecycle = FaceLandmarkerRuntimeLifecycle(
            state=FaceLandmarkerRuntimeState.FAILED,
            creation_status=FaceLandmarkerRuntimeCreationStatus.IMPORT_FAILED,
            runtime=None,
        )
        with mock.patch.object(
            session, "create_face_landmarker_runtime", return_value=bad_lifecycle
        ):
            status, out, _, _, _ = _run_session()
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")

    def test_non_ready_lifecycle_state(self) -> None:
        runtime = _FakeRuntime()
        odd_lifecycle = FaceLandmarkerRuntimeLifecycle(
            state=FaceLandmarkerRuntimeState.CLOSED,
            creation_status=FaceLandmarkerRuntimeCreationStatus.SUCCESS,
            runtime=runtime,
        )
        with mock.patch.object(
            session, "create_face_landmarker_runtime", return_value=odd_lifecycle
        ):
            status, out, _, _, _ = _run_session()
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")

    def test_missing_borrowed_runtime(self) -> None:
        runtime = _FakeRuntime()
        lifecycle = FaceLandmarkerRuntimeLifecycle(
            state=FaceLandmarkerRuntimeState.READY,
            creation_status=FaceLandmarkerRuntimeCreationStatus.SUCCESS,
            runtime=runtime,
        )
        with mock.patch.object(
            FaceLandmarkerRuntimeLifecycle, "borrow_ready_runtime", return_value=None
        ):
            with mock.patch.object(
                session, "create_face_landmarker_runtime", return_value=lifecycle
            ):
                status, out, _, _, _ = _run_session()
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")
        self.assertEqual(runtime.close_calls, 1)

    def test_reader_construction_failure_closes_ready_runtime(self) -> None:
        runtime = _FakeRuntime()
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        with mock.patch.object(
            session, "HelperFrameInputReader", side_effect=RuntimeError(_SECRET_EXCEPTION_TEXT)
        ):
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, object(), io.StringIO(), io.StringIO(), module_importer=importer
            )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(runtime.close_calls, 1)

    def test_ready_write_failure(self) -> None:
        class _FailingStream(io.StringIO):
            def write(self, s):
                raise OSError("synthetic ready write failure")

        importer = _make_importer()
        reader = _FakeReader([_EOF_OUTCOME])
        with mock.patch.object(session, "HelperFrameInputReader", return_value=reader):
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, object(), _FailingStream(), io.StringIO(), module_importer=importer
            )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(reader.read_calls, 0)

    def test_ready_write_failure_closes_ready_runtime_once(self) -> None:
        class _FailingStream(io.StringIO):
            def write(self, s):
                raise OSError("synthetic ready write failure")

        runtime = _FakeRuntime()
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_EOF_OUTCOME])
        with mock.patch.object(session, "HelperFrameInputReader", return_value=reader):
            run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, object(), _FailingStream(), io.StringIO(), module_importer=importer
            )
        self.assertEqual(runtime.close_calls, 1)
        self.assertEqual(reader.close_calls, 1)

    def test_model_asset_path_invalid(self) -> None:
        status, out, err, _, _ = _run_session(model_asset_path="")
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")

    def test_module_importer_not_callable(self) -> None:
        status, out, _, _, _ = _run_session(importer="not-callable")
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")


# =============================================================================
# One-frame composition
# =============================================================================


class OneFrameCompositionTests(unittest.TestCase):
    def test_no_face_success_produces_canonical_lost(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        status, out, err, _, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(err, "")
        lines = _lines(out)
        self.assertEqual(len(lines), 4)
        result = json.loads(lines[1])
        self.assertEqual(result["type"], "result")
        self.assertEqual(result["status"], "lost")
        self.assertEqual(result["requestId"], 7)

    def test_bounded_inference_failure_produces_canonical_lost(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: None)  # -> DETECTION_FAILED
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        status, out, err, _, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(err, "")
        result = json.loads(_lines(out)[1])
        self.assertEqual(result["status"], "lost")

    def test_malformed_candidate_produces_canonical_lost(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _malformed_candidate_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        status, out, err, _, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        result = json.loads(_lines(out)[1])
        self.assertEqual(result["status"], "lost")

    def test_exact_stage_order(self) -> None:
        order: list = []
        real_convert = session.convert_validated_helper_frame_input_to_rgb24
        real_infer = session.run_face_landmarker_single_frame_inference
        real_compose = session.compose_face_landmarker_inference_outcome
        real_serialize = session.serialize_helper_result_line

        def convert_spy(*a, **k):
            order.append("convert")
            return real_convert(*a, **k)

        def infer_spy(*a, **k):
            order.append("inference")
            return real_infer(*a, **k)

        def compose_spy(*a, **k):
            order.append("composition")
            return real_compose(*a, **k)

        def serialize_spy(*a, **k):
            order.append("serialize")
            return real_serialize(*a, **k)

        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])

        with mock.patch.object(
            session, "convert_validated_helper_frame_input_to_rgb24", side_effect=convert_spy
        ), mock.patch.object(
            session, "run_face_landmarker_single_frame_inference", side_effect=infer_spy
        ), mock.patch.object(
            session, "compose_face_landmarker_inference_outcome", side_effect=compose_spy
        ), mock.patch.object(
            session, "serialize_helper_result_line", side_effect=serialize_spy
        ):
            status, _, _, _, _ = _run_session(importer=importer, reader=reader)

        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(order, ["convert", "inference", "composition", "serialize"])

    def test_two_frames_produce_two_independent_results(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader(
            [
                _frame_outcome(request_id=7, frame_timestamp_ms=1000),
                _frame_outcome(request_id=9, frame_timestamp_ms=2000),
                _STOP_OUTCOME,
            ]
        )
        status, out, _, _, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        lines = _lines(out)
        first = json.loads(lines[1])
        second = json.loads(lines[2])
        self.assertEqual(first["requestId"], 7)
        self.assertEqual(second["requestId"], 9)
        self.assertEqual(first["frameTimestampMs"], 1000)
        self.assertEqual(second["frameTimestampMs"], 2000)

    def test_frame_ack_correlation(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(request_id=7), _STOP_OUTCOME])
        status, out, _, _, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        result = json.loads(_lines(out)[1])
        self.assertEqual(result["frameAck"]["sequence"], 7)
        self.assertEqual(result["frameAck"]["payloadBytes"], 12)


# =============================================================================
# Stage failures
# =============================================================================


class StageFailureTests(unittest.TestCase):
    def _run_with_frame(self, **patches):
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        patchers = [mock.patch.object(session, name, **kwargs) for name, kwargs in patches.items()]
        for patcher in patchers:
            patcher.start()
        try:
            return _run_session(importer=importer, reader=reader)
        finally:
            for patcher in patchers:
                patcher.stop()

    def _assert_ready_only(self, out: str) -> None:
        lines = _lines(out)
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["type"], "ready")

    def test_converter_returns_none(self) -> None:
        status, out, err, _, _ = self._run_with_frame(
            convert_validated_helper_frame_input_to_rgb24={"return_value": None}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED)
        self._assert_ready_only(out)
        self.assertEqual(err, "[helper] session: failed (code=frame_conversion_failed)\n")

    def test_converter_raises(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            convert_validated_helper_frame_input_to_rgb24={
                "side_effect": RuntimeError(_SECRET_EXCEPTION_TEXT)
            }
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED)
        self._assert_ready_only(out)

    def test_inference_returns_none(self) -> None:
        status, out, err, _, _ = self._run_with_frame(
            run_face_landmarker_single_frame_inference={"return_value": None}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INFERENCE_CONTRACT_FAILED)
        self._assert_ready_only(out)
        self.assertEqual(err, "[helper] session: failed (code=inference_contract_failed)\n")

    def test_inference_wrong_type(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            run_face_landmarker_single_frame_inference={"return_value": "not-an-outcome"}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INFERENCE_CONTRACT_FAILED)
        self._assert_ready_only(out)

    def test_inference_raises(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            run_face_landmarker_single_frame_inference={
                "side_effect": RuntimeError(_SECRET_EXCEPTION_TEXT)
            }
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INFERENCE_CONTRACT_FAILED)
        self._assert_ready_only(out)

    def test_composition_returns_none(self) -> None:
        status, out, err, _, _ = self._run_with_frame(
            compose_face_landmarker_inference_outcome={"return_value": None}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.COMPOSITION_FAILED)
        self._assert_ready_only(out)
        self.assertEqual(err, "[helper] session: failed (code=composition_failed)\n")

    def test_composition_wrong_type(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            compose_face_landmarker_inference_outcome={"return_value": "not-a-composition"}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.COMPOSITION_FAILED)
        self._assert_ready_only(out)

    def test_composition_raises(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            compose_face_landmarker_inference_outcome={
                "side_effect": RuntimeError(_SECRET_EXCEPTION_TEXT)
            }
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.COMPOSITION_FAILED)
        self._assert_ready_only(out)

    def test_serializer_returns_none(self) -> None:
        status, out, err, _, _ = self._run_with_frame(
            serialize_helper_result_line={"return_value": None}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED)
        self._assert_ready_only(out)
        self.assertEqual(err, "[helper] session: failed (code=serialization_failed)\n")

    def test_serializer_returns_non_string(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            serialize_helper_result_line={"return_value": 123}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED)
        self._assert_ready_only(out)

    def test_serializer_malformed_framing_missing_newline(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            serialize_helper_result_line={"return_value": "not-terminated"}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED)
        self._assert_ready_only(out)

    def test_serializer_malformed_framing_embedded_cr(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            serialize_helper_result_line={"return_value": "bad\rline\n"}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED)
        self._assert_ready_only(out)

    def test_serializer_raises(self) -> None:
        status, out, _, _, _ = self._run_with_frame(
            serialize_helper_result_line={"side_effect": RuntimeError(_SECRET_EXCEPTION_TEXT)}
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED)
        self._assert_ready_only(out)

    def test_result_write_failure(self) -> None:
        class _FailAfterReady(io.StringIO):
            def __init__(self):
                super().__init__()
                self._writes = 0

            def write(self, s):
                self._writes += 1
                if self._writes > 1:
                    raise OSError("synthetic result write failure")
                return super().write(s)

        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        output_stream = _FailAfterReady()
        error_stream = io.StringIO()
        with mock.patch.object(session, "HelperFrameInputReader", return_value=reader):
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, object(), output_stream, error_stream, module_importer=importer
            )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED)
        self.assertEqual(error_stream.getvalue(), "[helper] session: failed (code=output_failed)\n")

    def test_result_flush_failure(self) -> None:
        class _FlushFailsAfterReady(io.StringIO):
            def __init__(self):
                super().__init__()
                self._flushes = 0

            def flush(self):
                self._flushes += 1
                if self._flushes > 1:
                    raise OSError("synthetic result flush failure")
                return super().flush()

        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        output_stream = _FlushFailsAfterReady()
        with mock.patch.object(session, "HelperFrameInputReader", return_value=reader):
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, object(), output_stream, io.StringIO(), module_importer=importer
            )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED)

    def test_no_later_stage_after_earlier_failure(self) -> None:
        infer_mock = mock.Mock()
        status, _, _, _, _ = self._run_with_frame(
            convert_validated_helper_frame_input_to_rgb24={"return_value": None},
            run_face_landmarker_single_frame_inference={"new": infer_mock},
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED)
        infer_mock.assert_not_called()

    def test_cleanup_runs_and_close_failure_overrides_to_close_failed(self) -> None:
        runtime = _FakeRuntime(
            detect=lambda image: _no_face_result(), close_error=RuntimeError(_SECRET_EXCEPTION_TEXT)
        )
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        with mock.patch.object(
            session, "compose_face_landmarker_inference_outcome", return_value=None
        ):
            status, out, err, _, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED)
        self.assertEqual(runtime.close_calls, 1)
        self.assertEqual(err, "[helper] session: failed (code=close_failed)\n")


# =============================================================================
# Stop and EOF
# =============================================================================


class StopAndEofTests(unittest.TestCase):
    def test_explicit_stop_reads_no_further_input(self) -> None:
        reader = _FakeReader([_STOP_OUTCOME])
        status, out, err, reader, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(reader.read_calls, 1)
        self.assertEqual(err, "")

    def test_exact_stopping_then_stopped_sequence(self) -> None:
        reader = _FakeReader([_STOP_OUTCOME])
        status, out, _, _, _ = _run_session(reader=reader)
        lines = _lines(out)
        self.assertEqual(len(lines), 3)
        self.assertEqual(json.loads(lines[0])["type"], "ready")
        stopping = json.loads(lines[1])
        self.assertEqual(stopping["type"], "stopping")
        self.assertEqual(stopping["reason"], "session-stop")
        stopped = json.loads(lines[2])
        self.assertEqual(stopped["type"], "stopped")
        self.assertEqual(stopped["reason"], "session-stop")

    def test_clean_eof_emits_no_stopping_line(self) -> None:
        reader = _FakeReader([_EOF_OUTCOME])
        status, out, err, _, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.EOF_STOPPED)
        lines = _lines(out)
        self.assertEqual(len(lines), 2)
        stopped = json.loads(lines[1])
        self.assertEqual(stopped["type"], "stopped")
        self.assertEqual(stopped["reason"], "session-eof")
        self.assertEqual(err, "")

    def test_reader_close_failure_on_stop(self) -> None:
        reader = _FakeReader([_STOP_OUTCOME], close_result=False)
        status, out, err, reader, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED)
        lines = _lines(out)
        self.assertEqual(len(lines), 2)  # ready, stopping -- no stopped
        self.assertNotIn("stopped", out.split("\n")[-2] if lines else "")
        self.assertEqual(err, "[helper] session: failed (code=close_failed)\n")

    def test_runtime_close_failure_on_stop(self) -> None:
        runtime = _FakeRuntime(close_error=RuntimeError(_SECRET_EXCEPTION_TEXT))
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_STOP_OUTCOME])
        status, out, err, reader, _ = _run_session(importer=importer, reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED)
        self.assertEqual(runtime.close_calls, 1)

    def test_close_attempted_exactly_once_on_stop(self) -> None:
        runtime = _FakeRuntime()
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_STOP_OUTCOME])
        _run_session(importer=importer, reader=reader)
        self.assertEqual(reader.close_calls, 1)
        self.assertEqual(runtime.close_calls, 1)

    def test_close_attempted_exactly_once_on_eof(self) -> None:
        runtime = _FakeRuntime()
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_EOF_OUTCOME])
        _run_session(importer=importer, reader=reader)
        self.assertEqual(reader.close_calls, 1)
        self.assertEqual(runtime.close_calls, 1)

    def test_reader_close_failure_on_eof(self) -> None:
        reader = _FakeReader([_EOF_OUTCOME], close_result=False)
        status, out, err, _, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED)
        lines = _lines(out)
        self.assertEqual(len(lines), 1)  # ready only -- no stopped

    def test_input_failure_status_closes_and_returns_input_failed(self) -> None:
        reader = _FakeReader([_CONTROL_INVALID_OUTCOME])
        status, out, err, reader, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INPUT_FAILED)
        lines = _lines(out)
        self.assertEqual(len(lines), 1)  # ready only
        self.assertEqual(reader.close_calls, 1)
        self.assertEqual(err, "[helper] session: failed (code=input_failed)\n")

    def test_input_failure_with_close_failure_overrides_to_close_failed(self) -> None:
        reader = _FakeReader([_CONTROL_INVALID_OUTCOME], close_result=False)
        status, _, err, _, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED)

    def test_read_next_exception_maps_to_input_failed(self) -> None:
        class _RaisingReader(_FakeReader):
            def read_next(self):
                raise RuntimeError(_SECRET_EXCEPTION_TEXT)

        reader = _RaisingReader([])
        status, out, err, _, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INPUT_FAILED)
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)

    def test_no_output_after_terminal_status(self) -> None:
        reader = _FakeReader([_STOP_OUTCOME])
        status, out, _, reader, _ = _run_session(reader=reader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        # read_next() must not be called again after STOP.
        self.assertEqual(reader.read_calls, 1)


# =============================================================================
# Privacy and bounds
# =============================================================================


class PrivacyAndBoundsTests(unittest.TestCase):
    def test_stdout_contains_only_approved_lifecycle_and_result_json(self) -> None:
        runtime = _FakeRuntime(detect=lambda image: _no_face_result())
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
        _, out, _, _, _ = _run_session(importer=importer, reader=reader)
        for line in _lines(out):
            document = json.loads(line)
            self.assertIn(document["type"], {"ready", "result", "stopping", "stopped"})

    def test_stderr_matches_fixed_safe_diagnostic_shape(self) -> None:
        status, _, err, _, _ = _run_session(model_asset_path="")
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertRegex(err, r"^\[helper\] session: failed \(code=[a-z_]+\)\n$")

    def test_model_path_never_appears_in_output(self) -> None:
        status, out, err, _, _ = _run_session(model_asset_path=_SECRET_MODEL_PATH_MARKER)
        self.assertNotIn(_SECRET_MODEL_PATH_MARKER, out)
        self.assertNotIn(_SECRET_MODEL_PATH_MARKER, err)

    def test_injected_exception_text_never_appears(self) -> None:
        importer = _make_importer(mediapipe_error=RuntimeError(_SECRET_EXCEPTION_TEXT))
        _, out, err, _, _ = _run_session(importer=importer)
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, out)
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)

    def test_no_forbidden_facilities_used(self) -> None:
        source = inspect.getsource(session)
        for forbidden in (
            "socket.",
            "import socket",
            "tempfile.",
            "import threading",
            "time.sleep",
            "atexit",
            "__del__",
            "open(",
        ):
            self.assertNotIn(forbidden, source)

    def test_keyboard_interrupt_from_read_next_not_swallowed(self) -> None:
        class _InterruptingReader(_FakeReader):
            def read_next(self):
                raise KeyboardInterrupt()

        reader = _InterruptingReader([])
        importer = _make_importer()
        with mock.patch.object(session, "HelperFrameInputReader", return_value=reader):
            with self.assertRaises(KeyboardInterrupt):
                run_face_landmarker_helper_session(
                    _ABS_MODEL_PATH, object(), io.StringIO(), io.StringIO(), module_importer=importer
                )

    def test_system_exit_from_mediapipe_import_not_swallowed(self) -> None:
        importer = _make_importer(mediapipe_error=SystemExit())
        with self.assertRaises(SystemExit):
            run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, object(), io.StringIO(), io.StringIO(), module_importer=importer
            )

    def test_internal_failure_on_unexpected_exception(self) -> None:
        with mock.patch.object(
            session, "_is_valid_model_asset_path", side_effect=RuntimeError(_SECRET_EXCEPTION_TEXT)
        ):
            status, out, err, _, _ = _run_session()
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INTERNAL_FAILURE)
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)


# =============================================================================
# Process-level fixture (used by tools/check-mediapipe-face-landmarker-helper-session.mjs)
# =============================================================================


def _run_process_fixture(scenario: str) -> int:
    model_path = os.path.join(
        tempfile.gettempdir(), "lvk-synthetic-fixture-model-marker.task"
    )

    output_stream = io.StringIO()
    error_stream = io.StringIO()

    if scenario == "startup-failure":
        importer = _make_importer(numpy_error=RuntimeError("synthetic-startup-failure"))
        status = run_face_landmarker_helper_session(
            model_path, None, output_stream, error_stream, module_importer=importer
        )
    elif scenario in ("frame-stop", "clean-eof", "input-failure"):
        importer = _make_importer(
            mediapipe_module=_make_fake_mediapipe_module(runtime=_FakeRuntime(detect=lambda image: None))
        )
        if scenario == "frame-stop":
            outcomes = [_frame_outcome(), _STOP_OUTCOME]
        elif scenario == "clean-eof":
            outcomes = [_EOF_OUTCOME]
        else:
            outcomes = [_CONTROL_INVALID_OUTCOME]

        reader = _FakeReader(outcomes)
        with mock.patch.object(session, "HelperFrameInputReader", return_value=reader):
            status = run_face_landmarker_helper_session(
                model_path, None, output_stream, error_stream, module_importer=importer
            )
    else:
        sys.stderr.write(f"unknown fixture scenario: {scenario}\n")
        return 2

    # Writes raw bytes to the stdout/stderr buffers (not sys.stdout.write) so
    # a platform text-mode stream (e.g. Windows translating "\n" to "\r\n")
    # cannot corrupt the required single-trailing-"\n" line framing.
    sys.stdout.buffer.write(output_stream.getvalue().encode("ascii"))
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(error_stream.getvalue().encode("ascii"))
    sys.stderr.buffer.flush()

    return (
        0
        if status
        in (FaceLandmarkerHelperSessionStatus.STOPPED, FaceLandmarkerHelperSessionStatus.EOF_STOPPED)
        else 1
    )


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--process-fixture":
        sys.exit(_run_process_fixture(sys.argv[2]))
    unittest.main()
