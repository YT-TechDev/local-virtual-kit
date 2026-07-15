"""Bounded child-side control/frame reader for the MediaPipe helper (#557).

Owns only the input I/O boundary: bounded accumulation of one binary control
line, strict UTF-8 decoding, lazy resolution of the inherited private frame
endpoint (POSIX fd 3, or the Windows handle in ``LVK_FRAME_PIPE_HANDLE``),
exact reading of one existing frame header and payload, and deterministic
endpoint cleanup. All semantic validation -- control JSON schema, frame
header bounds, and request/frame correlation/checksum -- is delegated to the
existing pure functions in ``helper_frame_input``; this module never
duplicates that logic.

Standard library only (plus a lazy, platform-gated ``msvcrt``/``ctypes`` use
on Windows). No MediaPipe, NumPy, camera, socket, file, or persistence use.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from enum import Enum

from helper_frame_input import (
    HelperFramePacketHeader,
    HelperFrameRequest,
    HelperStopRequest,
    ValidatedHelperFrameInput,
    assemble_validated_helper_frame_input,
    decode_helper_frame_packet_header,
    parse_helper_control_line,
)

# Mirrors kHelperMaxLineBytes in helper_message.h / helper_frame_input.py:
# the maximum content bytes of a single newline-delimited control line,
# before the newline delimiter.
_MAX_LINE_CONTENT_BYTES = 2048

# Mirrors the fixed 48-byte little-endian frame packet header in
# helper_frame_packet.h / helper_frame_input.py. The accepted payload length
# is never duplicated here: it is read only from the decoded header.
_FRAME_HEADER_BYTES = 48

# Fixed cap on consecutive EINTR retries within one _read_exact() operation.
# Bounds the child-side retry loop: repeated interruption fails the
# operation instead of retrying without limit.
_MAX_INTERRUPTED_READ_RETRIES = 8

# Fixed child fd for the private frame pipe (v0.13.0, #534), established via
# dup2 by Native Core before exec. See helper_process_session.cpp
# (kFrameTransportChildFd).
_POSIX_FRAME_FD = 3

# Name of the private per-launch child environment variable Native Core uses
# to hand off the inherited Windows frame-pipe read handle. See
# helper_process_session.cpp (buildChildEnvironmentWithFrameHandle).
_WINDOWS_FRAME_HANDLE_ENV_VAR = "LVK_FRAME_PIPE_HANDLE"

# Bounded textual length for the handle representation: a 64-bit signed
# decimal (with optional leading '-') never exceeds 20 characters
# ("-9223372036854775808").
_MAX_WINDOWS_HANDLE_TEXT_LENGTH = 20
_DECIMAL_DIGITS = frozenset("0123456789")
_INTPTR_MIN = -sys.maxsize - 1
_INTPTR_MAX = sys.maxsize

_WINDOWS_O_BINARY = getattr(os, "O_BINARY", 0)


class HelperFrameInputReadStatus(Enum):
    FRAME = "FRAME"
    STOP = "STOP"
    EOF = "EOF"
    CLOSED = "CLOSED"
    CONTROL_READ_FAILED = "CONTROL_READ_FAILED"
    CONTROL_LINE_INCOMPLETE = "CONTROL_LINE_INCOMPLETE"
    CONTROL_LINE_TOO_LONG = "CONTROL_LINE_TOO_LONG"
    CONTROL_DECODE_FAILED = "CONTROL_DECODE_FAILED"
    CONTROL_INVALID = "CONTROL_INVALID"
    FRAME_ENDPOINT_INVALID = "FRAME_ENDPOINT_INVALID"
    FRAME_HEADER_INCOMPLETE = "FRAME_HEADER_INCOMPLETE"
    FRAME_HEADER_READ_FAILED = "FRAME_HEADER_READ_FAILED"
    FRAME_HEADER_INVALID = "FRAME_HEADER_INVALID"
    FRAME_PAYLOAD_INCOMPLETE = "FRAME_PAYLOAD_INCOMPLETE"
    FRAME_PAYLOAD_READ_FAILED = "FRAME_PAYLOAD_READ_FAILED"
    FRAME_ASSEMBLY_FAILED = "FRAME_ASSEMBLY_FAILED"


@dataclass(frozen=True)
class HelperFrameInputReadOutcome:
    status: HelperFrameInputReadStatus
    frame_input: ValidatedHelperFrameInput | None = field(repr=False)


# --- Private platform seams ---------------------------------------------
#
# These exist only so tests can exercise both the POSIX and Windows endpoint
# paths deterministically, without a real fd 3, a real Windows HANDLE, or a
# real inherited environment.


def _detect_platform_kind() -> str:
    if sys.platform == "win32":
        return "windows"
    if os.name == "posix":
        return "posix"
    return "unsupported"


def _resolve_posix_frame_fd() -> int:
    return _POSIX_FRAME_FD


def _get_env_value(name: str) -> object:
    return os.environ.get(name)


def _adopt_windows_handle(handle_value: int) -> int:
    import msvcrt

    return msvcrt.open_osfhandle(handle_value, os.O_RDONLY | _WINDOWS_O_BINARY)


def _close_windows_handle(handle_value: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    if not kernel32.CloseHandle(wintypes.HANDLE(handle_value)):
        raise OSError("CloseHandle failed")


def _read_from_fd(fd: int, size: int) -> bytes:
    return os.read(fd, size)


def _close_fd(fd: int) -> None:
    os.close(fd)


def _parse_windows_handle_text(text: object) -> int | None:
    if type(text) is not str:
        return None
    if not (1 <= len(text) <= _MAX_WINDOWS_HANDLE_TEXT_LENGTH):
        return None
    if not text.isascii():
        return None

    negative = text[0] == "-"
    digits = text[1:] if negative else text
    if len(digits) == 0:
        return None
    if any(character not in _DECIMAL_DIGITS for character in digits):
        return None

    value = int(digits)
    if negative:
        value = -value

    if not (_INTPTR_MIN <= value <= _INTPTR_MAX):
        return None
    if value == 0:
        return None
    if value == -1:
        return None

    return value


def _attempt_raw_windows_handle_close(handle_value: int) -> None:
    try:
        _close_windows_handle(handle_value)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        pass


def _resolve_windows_frame_fd() -> int | None:
    handle_value = _parse_windows_handle_text(
        _get_env_value(_WINDOWS_FRAME_HANDLE_ENV_VAR)
    )
    if handle_value is None:
        return None

    try:
        fd = _adopt_windows_handle(handle_value)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        _attempt_raw_windows_handle_close(handle_value)
        return None

    if type(fd) is not int or fd < 0:
        _attempt_raw_windows_handle_close(handle_value)
        return None

    return fd


class HelperFrameInputReader:
    """Reads one bounded control line and, for a request, one bounded frame.

    Does not own or close `control_stream`. Lazily resolves and owns the
    private frame endpoint only after a valid request is parsed; the same
    endpoint is reused across sequential successful FRAME operations. Every
    terminal outcome other than FRAME closes the endpoint (if any) exactly
    once and makes the reader terminal: subsequent `read_next()` calls
    return CLOSED without reading anything.
    """

    def __init__(self, control_stream: object) -> None:
        self._control_stream = control_stream
        self._frame_fd: int | None = None
        self._closed = False
        self._close_result = True

    def read_next(self) -> HelperFrameInputReadOutcome:
        if self._closed:
            return HelperFrameInputReadOutcome(HelperFrameInputReadStatus.CLOSED, None)

        raw_line = self._read_raw_control_line()
        if type(raw_line) is HelperFrameInputReadStatus:
            return self._terminal(raw_line)

        try:
            line = raw_line.decode("utf-8")
        except UnicodeDecodeError:
            return self._terminal(HelperFrameInputReadStatus.CONTROL_DECODE_FAILED)

        parsed = parse_helper_control_line(line)

        if type(parsed) is HelperStopRequest:
            return self._terminal(HelperFrameInputReadStatus.STOP)

        if type(parsed) is not HelperFrameRequest:
            return self._terminal(HelperFrameInputReadStatus.CONTROL_INVALID)

        return self._read_frame(parsed)

    def close(self) -> bool:
        if self._closed:
            return self._close_result
        self._close_result = self._close_endpoint()
        self._closed = True
        return self._close_result

    # --- control-line framing -------------------------------------------

    def _read_raw_control_line(self) -> bytes | HelperFrameInputReadStatus:
        content = bytearray()
        while True:
            try:
                chunk = self._control_stream.read(1)
            except (KeyboardInterrupt, SystemExit):
                raise
            except Exception:
                return HelperFrameInputReadStatus.CONTROL_READ_FAILED

            if type(chunk) is not bytes:
                return HelperFrameInputReadStatus.CONTROL_READ_FAILED
            if len(chunk) > 1:
                return HelperFrameInputReadStatus.CONTROL_READ_FAILED

            if len(chunk) == 0:
                if len(content) == 0:
                    return HelperFrameInputReadStatus.EOF
                return HelperFrameInputReadStatus.CONTROL_LINE_INCOMPLETE

            if chunk == b"\n":
                return bytes(content)

            if len(content) >= _MAX_LINE_CONTENT_BYTES:
                return HelperFrameInputReadStatus.CONTROL_LINE_TOO_LONG

            content.extend(chunk)

    # --- frame reading ----------------------------------------------------

    def _read_frame(self, request: HelperFrameRequest) -> HelperFrameInputReadOutcome:
        if not self._resolve_endpoint():
            return self._terminal(HelperFrameInputReadStatus.FRAME_ENDPOINT_INVALID)

        kind, header_bytes = self._read_exact(_FRAME_HEADER_BYTES)
        if kind == "eof":
            return self._terminal(HelperFrameInputReadStatus.FRAME_HEADER_INCOMPLETE)
        if kind == "failed":
            return self._terminal(HelperFrameInputReadStatus.FRAME_HEADER_READ_FAILED)

        header = decode_helper_frame_packet_header(header_bytes)
        if type(header) is not HelperFramePacketHeader:
            return self._terminal(HelperFrameInputReadStatus.FRAME_HEADER_INVALID)

        kind, payload = self._read_exact(header.payload_bytes)
        if kind == "eof":
            return self._terminal(HelperFrameInputReadStatus.FRAME_PAYLOAD_INCOMPLETE)
        if kind == "failed":
            return self._terminal(HelperFrameInputReadStatus.FRAME_PAYLOAD_READ_FAILED)

        frame_input = assemble_validated_helper_frame_input(request, header, payload)
        if type(frame_input) is not ValidatedHelperFrameInput:
            return self._terminal(HelperFrameInputReadStatus.FRAME_ASSEMBLY_FAILED)

        return HelperFrameInputReadOutcome(HelperFrameInputReadStatus.FRAME, frame_input)

    def _resolve_endpoint(self) -> bool:
        if self._frame_fd is not None:
            return True

        kind = _detect_platform_kind()
        if kind == "posix":
            fd = _resolve_posix_frame_fd()
        elif kind == "windows":
            fd = _resolve_windows_frame_fd()
        else:
            fd = None

        if type(fd) is not int or fd < 0:
            return False

        self._frame_fd = fd
        return True

    def _read_exact(self, size: int) -> tuple[str, bytes | None]:
        fd = self._frame_fd
        chunks: list[bytes] = []
        remaining = size
        interrupted_count = 0
        while remaining > 0:
            try:
                chunk = _read_from_fd(fd, remaining)  # type: ignore[arg-type]
            except InterruptedError:
                interrupted_count += 1
                if interrupted_count > _MAX_INTERRUPTED_READ_RETRIES:
                    return ("failed", None)
                continue
            except (KeyboardInterrupt, SystemExit):
                raise
            except Exception:
                return ("failed", None)

            if type(chunk) is not bytes:
                return ("failed", None)
            if len(chunk) == 0:
                return ("eof", None)
            if len(chunk) > remaining:
                return ("failed", None)

            chunks.append(chunk)
            remaining -= len(chunk)

        return ("ok", b"".join(chunks))

    # --- cleanup ------------------------------------------------------------

    def _terminal(self, status: HelperFrameInputReadStatus) -> HelperFrameInputReadOutcome:
        self.close()
        return HelperFrameInputReadOutcome(status, None)

    def _close_endpoint(self) -> bool:
        fd = self._frame_fd
        self._frame_fd = None
        if fd is None:
            return True
        try:
            _close_fd(fd)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception:
            return False
        return True
