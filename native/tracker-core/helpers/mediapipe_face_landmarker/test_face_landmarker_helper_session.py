"""Standard-library fake-based tests for face_landmarker_helper_session.py.

Run directly: python -B test_face_landmarker_helper_session.py

These tests use fake streams, fake modules, fake reader outcomes, and a fake
closeable runtime only. They never require real NumPy, MediaPipe, a model, a
real frame endpoint, a subprocess, a camera, a file, or a network resource.

P2-C: the session's native FNV-1a32 loader is injected with a test-only fake
(`_fake_native_fnv_loader`) that returns a pure-Python reference oracle. A
few startup tests use the REAL loader against deliberately missing/invalid
temporary files to prove fail-closed startup; the actual compiled library is
exercised through both validation stages by test_helper_frame_rgb.py
--native-library and, end to end through Native Core, by the
mediapipe-helper-frame-bridge smoke.

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
from helper_frame_reader import (
    HelperFrameInputReader,
    HelperFrameInputReadOutcome,
    HelperFrameInputReadStatus,
)
from helper_frame_rgb import ValidatedHelperRgb24Frame
from helper_native_fnv import NativeFnv1a32LoadError, load_native_fnv1a32

_SECRET_MODEL_PATH_MARKER = "very-secret-model-marker-9f31c2"
_SECRET_EXCEPTION_TEXT = "very-secret-exception-text-4b7a1"

_ABS_MODEL_PATH = os.path.join(tempfile.gettempdir(), "lvk-fixture-model.task")
_ABS_LIBRARY_PATH = os.path.join(
    tempfile.gettempdir(),
    "lvk-fnv1a32.dll" if sys.platform == "win32" else "liblvk-fnv1a32.so",
)
_SECRET_LIBRARY_PATH_MARKER = "very-secret-library-marker-c41d07"


def _reference_fnv1a32(data: bytes) -> int:
    """Test-only deterministic FNV-1a32 oracle (never a production fallback)."""
    hash_value = 2166136261
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


def _fake_native_fnv_loader(library_path: str):
    """Test-only stand-in for load_native_fnv1a32: returns the oracle."""
    return _reference_fnv1a32


class _RecordingNativeLoader:
    """Records loader calls and every checksum invocation of the result."""

    def __init__(self, *, error: BaseException | None = None, result: object = None,
                 checksum_error_on_call: int | None = None):
        self.load_calls: list = []
        self.checksum_calls: list = []
        self._error = error
        self._result = result
        self._checksum_error_on_call = checksum_error_on_call

    def __call__(self, library_path: str):
        self.load_calls.append(library_path)
        if self._error is not None:
            raise self._error
        if self._result is not None:
            return self._result

        def checksum(data: bytes) -> int:
            self.checksum_calls.append(data)
            if self._checksum_error_on_call == len(self.checksum_calls):
                raise RuntimeError(_SECRET_EXCEPTION_TEXT)
            return _reference_fnv1a32(data)

        return checksum


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
    frame_input = assemble_validated_helper_frame_input(request, header, payload, _reference_fnv1a32)
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
    native_fnv_library_path: str = _ABS_LIBRARY_PATH,
    reader: _FakeReader | None = None,
    importer=None,
    native_fnv_loader=_fake_native_fnv_loader,
    output_stream: io.StringIO | None = None,
    error_stream: io.StringIO | None = None,
):
    output_stream = output_stream if output_stream is not None else io.StringIO()
    error_stream = error_stream if error_stream is not None else io.StringIO()
    importer = importer if importer is not None else _make_importer()
    reader = reader if reader is not None else _FakeReader([_EOF_OUTCOME])

    with mock.patch.object(session, "HelperFrameInputReader", return_value=reader) as reader_ctor:
        status = run_face_landmarker_helper_session(
            model_asset_path,
            native_fnv_library_path,
            object(),
            output_stream,
            error_stream,
            module_importer=importer,
            native_fnv_loader=native_fnv_loader,
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


def _argv(model: object = _ABS_MODEL_PATH, library: object = _ABS_LIBRARY_PATH) -> list:
    return ["--model-asset-path", model, "--native-fnv-library-path", library]


class CliContractTests(unittest.TestCase):
    def test_valid_cli_accepted(self) -> None:
        self.assertEqual(
            session._parse_startup_arguments(_argv()),
            (_ABS_MODEL_PATH, _ABS_LIBRARY_PATH),
        )

    def test_missing_value(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(["--model-asset-path"]))

    def test_extra_arguments(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv() + ["extra"]))

    def test_wrong_flag(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(
                ["--bad-flag", _ABS_MODEL_PATH, "--native-fnv-library-path", _ABS_LIBRARY_PATH]
            )
        )

    def test_empty_value(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv(model="")))

    def test_relative_path_rejected(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv(model="relative/model.task")))

    def test_nul_rejected(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv(model=_ABS_MODEL_PATH + "\0x")))

    def test_cr_rejected(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv(model=_ABS_MODEL_PATH + "\r")))

    def test_lf_rejected(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv(model=_ABS_MODEL_PATH + "\n")))

    def test_non_string_value_rejected(self) -> None:
        self.assertIsNone(session._parse_startup_arguments(_argv(model=123)))

    # --- P2-C: --native-fnv-library-path -------------------------------------

    def test_model_only_legacy_cli_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(["--model-asset-path", _ABS_MODEL_PATH])
        )

    def test_missing_library_flag_or_value_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(
                ["--model-asset-path", _ABS_MODEL_PATH, "--native-fnv-library-path"]
            )
        )
        self.assertIsNone(
            session._parse_startup_arguments(["--native-fnv-library-path", _ABS_LIBRARY_PATH])
        )

    def test_reordered_arguments_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(
                ["--native-fnv-library-path", _ABS_LIBRARY_PATH, "--model-asset-path", _ABS_MODEL_PATH]
            )
        )

    def test_duplicate_flags_rejected(self) -> None:
        self.assertIsNone(
            session._parse_startup_arguments(
                ["--model-asset-path", _ABS_MODEL_PATH, "--model-asset-path", _ABS_MODEL_PATH]
            )
        )
        self.assertIsNone(
            session._parse_startup_arguments(
                ["--native-fnv-library-path", _ABS_LIBRARY_PATH, "--native-fnv-library-path", _ABS_LIBRARY_PATH]
            )
        )
        self.assertIsNone(session._parse_startup_arguments(_argv() + _argv()[2:]))

    def test_unexpected_flag_spelling_rejected(self) -> None:
        for flag in ("--native-fnv-library", "--native_fnv_library_path", "--NATIVE-FNV-LIBRARY-PATH", "--native-fnv-library-path="):
            with self.subTest(flag=flag):
                self.assertIsNone(
                    session._parse_startup_arguments(
                        ["--model-asset-path", _ABS_MODEL_PATH, flag, _ABS_LIBRARY_PATH]
                    )
                )

    def test_invalid_library_values_rejected(self) -> None:
        for value in ("", "relative/lvk-fnv1a32.dll", _ABS_LIBRARY_PATH + "\0x",
                      _ABS_LIBRARY_PATH + "\r", _ABS_LIBRARY_PATH + "\n", 123, None, b"/x.so"):
            with self.subTest(value=repr(value)[:24]):
                self.assertIsNone(session._parse_startup_arguments(_argv(library=value)))

    def test_unicode_and_space_library_path_accepted_verbatim(self) -> None:
        library = os.path.join(tempfile.gettempdir(), "lvk \u30bd build", os.path.basename(_ABS_LIBRARY_PATH))
        self.assertEqual(
            session._parse_startup_arguments(_argv(library=library)), (_ABS_MODEL_PATH, library)
        )

    def test_no_environment_fallback_source_check(self) -> None:
        source = inspect.getsource(session)
        self.assertNotIn("os.environ", source)
        self.assertNotIn("getenv", source)

    def test_invalid_config_emits_no_ready_and_hides_supplied_text(self) -> None:
        for argv in (
            ["--model-asset-path", _SECRET_MODEL_PATH_MARKER],
            _argv(model=_SECRET_MODEL_PATH_MARKER),
            _argv(library=_SECRET_LIBRARY_PATH_MARKER),
        ):
            with self.subTest(arguments=len(argv)):
                out, err = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    code = main(argv)
                self.assertEqual(code, 1)
                self.assertEqual(out.getvalue(), "")
                self.assertNotIn(_SECRET_MODEL_PATH_MARKER, err.getvalue())
                self.assertNotIn(_SECRET_LIBRARY_PATH_MARKER, err.getvalue())
                self.assertEqual(err.getvalue(), "[helper] session: failed (code=startup_failed)\n")


class MainDispatchTests(unittest.TestCase):
    def test_maps_stopped_to_exit_zero(self) -> None:
        with mock.patch.object(
            session,
            "run_face_landmarker_helper_session",
            return_value=FaceLandmarkerHelperSessionStatus.STOPPED,
        ):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main(_argv())
        self.assertEqual(code, 0)

    def test_maps_eof_stopped_to_exit_zero(self) -> None:
        with mock.patch.object(
            session,
            "run_face_landmarker_helper_session",
            return_value=FaceLandmarkerHelperSessionStatus.EOF_STOPPED,
        ):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main(_argv())
        self.assertEqual(code, 0)

    def test_maps_failure_status_to_exit_one(self) -> None:
        with mock.patch.object(
            session,
            "run_face_landmarker_helper_session",
            return_value=FaceLandmarkerHelperSessionStatus.INTERNAL_FAILURE,
        ):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main(_argv())
        self.assertEqual(code, 1)

    def test_passes_stdin_buffer_stdout_stderr(self) -> None:
        captured = {}

        def fake_run(model_asset_path, native_fnv_library_path, control_stream, output_stream,
                     error_stream, *, module_importer=None, native_fnv_loader=None):
            captured["model_asset_path"] = model_asset_path
            captured["native_fnv_library_path"] = native_fnv_library_path
            captured["kwargs"] = (module_importer, native_fnv_loader)
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
            main(_argv())

        self.assertEqual(captured["model_asset_path"], _ABS_MODEL_PATH)
        self.assertEqual(captured["native_fnv_library_path"], _ABS_LIBRARY_PATH)
        # Production main() never overrides the real importer or loader.
        self.assertEqual(captured["kwargs"], (None, None))
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

        def reader_spy(control_stream, checksum):
            order.append("reader_construction")
            return real_reader_cls(control_stream, checksum)

        def loader_spy(library_path):
            order.append("native_fnv_load")
            return _fake_native_fnv_loader(library_path)

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
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, control_stream, output_stream, io.StringIO(), module_importer=importer, native_fnv_loader=loader_spy
            )

        self.assertEqual(importer.calls[:2], ["numpy", "mediapipe"])
        self.assertEqual(order[:3], ["native_fnv_load", "runtime_creation", "reader_construction"])
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
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), io.StringIO(), io.StringIO(), module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), _FailingStream(), io.StringIO(), module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), _FailingStream(), io.StringIO(), module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), output_stream, error_stream, module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), output_stream, io.StringIO(), module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
                    _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), io.StringIO(), io.StringIO(), module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
                )

    def test_system_exit_from_mediapipe_import_not_swallowed(self) -> None:
        importer = _make_importer(mediapipe_error=SystemExit())
        with self.assertRaises(SystemExit):
            run_face_landmarker_helper_session(
                _ABS_MODEL_PATH, _ABS_LIBRARY_PATH, object(), io.StringIO(), io.StringIO(), module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
            )

    def test_internal_failure_on_unexpected_exception(self) -> None:
        with mock.patch.object(
            session, "_is_valid_model_asset_path", side_effect=RuntimeError(_SECRET_EXCEPTION_TEXT)
        ):
            status, out, err, _, _ = _run_session()
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INTERNAL_FAILURE)
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)


# =============================================================================
# P2-C: session-owned native FNV-1a32 startup and checksum flow
# =============================================================================


class NativeFnvStartupTests(unittest.TestCase):
    def _assert_startup_failed_without_ready(self, status, out, err) -> None:
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertEqual(out, "")
        self.assertEqual(err, "[helper] session: failed (code=startup_failed)\n")

    def test_loader_called_exactly_once_with_exact_path_before_imports(self) -> None:
        importer = _make_importer()
        loader = _RecordingNativeLoader()
        reader = _FakeReader([_frame_outcome(), _frame_outcome(request_id=9), _STOP_OUTCOME])
        status, out, _, _, reader_ctor = _run_session(
            importer=importer, native_fnv_loader=loader, reader=reader
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(loader.load_calls, [_ABS_LIBRARY_PATH])
        self.assertEqual(len(_lines(out)), 5)
        # The session hands its one verified callable to the reader.
        self.assertEqual(reader_ctor.call_count, 1)
        supplied = reader_ctor.call_args.args[1]
        self.assertTrue(callable(supplied))

    def test_loader_failure_prevents_ready_and_imports(self) -> None:
        for error in (
            NativeFnv1a32LoadError("native FNV ABI version 2 != 1"),
            NativeFnv1a32LoadError("native FNV startup self-test produced a wrong checksum"),
            NativeFnv1a32LoadError("native FNV library path does not name an existing regular file"),
            TypeError("native FNV library path must be an exact str"),
            OSError(_SECRET_EXCEPTION_TEXT),
        ):
            with self.subTest(error=type(error).__name__):
                importer = _make_importer()
                loader = _RecordingNativeLoader(error=error)
                reader = _FakeReader([_frame_outcome(), _STOP_OUTCOME])
                status, out, err, reader, reader_ctor = _run_session(
                    importer=importer, native_fnv_loader=loader, reader=reader
                )
                self._assert_startup_failed_without_ready(status, out, err)
                self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)
                self.assertNotIn(str(error), err)
                self.assertEqual(importer.calls, [])
                reader_ctor.assert_not_called()
                self.assertEqual(reader.read_calls, 0)

    def test_loader_returning_non_callable_prevents_ready(self) -> None:
        for value in (0, "checksum", b"", object()):
            with self.subTest(value=type(value).__name__):
                loader = _RecordingNativeLoader(result=value)
                status, out, err, _, reader_ctor = _run_session(native_fnv_loader=loader)
                self._assert_startup_failed_without_ready(status, out, err)
                reader_ctor.assert_not_called()

    def test_non_callable_loader_prevents_ready(self) -> None:
        status, out, err, _, _ = _run_session(native_fnv_loader="not-callable")
        self._assert_startup_failed_without_ready(status, out, err)

    def test_invalid_library_path_never_reaches_loader(self) -> None:
        for value in ("", _ABS_LIBRARY_PATH + "\0", _ABS_LIBRARY_PATH + "\n", None, 7):
            with self.subTest(value=repr(value)[:16]):
                loader = _RecordingNativeLoader()
                status, out, err, _, _ = _run_session(
                    native_fnv_library_path=value, native_fnv_loader=loader
                )
                self._assert_startup_failed_without_ready(status, out, err)
                self.assertEqual(loader.load_calls, [])

    def test_library_path_never_appears_in_output(self) -> None:
        loader = _RecordingNativeLoader(error=NativeFnv1a32LoadError(_SECRET_LIBRARY_PATH_MARKER))
        status, out, err, _, _ = _run_session(
            native_fnv_library_path=os.path.join(tempfile.gettempdir(), _SECRET_LIBRARY_PATH_MARKER),
            native_fnv_loader=loader,
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        self.assertNotIn(_SECRET_LIBRARY_PATH_MARKER, out)
        self.assertNotIn(_SECRET_LIBRARY_PATH_MARKER, err)

    def test_real_loader_missing_library_prevents_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = os.path.join(directory, os.path.basename(_ABS_LIBRARY_PATH))
            importer = _make_importer()
            status, out, err, _, reader_ctor = _run_session(
                native_fnv_library_path=missing,
                native_fnv_loader=load_native_fnv1a32,
                importer=importer,
            )
        self._assert_startup_failed_without_ready(status, out, err)
        self.assertNotIn(directory, err)
        self.assertEqual(importer.calls, [])
        reader_ctor.assert_not_called()

    def test_real_loader_invalid_library_file_prevents_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            invalid = os.path.join(directory, os.path.basename(_ABS_LIBRARY_PATH))
            with open(invalid, "wb") as handle:
                handle.write(b"not a shared library\n" * 16)
            importer = _make_importer()
            status, out, err, _, reader_ctor = _run_session(
                native_fnv_library_path=invalid,
                native_fnv_loader=load_native_fnv1a32,
                importer=importer,
            )
        self._assert_startup_failed_without_ready(status, out, err)
        self.assertNotIn(directory, err)
        self.assertEqual(importer.calls, [])
        reader_ctor.assert_not_called()

    def test_real_loader_relative_library_path_prevents_ready(self) -> None:
        status, out, err, _, _ = _run_session(
            native_fnv_library_path=os.path.basename(_ABS_LIBRARY_PATH),
            native_fnv_loader=load_native_fnv1a32,
        )
        self._assert_startup_failed_without_ready(status, out, err)

    def test_loader_failure_closes_nothing_twice_and_creates_no_runtime(self) -> None:
        runtime = _FakeRuntime()
        importer = _make_importer(mediapipe_module=_make_fake_mediapipe_module(runtime=runtime))
        loader = _RecordingNativeLoader(error=NativeFnv1a32LoadError("x"))
        with mock.patch.object(session, "create_face_landmarker_runtime") as create:
            status, _, _, _, _ = _run_session(importer=importer, native_fnv_loader=loader)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        create.assert_not_called()
        self.assertEqual(runtime.close_calls, 0)

    def test_session_module_holds_no_checksum_implementation(self) -> None:
        source = inspect.getsource(session)
        for forbidden in ("def _fnv1a32", "16777619", "2166136261", "ctypes", "os.environ"):
            self.assertNotIn(forbidden, source)


class _PipeFrameEndpoint:
    """A real OS pipe used as the reader's frame endpoint (test seam only)."""

    def __init__(self, frame_bytes: bytes) -> None:
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, frame_bytes)
        finally:
            os.close(write_fd)
        self.read_fd = read_fd

    def close_if_still_open(self) -> None:
        # The reader closes the endpoint on every terminal outcome once it has
        # resolved it; a session that never reads a frame never resolves it.
        try:
            os.close(self.read_fd)
        except OSError:
            pass

    def patches(self):
        return (
            mock.patch("helper_frame_reader._detect_platform_kind", return_value="posix"),
            mock.patch("helper_frame_reader._resolve_posix_frame_fd", return_value=self.read_fd),
        )


def _frame_packet_bytes(request_id: int, frame_timestamp_ms: int, payload: bytes) -> bytes:
    header = (
        b"LVKF"
        + (1).to_bytes(2, "little")
        + (48).to_bytes(2, "little")
        + request_id.to_bytes(8, "little")
        + frame_timestamp_ms.to_bytes(8, "little", signed=True)
        + (2).to_bytes(4, "little")
        + (2).to_bytes(4, "little")
        + (6).to_bytes(4, "little")
        + (1).to_bytes(4, "little")
        + len(payload).to_bytes(8, "little")
    )
    return header + payload


def _control_bytes(*lines: dict) -> io.BytesIO:
    return io.BytesIO(b"".join(json.dumps(line, separators=(",", ":")).encode() + b"\n" for line in lines))


class NativeChecksumFlowTests(unittest.TestCase):
    """Real reader + real RGB stage; only the checksum callable is recorded."""

    def _run_real_reader_session(self, loader, frames, *, stop: bool = True):
        payloads = b"".join(_frame_packet_bytes(rid, ts, payload) for rid, ts, payload in frames)
        endpoint = _PipeFrameEndpoint(payloads)
        lines = [
            {"type": "request", "schemaVersion": 1, "requestId": rid, "frameTimestampMs": ts}
            for rid, ts, _ in frames
        ]
        if stop:
            lines.append({"type": "stop", "schemaVersion": 1})
        output_stream, error_stream = io.StringIO(), io.StringIO()
        first, second = endpoint.patches()
        with first, second:
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH,
                _ABS_LIBRARY_PATH,
                _control_bytes(*lines),
                output_stream,
                error_stream,
                module_importer=_make_importer(),
                native_fnv_loader=loader,
            )
        if not frames:
            endpoint.close_if_still_open()
        return status, output_stream.getvalue(), error_stream.getvalue()

    def test_both_stages_invoke_session_checksum_for_every_accepted_frame(self) -> None:
        loader = _RecordingNativeLoader()
        payload_a = bytes(range(12))
        payload_b = b"\x00" * 6 + bytes(range(250, 256))
        status, out, err = self._run_real_reader_session(
            loader, [(7, 1000, payload_a), (9, 2000, payload_b)]
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(err, "")
        self.assertEqual(loader.load_calls, [_ABS_LIBRARY_PATH])
        # Exactly two independent invocations per frame: assembly, then RGB.
        self.assertEqual(loader.checksum_calls, [payload_a, payload_a, payload_b, payload_b])
        results = [json.loads(line) for line in _lines(out) if json.loads(line)["type"] == "result"]
        self.assertEqual(
            [result["frameAck"]["checksum"] for result in results],
            [_reference_fnv1a32(payload_a), _reference_fnv1a32(payload_b)],
        )

    def test_frame_assembly_checksum_failure_produces_no_result(self) -> None:
        loader = _RecordingNativeLoader(checksum_error_on_call=1)
        status, out, err = self._run_real_reader_session(loader, [(7, 1000, bytes(range(12)))])
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INPUT_FAILED)
        self.assertEqual([json.loads(line)["type"] for line in _lines(out)], ["ready"])
        self.assertEqual(err, "[helper] session: failed (code=input_failed)\n")
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)
        self.assertEqual(len(loader.checksum_calls), 1)

    def test_rgb_checksum_failure_produces_no_result(self) -> None:
        loader = _RecordingNativeLoader(checksum_error_on_call=2)
        status, out, err = self._run_real_reader_session(loader, [(7, 1000, bytes(range(12)))])
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED)
        self.assertEqual([json.loads(line)["type"] for line in _lines(out)], ["ready"])
        self.assertEqual(err, "[helper] session: failed (code=frame_conversion_failed)\n")
        self.assertNotIn(_SECRET_EXCEPTION_TEXT, err)
        self.assertEqual(len(loader.checksum_calls), 2)

    def test_second_frame_rgb_failure_keeps_first_result_only(self) -> None:
        loader = _RecordingNativeLoader(checksum_error_on_call=4)
        status, out, _ = self._run_real_reader_session(
            loader, [(7, 1000, bytes(range(12))), (9, 2000, bytes(range(12, 24)))]
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED)
        types = [json.loads(line)["type"] for line in _lines(out)]
        self.assertEqual(types, ["ready", "result"])

    def test_inconsistent_checksum_between_stages_produces_no_result(self) -> None:
        calls: list = []

        def flaky_checksum(data: bytes) -> int:
            calls.append(data)
            value = _reference_fnv1a32(data)
            return value if len(calls) == 1 else value ^ 1

        status, out, _ = self._run_real_reader_session(
            lambda path: flaky_checksum, [(7, 1000, bytes(range(12)))]
        )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED)
        self.assertEqual([json.loads(line)["type"] for line in _lines(out)], ["ready"])
        self.assertEqual(len(calls), 2)

    def test_structurally_invalid_frame_never_invokes_checksum(self) -> None:
        loader = _RecordingNativeLoader()
        # Header correlates with requestId 8 while the request says 7.
        endpoint = _PipeFrameEndpoint(_frame_packet_bytes(8, 1000, bytes(range(12))))
        first, second = endpoint.patches()
        output_stream = io.StringIO()
        with first, second:
            status = run_face_landmarker_helper_session(
                _ABS_MODEL_PATH,
                _ABS_LIBRARY_PATH,
                _control_bytes({"type": "request", "schemaVersion": 1, "requestId": 7, "frameTimestampMs": 1000}),
                output_stream,
                io.StringIO(),
                module_importer=_make_importer(),
                native_fnv_loader=loader,
            )
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.INPUT_FAILED)
        self.assertEqual(loader.checksum_calls, [])

    def test_clean_eof_and_stop_unchanged(self) -> None:
        loader = _RecordingNativeLoader()
        status, out, _ = self._run_real_reader_session(loader, [], stop=False)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.EOF_STOPPED)
        self.assertEqual([json.loads(line)["type"] for line in _lines(out)], ["ready", "stopped"])
        status, out, _ = self._run_real_reader_session(_RecordingNativeLoader(), [], stop=True)
        self.assertEqual(status, FaceLandmarkerHelperSessionStatus.STOPPED)
        self.assertEqual(
            [json.loads(line)["type"] for line in _lines(out)], ["ready", "stopping", "stopped"]
        )
        self.assertEqual(loader.checksum_calls, [])


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
            model_path, _ABS_LIBRARY_PATH, None, output_stream, error_stream, module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
                model_path, _ABS_LIBRARY_PATH, None, output_stream, error_stream, module_importer=importer, native_fnv_loader=_fake_native_fnv_loader
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
