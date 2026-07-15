"""Optional local opt-in smoke for the real MediaPipe Face Landmarker path.

This module is local validation tooling, not a production dependency. At
module load time it imports only the standard library and the existing
production modules it orchestrates (`helper_frame_input`, `helper_frame_rgb`,
`face_landmarker_runtime`, `face_landmarker_inference`,
`face_landmarker_result_composition`, `helper_tracking_payload`). Real
`numpy`/`mediapipe` imports happen lazily, only inside an explicitly
requested real run, through an injectable importer.

The smoke reuses the existing production path end to end -- frame assembly,
BGR-to-RGB conversion, runtime construction, single-frame inference, and
result composition -- without a second runtime, image, inference, or mapping
implementation. It emits exactly one compact, sanitized JSON report line
distinguishing SKIPPED (no explicit opt-in), PASSED, and FAILED. Evidence
never contains an interpreter/model path, environment contents, raw
exception text, frame bytes, checksums, or raw MediaPipe results.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping

from face_landmarker_inference import (
    FaceLandmarkerInferenceApi,
    FaceLandmarkerInferenceStatus,
    run_face_landmarker_single_frame_inference,
)
from face_landmarker_result_composition import compose_face_landmarker_inference_outcome
from face_landmarker_runtime import (
    FaceLandmarkerRuntimeCloseStatus,
    FaceLandmarkerRuntimeCreationStatus,
    create_face_landmarker_runtime,
)
from helper_frame_input import (
    HelperFramePacketHeader,
    HelperFrameRequest,
    assemble_validated_helper_frame_input,
)
from helper_frame_rgb import convert_validated_helper_frame_input_to_rgb24
from helper_tracking_payload import HelperTrackingPayloadStatus

_CHECK_NAME = "mediapipe-face-landmarker-runtime-smoke"
_SCHEMA_VERSION = 1

_REAL_RUN_FLAG = "--real-run"
_OPT_IN_ENV_VAR = "LVK_MEDIAPIPE_SMOKE"
_OPT_IN_VALUE = "1"
_MODEL_ASSET_PATH_ENV_VAR = "LVK_MEDIAPIPE_MODEL_ASSET_PATH"

_SKIPPED_REASON = "opt_in_required"

_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$")

_INPUT_CATEGORY = "synthetic-solid-bgr24"
_FRAME_REQUEST_ID = 1
_FRAME_TIMESTAMP_MS = 0
_FRAME_WIDTH = 64
_FRAME_HEIGHT = 64
_FRAME_ROW_STRIDE_BYTES = 192
_FRAME_PAYLOAD_BYTES = 12288
_FRAME_SOLID_BYTE_VALUE = 128

_PAYLOAD_STATUS_TEXT = {
    HelperTrackingPayloadStatus.TRACKING: "tracking",
    HelperTrackingPayloadStatus.LOST: "lost",
}

_DEFAULT_EVIDENCE_FIELDS: dict[str, object] = {
    "python_version": None,
    "mediapipe_version": None,
    "input_category": None,
    "input_width": None,
    "input_height": None,
    "runtime_creation_status": None,
    "inference_status": None,
    "inference_ms": None,
    "payload_status": None,
    "close_status": None,
}


class SmokeStatus(Enum):
    SKIPPED = "SKIPPED"
    PASSED = "PASSED"
    FAILED = "FAILED"


@dataclass(frozen=True)
class SmokeReport:
    status: SmokeStatus
    reason: str | None
    python_version: str | None
    mediapipe_version: str | None
    input_category: str | None
    input_width: int | None
    input_height: int | None
    runtime_creation_status: str | None
    inference_status: str | None
    inference_ms: float | None
    payload_status: str | None
    close_status: str | None


def build_skipped_report() -> SmokeReport:
    """Returns the fixed SKIPPED report used when opt-in is absent."""
    fields = dict(_DEFAULT_EVIDENCE_FIELDS)
    return SmokeReport(status=SmokeStatus.SKIPPED, reason=_SKIPPED_REASON, **fields)


def _failed_report(reason: str, **overrides: object) -> SmokeReport:
    fields = dict(_DEFAULT_EVIDENCE_FIELDS)
    fields.update(overrides)
    return SmokeReport(status=SmokeStatus.FAILED, reason=reason, **fields)


def _passed_report(**overrides: object) -> SmokeReport:
    fields = dict(_DEFAULT_EVIDENCE_FIELDS)
    fields.update(overrides)
    return SmokeReport(status=SmokeStatus.PASSED, reason=None, **fields)


def serialize_smoke_report(report: SmokeReport) -> str:
    """Serializes one compact, deterministic JSON report line (with trailing `\\n`).

    Requires `type(report) is SmokeReport` exactly. The field set is closed
    and matches the documented schema exactly; no additional or raw
    evidence is ever included.
    """
    if type(report) is not SmokeReport:
        raise TypeError("report must be exactly SmokeReport")

    document = {
        "schemaVersion": _SCHEMA_VERSION,
        "check": _CHECK_NAME,
        "status": report.status.value,
        "reason": report.reason,
        "pythonVersion": report.python_version,
        "mediapipeVersion": report.mediapipe_version,
        "inputCategory": report.input_category,
        "inputWidth": report.input_width,
        "inputHeight": report.input_height,
        "runtimeCreationStatus": report.runtime_creation_status,
        "inferenceStatus": report.inference_status,
        "inferenceMs": report.inference_ms,
        "payloadStatus": report.payload_status,
        "closeStatus": report.close_status,
    }
    content = json.dumps(
        document, ensure_ascii=True, allow_nan=False, separators=(",", ":")
    )
    return content + "\n"


def is_opted_in(env: Mapping[str, str]) -> bool:
    """True only when the opt-in environment variable is exactly "1"."""
    return env.get(_OPT_IN_ENV_VAR) == _OPT_IN_VALUE


def _resolve_model_asset_path(env: Mapping[str, str]) -> tuple[str | None, str | None]:
    """Resolves and validates the model asset path from `env`.

    Returns `(path, None)` on success or `(None, reason)` on failure. Never
    returns the raw path in the failure case; the caller must not print the
    path on the success case either.
    """
    raw = env.get(_MODEL_ASSET_PATH_ENV_VAR)
    if type(raw) is not str or len(raw) == 0:
        return None, "model_configuration_invalid"
    if "\0" in raw or "\r" in raw or "\n" in raw:
        return None, "model_configuration_invalid"
    if not os.path.isabs(raw):
        return None, "model_configuration_invalid"

    try:
        exists = os.path.isfile(raw)
    except OSError:
        return None, "model_unavailable"

    if not exists:
        return None, "model_unavailable"

    return raw, None


def _sanitize_version(value: object) -> str | None:
    """Accepts only a short, safe version-like string; else returns None."""
    if type(value) is not str:
        return None
    if not _VERSION_PATTERN.match(value):
        return None
    return value


def _python_version_string() -> str | None:
    try:
        info = sys.version_info
        candidate = f"{int(info.major)}.{int(info.minor)}.{int(info.micro)}"
    except Exception:
        return None
    return _sanitize_version(candidate)


def _prepare_synthetic_frame() -> object | None:
    """Builds one deterministic in-memory synthetic BGR24 frame and converts it.

    Reuses `assemble_validated_helper_frame_input` and
    `convert_validated_helper_frame_input_to_rgb24` exactly; never reads a
    file, camera, or network resource.
    """
    try:
        request = HelperFrameRequest(
            request_id=_FRAME_REQUEST_ID, frame_timestamp_ms=_FRAME_TIMESTAMP_MS
        )
        header = HelperFramePacketHeader(
            sequence=_FRAME_REQUEST_ID,
            frame_timestamp_ms=_FRAME_TIMESTAMP_MS,
            width=_FRAME_WIDTH,
            height=_FRAME_HEIGHT,
            row_stride_bytes=_FRAME_ROW_STRIDE_BYTES,
            payload_bytes=_FRAME_PAYLOAD_BYTES,
        )
        payload = bytes([_FRAME_SOLID_BYTE_VALUE]) * _FRAME_PAYLOAD_BYTES

        validated_input = assemble_validated_helper_frame_input(request, header, payload)
        if validated_input is None:
            return None

        return convert_validated_helper_frame_input_to_rgb24(validated_input)
    except Exception:
        return None


def run_real_local_smoke(
    model_asset_path: str,
    *,
    module_importer: Callable[[str], object] = importlib.import_module,
) -> SmokeReport:
    """Runs the real opt-in smoke once and returns a sanitized report.

    Requires an already-validated absolute, existing `model_asset_path`.
    Imports `numpy` and `mediapipe` lazily through `module_importer`
    (only inside this call). A constructed runtime lifecycle is always
    closed exactly once, including on every post-startup failure.
    Ordinary runtime/environment exceptions are mapped to a bounded
    `unexpected_runtime_failure` reason; `KeyboardInterrupt` and
    `SystemExit` are not caught and remain visible.
    """
    lifecycle_holder: list = []
    try:
        return _run_real_local_smoke_inner(model_asset_path, module_importer, lifecycle_holder)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        return _failed_report("unexpected_runtime_failure")
    finally:
        if lifecycle_holder:
            lifecycle_holder[0].close()


def _run_real_local_smoke_inner(
    model_asset_path: str,
    module_importer: Callable[[str], object],
    lifecycle_holder: list,
) -> SmokeReport:
    python_version = _python_version_string()
    if python_version is None:
        return _failed_report("python_version_unavailable")

    rgb_frame = _prepare_synthetic_frame()
    if rgb_frame is None:
        return _failed_report("frame_preparation_failed", python_version=python_version)

    input_evidence = {
        "input_category": _INPUT_CATEGORY,
        "input_width": _FRAME_WIDTH,
        "input_height": _FRAME_HEIGHT,
    }

    try:
        numpy_module = module_importer("numpy")
    except Exception:
        return _failed_report(
            "numpy_import_failed", python_version=python_version, **input_evidence
        )

    try:
        mediapipe_module = module_importer("mediapipe")
    except Exception:
        return _failed_report(
            "mediapipe_import_failed", python_version=python_version, **input_evidence
        )

    mediapipe_version = _sanitize_version(getattr(mediapipe_module, "__version__", None))
    if mediapipe_version is None:
        return _failed_report(
            "mediapipe_version_unavailable", python_version=python_version, **input_evidence
        )

    lifecycle = create_face_landmarker_runtime(
        model_asset_path, module_importer=lambda name: mediapipe_module
    )
    lifecycle_holder.append(lifecycle)
    runtime_creation_status = lifecycle.creation_status.value

    if lifecycle.creation_status is not FaceLandmarkerRuntimeCreationStatus.SUCCESS:
        close_status = lifecycle.close().value
        return _failed_report(
            "runtime_creation_failed",
            python_version=python_version,
            mediapipe_version=mediapipe_version,
            runtime_creation_status=runtime_creation_status,
            close_status=close_status,
            **input_evidence,
        )

    try:
        inference_api = FaceLandmarkerInferenceApi(
            numpy_frombuffer=numpy_module.frombuffer,
            numpy_uint8=numpy_module.uint8,
            numpy_ascontiguousarray=numpy_module.ascontiguousarray,
            image_constructor=mediapipe_module.Image,
            srgb_image_format=mediapipe_module.ImageFormat.SRGB,
        )
    except Exception:
        close_status = lifecycle.close().value
        return _failed_report(
            "image_api_resolution_failed",
            python_version=python_version,
            mediapipe_version=mediapipe_version,
            runtime_creation_status=runtime_creation_status,
            close_status=close_status,
            **input_evidence,
        )

    outcome = run_face_landmarker_single_frame_inference(rgb_frame, lifecycle, inference_api)
    if outcome is None or outcome.status is not FaceLandmarkerInferenceStatus.SUCCESS:
        close_status = lifecycle.close().value
        return _failed_report(
            "inference_failed",
            python_version=python_version,
            mediapipe_version=mediapipe_version,
            runtime_creation_status=runtime_creation_status,
            inference_status=outcome.status.value if outcome is not None else None,
            close_status=close_status,
            **input_evidence,
        )

    composition = compose_face_landmarker_inference_outcome(outcome)
    payload_status = (
        _PAYLOAD_STATUS_TEXT.get(composition.payload.status)
        if composition is not None
        else None
    )
    if composition is None or payload_status is None:
        close_status = lifecycle.close().value
        return _failed_report(
            "composition_failed",
            python_version=python_version,
            mediapipe_version=mediapipe_version,
            runtime_creation_status=runtime_creation_status,
            inference_status=outcome.status.value,
            inference_ms=outcome.inference_ms,
            close_status=close_status,
            **input_evidence,
        )

    close_status = lifecycle.close().value
    if close_status != FaceLandmarkerRuntimeCloseStatus.CLOSED.value:
        return _failed_report(
            "close_failed",
            python_version=python_version,
            mediapipe_version=mediapipe_version,
            runtime_creation_status=runtime_creation_status,
            inference_status=outcome.status.value,
            inference_ms=outcome.inference_ms,
            payload_status=payload_status,
            close_status=close_status,
            **input_evidence,
        )

    return _passed_report(
        python_version=python_version,
        mediapipe_version=mediapipe_version,
        runtime_creation_status=runtime_creation_status,
        inference_status=outcome.status.value,
        inference_ms=outcome.inference_ms,
        payload_status=payload_status,
        close_status=close_status,
        **input_evidence,
    )


def main(argv: list[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    """CLI entry point. Never prints a path or environment contents."""
    if argv is None:
        argv = sys.argv[1:]
    if env is None:
        env = os.environ

    if _REAL_RUN_FLAG not in argv or not is_opted_in(env):
        report = build_skipped_report()
        sys.stdout.write(serialize_smoke_report(report))
        return 0

    model_asset_path, reason = _resolve_model_asset_path(env)
    if model_asset_path is None:
        report = _failed_report(reason)
        sys.stdout.write(serialize_smoke_report(report))
        return 1

    report = run_real_local_smoke(model_asset_path)
    sys.stdout.write(serialize_smoke_report(report))
    return 0 if report.status is SmokeStatus.PASSED else 1


if __name__ == "__main__":
    sys.exit(main())
