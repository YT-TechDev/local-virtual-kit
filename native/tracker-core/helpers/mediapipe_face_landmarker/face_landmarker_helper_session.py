"""Composes the bounded MediaPipe Python helper session entry point (#558).

This module owns only the Python helper session: strict explicit startup
argument consumption, lazy NumPy/MediaPipe API resolution, one runtime
lifecycle, one current-frame operation at a time, bounded lifecycle/result
stdout writing and flushing, safe bounded stderr failure codes, and
deterministic reader/runtime cleanup.

It composes the existing merged boundaries (#549-#553, #557) without
duplicating their control JSON parsing, frame header parsing, checksum
computation, RGB conversion, MediaPipe options/runtime/image/inference,
candidate selection/mapping, canonical LOST composition, or result JSON
validation. Native Core remains the sole camera owner and owns process
supervision, timeouts, forced termination, fallback, and public MotionFrame
output; none of that is implemented here.
"""

from __future__ import annotations

import os
import sys
from enum import Enum
from importlib import import_module
from typing import Callable

from face_landmarker_inference import (
    FaceLandmarkerInferenceApi,
    FaceLandmarkerInferenceOutcome,
    run_face_landmarker_single_frame_inference,
)
from face_landmarker_result_composition import (
    FaceLandmarkerResultComposition,
    compose_face_landmarker_inference_outcome,
)
from face_landmarker_runtime import (
    FaceLandmarkerRuntimeCloseStatus,
    FaceLandmarkerRuntimeCreationStatus,
    FaceLandmarkerRuntimeLifecycle,
    FaceLandmarkerRuntimeState,
    create_face_landmarker_runtime,
)
from helper_frame_reader import (
    HelperFrameInputReadOutcome,
    HelperFrameInputReadStatus,
    HelperFrameInputReader,
)
from helper_frame_rgb import (
    ValidatedHelperRgb24Frame,
    convert_validated_helper_frame_input_to_rgb24,
)
from helper_result_json import serialize_helper_result_line

# Mirrors kHelperMaxLineBytes in helper_message.h / helper_frame_input.py.
_MAX_LINE_CONTENT_BYTES = 2048

# Approved v0.13.0 (#556) lifecycle line shapes. Fixed, compact, ASCII.
_READY_LINE = (
    '{"type":"ready","schemaVersion":1,"source":"mediapipe-face-landmarker"}\n'
)
_STOPPING_LINE = '{"type":"stopping","schemaVersion":1,"reason":"session-stop"}\n'
_STOPPED_EXPLICIT_LINE = (
    '{"type":"stopped","schemaVersion":1,"reason":"session-stop"}\n'
)
_STOPPED_EOF_LINE = '{"type":"stopped","schemaVersion":1,"reason":"session-eof"}\n'


class FaceLandmarkerHelperSessionStatus(Enum):
    STOPPED = "stopped"
    EOF_STOPPED = "eof_stopped"
    STARTUP_FAILED = "startup_failed"
    INPUT_FAILED = "input_failed"
    FRAME_CONVERSION_FAILED = "frame_conversion_failed"
    INFERENCE_CONTRACT_FAILED = "inference_contract_failed"
    COMPOSITION_FAILED = "composition_failed"
    SERIALIZATION_FAILED = "serialization_failed"
    OUTPUT_FAILED = "output_failed"
    CLOSE_FAILED = "close_failed"
    INTERNAL_FAILURE = "internal_failure"


_SUCCESS_STATUSES = (
    FaceLandmarkerHelperSessionStatus.STOPPED,
    FaceLandmarkerHelperSessionStatus.EOF_STOPPED,
)


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


def _parse_startup_arguments(argv: object) -> str | None:
    """Strictly parses the exact `--model-asset-path <path>` CLI contract."""
    if type(argv) is not list:
        return None
    if len(argv) != 2:
        return None
    if argv[0] != "--model-asset-path":
        return None

    value = argv[1]
    if not _is_valid_model_asset_path(value):
        return None
    if not os.path.isabs(value):
        return None

    return value


def _is_valid_protocol_line(line: object) -> bool:
    if type(line) is not str:
        return False
    if not line.endswith("\n"):
        return False
    if line.count("\n") != 1:
        return False
    content = line[:-1]
    if "\r" in content:
        return False
    try:
        encoded = content.encode("ascii")
    except Exception:
        return False
    if len(encoded) > _MAX_LINE_CONTENT_BYTES:
        return False
    return True


def _write_protocol_line(output_stream: object, line: str) -> bool:
    """Writes and flushes one approved lifecycle/result line exactly once."""
    if not _is_valid_protocol_line(line):
        return False
    try:
        written = output_stream.write(line)
        if type(written) is not int:
            return False
        if written != len(line):
            return False
        output_stream.flush()
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        return False
    return True


def _write_stderr_diagnostic(
    error_stream: object, status: FaceLandmarkerHelperSessionStatus
) -> None:
    line = f"[helper] session: failed (code={status.value})\n"
    try:
        error_stream.write(line)
        error_stream.flush()
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        pass


class _SessionCleanup:
    """Call-scoped, at-most-once cleanup of the reader and runtime lifecycle."""

    __slots__ = ("_reader", "_lifecycle", "_done", "_result")

    def __init__(self) -> None:
        self._reader: HelperFrameInputReader | None = None
        self._lifecycle: FaceLandmarkerRuntimeLifecycle | None = None
        self._done = False
        self._result = True

    def register_reader(self, reader: HelperFrameInputReader) -> None:
        self._reader = reader

    def register_lifecycle(self, lifecycle: FaceLandmarkerRuntimeLifecycle) -> None:
        self._lifecycle = lifecycle

    def close_all(self) -> bool:
        if self._done:
            return self._result
        self._done = True

        reader_ok = True
        reader = self._reader
        if reader is not None:
            reader_ok = bool(reader.close())

        lifecycle_ok = True
        lifecycle = self._lifecycle
        if lifecycle is not None:
            lifecycle_ok = lifecycle.close() in (
                FaceLandmarkerRuntimeCloseStatus.CLOSED,
                FaceLandmarkerRuntimeCloseStatus.NOT_READY,
            )

        self._result = reader_ok and lifecycle_ok
        return self._result


def _run_one_frame(
    frame_input: object,
    lifecycle: FaceLandmarkerRuntimeLifecycle,
    inference_api: FaceLandmarkerInferenceApi,
    output_stream: object,
) -> FaceLandmarkerHelperSessionStatus | None:
    """Runs exactly one current-frame operation. Returns None on success."""
    try:
        rgb_frame = convert_validated_helper_frame_input_to_rgb24(frame_input)
    except Exception:
        return FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED
    if type(rgb_frame) is not ValidatedHelperRgb24Frame:
        return FaceLandmarkerHelperSessionStatus.FRAME_CONVERSION_FAILED

    try:
        inference_outcome = run_face_landmarker_single_frame_inference(
            rgb_frame, lifecycle, inference_api
        )
    except Exception:
        return FaceLandmarkerHelperSessionStatus.INFERENCE_CONTRACT_FAILED
    if type(inference_outcome) is not FaceLandmarkerInferenceOutcome:
        return FaceLandmarkerHelperSessionStatus.INFERENCE_CONTRACT_FAILED

    try:
        composition = compose_face_landmarker_inference_outcome(inference_outcome)
    except Exception:
        return FaceLandmarkerHelperSessionStatus.COMPOSITION_FAILED
    if type(composition) is not FaceLandmarkerResultComposition:
        return FaceLandmarkerHelperSessionStatus.COMPOSITION_FAILED

    try:
        result_line = serialize_helper_result_line(
            composition.payload,
            request_id=composition.request_id,
            frame_timestamp_ms=composition.frame_timestamp_ms,
            inference_ms=composition.inference_ms,
            frame_ack=composition.frame_ack,
        )
    except Exception:
        return FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED
    if not _is_valid_protocol_line(result_line):
        return FaceLandmarkerHelperSessionStatus.SERIALIZATION_FAILED

    if not _write_protocol_line(output_stream, result_line):
        return FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED

    return None


def _finish_stop(
    cleanup: _SessionCleanup, output_stream: object, error_stream: object
) -> FaceLandmarkerHelperSessionStatus:
    stopping_ok = _write_protocol_line(output_stream, _STOPPING_LINE)
    cleanup_ok = cleanup.close_all()

    if not cleanup_ok:
        _write_stderr_diagnostic(
            error_stream, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED
        )
        return FaceLandmarkerHelperSessionStatus.CLOSE_FAILED

    if not stopping_ok:
        _write_stderr_diagnostic(
            error_stream, FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED
        )
        return FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED

    if not _write_protocol_line(output_stream, _STOPPED_EXPLICIT_LINE):
        _write_stderr_diagnostic(
            error_stream, FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED
        )
        return FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED

    return FaceLandmarkerHelperSessionStatus.STOPPED


def _finish_eof(
    cleanup: _SessionCleanup, output_stream: object, error_stream: object
) -> FaceLandmarkerHelperSessionStatus:
    cleanup_ok = cleanup.close_all()

    if not cleanup_ok:
        _write_stderr_diagnostic(
            error_stream, FaceLandmarkerHelperSessionStatus.CLOSE_FAILED
        )
        return FaceLandmarkerHelperSessionStatus.CLOSE_FAILED

    if not _write_protocol_line(output_stream, _STOPPED_EOF_LINE):
        _write_stderr_diagnostic(
            error_stream, FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED
        )
        return FaceLandmarkerHelperSessionStatus.OUTPUT_FAILED

    return FaceLandmarkerHelperSessionStatus.EOF_STOPPED


def run_face_landmarker_helper_session(
    model_asset_path: str,
    control_stream: object,
    output_stream: object,
    error_stream: object,
    *,
    module_importer: Callable[[str], object] = import_module,
) -> FaceLandmarkerHelperSessionStatus:
    """Runs one bounded MediaPipe Face Landmarker helper session to completion."""
    cleanup = _SessionCleanup()

    def _fail(
        status: FaceLandmarkerHelperSessionStatus,
    ) -> FaceLandmarkerHelperSessionStatus:
        cleanup_ok = cleanup.close_all()
        final_status = (
            status if cleanup_ok else FaceLandmarkerHelperSessionStatus.CLOSE_FAILED
        )
        _write_stderr_diagnostic(error_stream, final_status)
        return final_status

    def _body() -> FaceLandmarkerHelperSessionStatus:
        if not _is_valid_model_asset_path(model_asset_path):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if not callable(module_importer):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        try:
            numpy_module = module_importer("numpy")
        except Exception:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        try:
            mediapipe_module = module_importer("mediapipe")
        except Exception:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        try:
            numpy_frombuffer = numpy_module.frombuffer
            numpy_uint8 = numpy_module.uint8
            numpy_ascontiguousarray = numpy_module.ascontiguousarray
            image_constructor = mediapipe_module.Image
            srgb_image_format = mediapipe_module.ImageFormat.SRGB
        except Exception:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        if not callable(numpy_frombuffer):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if numpy_uint8 is None:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if not callable(numpy_ascontiguousarray):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if not callable(image_constructor):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if srgb_image_format is None:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        def _closed_mediapipe_importer(name: str) -> object:
            if name != "mediapipe":
                raise ValueError("unsupported module request")
            return mediapipe_module

        try:
            lifecycle = create_face_landmarker_runtime(
                model_asset_path, module_importer=_closed_mediapipe_importer
            )
        except Exception:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        if type(lifecycle) is not FaceLandmarkerRuntimeLifecycle:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        cleanup.register_lifecycle(lifecycle)

        if (
            lifecycle.creation_status
            is not FaceLandmarkerRuntimeCreationStatus.SUCCESS
        ):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if lifecycle.state is not FaceLandmarkerRuntimeState.READY:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        try:
            runtime = lifecycle.borrow_ready_runtime()
        except Exception:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)
        if runtime is None:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        inference_api = FaceLandmarkerInferenceApi(
            numpy_frombuffer=numpy_frombuffer,
            numpy_uint8=numpy_uint8,
            numpy_ascontiguousarray=numpy_ascontiguousarray,
            image_constructor=image_constructor,
            srgb_image_format=srgb_image_format,
        )

        try:
            reader = HelperFrameInputReader(control_stream)
        except Exception:
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        cleanup.register_reader(reader)

        if not _write_protocol_line(output_stream, _READY_LINE):
            return _fail(FaceLandmarkerHelperSessionStatus.STARTUP_FAILED)

        while True:
            try:
                outcome = reader.read_next()
            except (KeyboardInterrupt, SystemExit):
                raise
            except Exception:
                return _fail(FaceLandmarkerHelperSessionStatus.INPUT_FAILED)

            if type(outcome) is not HelperFrameInputReadOutcome:
                return _fail(FaceLandmarkerHelperSessionStatus.INPUT_FAILED)

            read_status = outcome.status
            if type(read_status) is not HelperFrameInputReadStatus:
                return _fail(FaceLandmarkerHelperSessionStatus.INPUT_FAILED)

            if read_status is HelperFrameInputReadStatus.FRAME:
                frame_failure = _run_one_frame(
                    outcome.frame_input, lifecycle, inference_api, output_stream
                )
                if frame_failure is not None:
                    return _fail(frame_failure)
                continue

            if read_status is HelperFrameInputReadStatus.STOP:
                return _finish_stop(cleanup, output_stream, error_stream)

            if read_status is HelperFrameInputReadStatus.EOF:
                return _finish_eof(cleanup, output_stream, error_stream)

            return _fail(FaceLandmarkerHelperSessionStatus.INPUT_FAILED)

    try:
        return _body()
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        return _fail(FaceLandmarkerHelperSessionStatus.INTERNAL_FAILURE)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    model_asset_path = _parse_startup_arguments(argv)
    if model_asset_path is None:
        _write_stderr_diagnostic(
            sys.stderr, FaceLandmarkerHelperSessionStatus.STARTUP_FAILED
        )
        return 1

    status = run_face_landmarker_helper_session(
        model_asset_path, sys.stdin.buffer, sys.stdout, sys.stderr
    )

    if status in _SUCCESS_STATUSES:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
