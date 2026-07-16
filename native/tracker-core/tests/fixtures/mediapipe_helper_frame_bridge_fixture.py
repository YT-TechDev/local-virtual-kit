"""Test-only cross-runtime fixture for the Native Core <-> Python MediaPipe
helper frame bridge (#571).

This file is NOT part of the production helper: it lives outside
native/tracker-core/helpers/mediapipe_face_landmarker, is never selected by
runtime/backend selection, and is never packaged. It exists only so the
dedicated native smoke (mediapipe_helper_frame_bridge_smoke.cpp) can launch a
real Python child through HelperProcessSession's merged exact-invocation
route and observe the real production session/reader/RGB/inference/
composition/serializer chain end to end, with only NumPy/MediaPipe faked.

It adds the existing production helper directory to sys.path lexically (from
__file__, never cwd or a resolved/existence-checked path), then imports and
reuses the production entry points unchanged:
  - _parse_startup_arguments()
  - run_face_landmarker_helper_session()
  - FaceLandmarkerHelperSessionStatus

The only injected behavior is a bounded, test-only output-stream adapter that
wraps sys.stdout and, based solely on the production result's
frameTimestampMs (one of four fixed values: 571001/571002/571003/571004),
either forwards the real serialized result unchanged (571001, and 571004
before exiting) or applies one bounded post-serialization mutation and
reserialization before exiting (571002, 571003). It never touches
control-line reading, frame reading, RGB conversion, inference, or
composition -- those remain the real production code paths, exercised
against a real fd/handle frame endpoint.

Standard library only, with no third-party test-double framework, no scratch
file storage, no file I/O beyond the lexical sys.path setup, no child process
or network use of its own, no background execution thread, no environment-
based scenario selection, and no inspection of the supplied model path.
"""

from __future__ import annotations

import json
import os
import sys
import types

_FIXTURE_DIR = os.path.dirname(__file__)
_PRODUCTION_HELPER_DIR = os.path.normpath(
    os.path.join(_FIXTURE_DIR, "..", "..", "helpers", "mediapipe_face_landmarker")
)
sys.path.insert(0, _PRODUCTION_HELPER_DIR)

from face_landmarker_helper_session import (  # noqa: E402
    FaceLandmarkerHelperSessionStatus,
    _parse_startup_arguments,
    run_face_landmarker_helper_session,
)

_SUCCESS_STATUSES = (
    FaceLandmarkerHelperSessionStatus.STOPPED,
    FaceLandmarkerHelperSessionStatus.EOF_STOPPED,
)

# Fixed scenario-selection timestamps (see docstring above). Never derived
# from an environment variable, file, or argv -- selected only from the
# production result's own frameTimestampMs field.
_NORMAL_SUCCESS_TIMESTAMP_MS = 571001
_REQUEST_CORRELATION_MISMATCH_TIMESTAMP_MS = 571002
_FRAME_ACK_MISMATCH_TIMESTAMP_MS = 571003
_EARLY_EXIT_TIMESTAMP_MS = 571004

_STARTUP_FAILED_DIAGNOSTIC_LINE = "[helper] session: failed (code=startup_failed)\n"


# =============================================================================
# Fake NumPy / MediaPipe surfaces (standard library only)
# =============================================================================


class _FakeArray:
    __slots__ = ("shape", "dtype", "flags")

    def __init__(self, shape: tuple, dtype: object) -> None:
        self.shape = shape
        self.dtype = dtype
        self.flags = types.SimpleNamespace(c_contiguous=True)


class _FakeFlatArray:
    __slots__ = ("_dtype",)

    def __init__(self, dtype: object) -> None:
        self._dtype = dtype

    def reshape(self, shape: tuple) -> "_FakeArray":
        return _FakeArray(shape, self._dtype)


class _FakeNoFaceCandidateResult:
    __slots__ = (
        "face_landmarks",
        "face_blendshapes",
        "facial_transformation_matrixes",
    )

    def __init__(self) -> None:
        self.face_landmarks = ()
        self.face_blendshapes = ()
        self.facial_transformation_matrixes = ()


class _FakeFaceLandmarkerRuntime:
    """Retains no frame history: detect() always returns a fresh no-face
    result and close() always succeeds."""

    def detect(self, image: object) -> _FakeNoFaceCandidateResult:
        return _FakeNoFaceCandidateResult()

    def close(self) -> None:
        return None


def _fake_numpy_module() -> types.SimpleNamespace:
    uint8_sentinel = object()

    def frombuffer(data: bytes, dtype: object) -> _FakeFlatArray:
        return _FakeFlatArray(dtype)

    def ascontiguousarray(array: _FakeArray, dtype: object) -> _FakeArray:
        return _FakeArray(array.shape, dtype)

    return types.SimpleNamespace(
        frombuffer=frombuffer,
        uint8=uint8_sentinel,
        ascontiguousarray=ascontiguousarray,
    )


def _fake_mediapipe_module() -> types.SimpleNamespace:
    runtime = _FakeFaceLandmarkerRuntime()

    def create_from_options(options: object) -> _FakeFaceLandmarkerRuntime:
        return runtime

    face_landmarker_type = types.SimpleNamespace(
        create_from_options=create_from_options
    )
    vision = types.SimpleNamespace(
        FaceLandmarkerOptions=lambda **kwargs: types.SimpleNamespace(kwargs=kwargs),
        RunningMode=types.SimpleNamespace(IMAGE=object()),
        FaceLandmarker=face_landmarker_type,
    )
    tasks = types.SimpleNamespace(
        BaseOptions=lambda **kwargs: types.SimpleNamespace(kwargs=kwargs),
        vision=vision,
    )
    return types.SimpleNamespace(
        tasks=tasks,
        Image=lambda *, image_format, data: object(),
        ImageFormat=types.SimpleNamespace(SRGB=object()),
    )


def _fake_module_importer(name: str) -> object:
    if name == "numpy":
        return _fake_numpy_module()
    if name == "mediapipe":
        return _fake_mediapipe_module()
    raise ValueError("unsupported module request")


# =============================================================================
# Bounded post-serialization result-fault injection
# =============================================================================


def _apply_fault_injection(document: dict) -> tuple[dict, bool]:
    """Returns (possibly-mutated document, should_exit_after_flush).

    Selects behavior only from document["frameTimestampMs"]. Only the two
    mutation-target timestamps (571002/571003) are mutated and reserialized;
    every other timestamp (including the normal 571001 success value) is
    left unmutated with should_exit=False. The 571004 early-exit case is
    handled earlier in _transform() -- via an unmodified, non-reserialized
    line -- and never reaches this function.
    """
    timestamp = document.get("frameTimestampMs")

    if timestamp == _REQUEST_CORRELATION_MISMATCH_TIMESTAMP_MS:
        request_id = document.get("requestId")
        if type(request_id) is int:
            document["requestId"] = request_id + 1
        return document, True

    if timestamp == _FRAME_ACK_MISMATCH_TIMESTAMP_MS:
        frame_ack = document.get("frameAck")
        if type(frame_ack) is dict:
            checksum = frame_ack.get("checksum")
            if type(checksum) is int:
                frame_ack["checksum"] = (checksum + 1) & 0xFFFFFFFF
        return document, True

    return document, False


class _ResultFaultInjectionStream:
    """Wraps sys.stdout to inject bounded post-serialization result faults.

    Only ever transforms a "result" line matching one of the three fixed
    scenario timestamps; every other line (ready/stopping/stopped, or a
    result at the normal 571001 timestamp) is forwarded completely
    unchanged. Every candidate line is parsed only to identify its protocol
    type and frameTimestampMs. Of the three, only 571002/571003 are then
    mutated and reserialized; 571004 is parsed only for that result/
    timestamp selection, then the original production serializer line is
    forwarded unchanged, byte-for-byte, without reserialization, before
    exiting. Never reads a control line, a frame, or calls into RGB
    conversion, inference, composition, or the serializer itself -- this
    adapter only ever sees the line the production serializer already
    produced.
    """

    def __init__(self, real_stream: object) -> None:
        self._real_stream = real_stream
        self._pending_exit = False

    def _transform(self, line: str) -> tuple[str, bool] | None:
        if not line.endswith("\n"):
            return None
        content = line[:-1]
        try:
            document = json.loads(content)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception:
            return None
        if type(document) is not dict:
            return None
        if document.get("type") != "result":
            return None

        if document.get("frameTimestampMs") == _EARLY_EXIT_TIMESTAMP_MS:
            # Byte-for-byte preservation: this line was already parsed
            # above only to identify its result type and timestamp: it is
            # never reserialized. Forward the original production
            # serializer line unchanged and exit after it is flushed.
            return line, True

        mutated, should_exit = _apply_fault_injection(document)
        if not should_exit:
            return None

        try:
            serialized = (
                json.dumps(
                    mutated, ensure_ascii=True, allow_nan=False, separators=(",", ":")
                )
                + "\n"
            )
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception:
            return None
        return serialized, True

    def write(self, line: object) -> int:
        if type(line) is not str:
            return self._real_stream.write(line)

        transformed = self._transform(line)
        if transformed is None:
            return self._real_stream.write(line)

        text, should_exit = transformed
        written = self._real_stream.write(text)
        if written != len(text):
            # Never report a successful count after a partial underlying
            # write -- propagate the raw (mismatched) count as-is.
            return written
        if should_exit:
            self._pending_exit = True
        # Contract: when a line is transformed and fully written, report the
        # ORIGINAL input line's length, not the transformed line's length.
        return len(line)

    def flush(self) -> None:
        self._real_stream.flush()
        if self._pending_exit:
            self._pending_exit = False
            # Deliberately SystemExit (never a generic exception): the
            # production write path re-raises KeyboardInterrupt/SystemExit
            # instead of swallowing it, so this terminates the fixture
            # process immediately -- exactly as an early child exit would,
            # and strictly before any further control-line read (including
            # a pending stop request).
            raise SystemExit(0)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    model_asset_path = _parse_startup_arguments(argv)
    if model_asset_path is None:
        sys.stderr.write(_STARTUP_FAILED_DIAGNOSTIC_LINE)
        sys.stderr.flush()
        return 1

    output_stream = _ResultFaultInjectionStream(sys.stdout)

    status = run_face_landmarker_helper_session(
        model_asset_path,
        sys.stdin.buffer,
        output_stream,
        sys.stderr,
        module_importer=_fake_module_importer,
    )

    if status in _SUCCESS_STATUSES:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
