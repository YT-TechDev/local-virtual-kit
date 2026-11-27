"""Explicit ctypes loader for the Native Core ``lvk-fnv1a32`` shared library.

P2-B foundation. This module is NOT used by the helper runtime yet: it does
not replace either existing pure-Python checksum (``helper_frame_input`` /
``helper_frame_rgb``), and nothing imports it outside its own tests. Runtime
integration and trusted library path derivation belong to a later, separately
approved slice (P2-C).

Contract (see native/tracker-core/src/fnv1a32_abi.h for the C ABI):

* ``load_native_fnv1a32(library_path)`` is the only entry point. It accepts
  exactly one caller-supplied, absolute library path and loads exactly that
  file. Nothing is searched: no PATH, no current directory, no environment
  variable, no alternative filename, no fallback implementation.
* The path is a TRUSTED input. The ABI version, maximum-length, and
  known-answer self-test checks performed at load time establish ABI
  compatibility only; they do not authenticate the binary.
* Windows dependencies of the library are resolved from System32 only
  (``LOAD_LIBRARY_SEARCH_SYSTEM32``); the library is target-locally linked
  against the static CRT and imports only KERNEL32. Linux loads use
  ``RTLD_NOW | RTLD_LOCAL``. Any other platform is rejected.
* A ``NativeFnv1a32`` object is returned only after every check succeeds. It
  keeps the ctypes library handle alive for its own lifetime; ctypes never
  unloads a library, and this module never does either.
* Calling the object accepts only exact built-in ``bytes`` of at most 32 MiB.
  The native length is ``len(data)``; the bytes object's own buffer is passed
  without a copy and stays referenced for the whole call; the output is a
  freshly allocated, independently owned ``ctypes.c_uint32``, so input and
  output memory never overlap. Any nonzero ABI status raises.

Standard library only. Importing this module performs no filesystem access,
no library loading, and creates no mutable module state.
"""

from __future__ import annotations

import ctypes
import os
import re
import sys

ABI_VERSION = 1
MAX_INPUT_BYTES = 32 * 1024 * 1024

_STATUS_OK = 0

# LoadLibraryExW flag: resolve the library's own dependencies from System32
# only. The library itself is loaded from the fully qualified path given.
_LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800

_SYMBOL_ABI_VERSION = "lvk_fnv1a32_abi_version"
_SYMBOL_MAX_LEN = "lvk_fnv1a32_max_len"
_SYMBOL_CHECKSUM_V1 = "lvk_fnv1a32_v1"

# Exact C signatures from fnv1a32_abi.h. `const uint8_t*` is bound as
# c_char_p: identical C ABI, and it lets an exact `bytes` object be passed by
# pointer to its own immutable buffer without a copy.
_ARGTYPES_ABI_VERSION: tuple = ()
_RESTYPE_ABI_VERSION = ctypes.c_uint32
_ARGTYPES_MAX_LEN: tuple = ()
_RESTYPE_MAX_LEN = ctypes.c_size_t
_ARGTYPES_CHECKSUM_V1 = (
    ctypes.c_char_p,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_uint32),
)
_RESTYPE_CHECKSUM_V1 = ctypes.c_int

# Startup known-answer vectors (FNV-1a 32-bit, offset basis 0x811C9DC5,
# prime 0x01000193). Includes empty input and embedded-NUL vectors.
_SELF_TEST_VECTORS = (
    (b"", 0x811C9DC5),
    (b"a", 0xE40C292C),
    (b"foobar", 0xBF9CF968),
    (b"\x00", 0x050C5D1F),
    (b"foo\x00bar", 0xC5ED6ECA),
    (bytes(range(256)), 0x90A458C5),
)

_WINDOWS_ABSOLUTE_PATH = re.compile(r"[A-Za-z]:\\[^/]*")

# Private construction guard: only load_native_fnv1a32() may create a
# NativeFnv1a32. An immutable sentinel, not mutable state.
_CONSTRUCTION_TOKEN = object()


class NativeFnv1a32LoadError(RuntimeError):
    """The native library could not be loaded or failed a compatibility check."""


class NativeFnv1a32CallError(RuntimeError):
    """The native checksum function returned a nonzero ABI status."""


def _validate_library_path(library_path: object, platform: str) -> str:
    if type(library_path) is not str:
        raise TypeError("native FNV library path must be an exact str")
    if library_path == "":
        raise NativeFnv1a32LoadError("native FNV library path is empty")
    if "\x00" in library_path:
        raise NativeFnv1a32LoadError("native FNV library path contains NUL")
    if platform == "win32":
        # Drive-qualified, backslash-only path. Rejects relative, drive-
        # relative ("C:x", "\\x"), UNC/device ("\\\\server", "\\\\?\\"), and
        # forward-slash forms. The ".dll" suffix is required because
        # LoadLibraryExW would otherwise append ".dll" and load a different
        # file than the one named.
        if _WINDOWS_ABSOLUTE_PATH.fullmatch(library_path) is None:
            raise NativeFnv1a32LoadError(
                "native FNV library path must be an absolute drive path"
            )
        if not library_path.lower().endswith(".dll"):
            raise NativeFnv1a32LoadError(
                "native FNV library path must name a .dll file"
            )
    elif platform.startswith("linux"):
        if not library_path.startswith("/"):
            raise NativeFnv1a32LoadError(
                "native FNV library path must be absolute"
            )
        if not library_path.endswith(".so"):
            raise NativeFnv1a32LoadError(
                "native FNV library path must name a .so file"
            )
    else:
        raise NativeFnv1a32LoadError(
            f"native FNV library is unsupported on platform {platform!r}"
        )
    if not os.path.isfile(library_path):
        raise NativeFnv1a32LoadError(
            "native FNV library path does not name an existing regular file"
        )
    return library_path


def _open_library(library_path: str, platform: str) -> ctypes.CDLL:
    # CDLL uses the platform C calling convention (cdecl on Windows).
    try:
        if platform == "win32":
            return ctypes.CDLL(library_path, winmode=_LOAD_LIBRARY_SEARCH_SYSTEM32)
        return ctypes.CDLL(library_path, mode=os.RTLD_NOW | os.RTLD_LOCAL)
    except OSError as exc:
        raise NativeFnv1a32LoadError(
            "native FNV library could not be loaded"
        ) from exc


def _bind_symbols(library):
    """Return freshly bound (abi_version, max_len, checksum_v1) functions."""
    bound = []
    for name, argtypes, restype in (
        (_SYMBOL_ABI_VERSION, _ARGTYPES_ABI_VERSION, _RESTYPE_ABI_VERSION),
        (_SYMBOL_MAX_LEN, _ARGTYPES_MAX_LEN, _RESTYPE_MAX_LEN),
        (_SYMBOL_CHECKSUM_V1, _ARGTYPES_CHECKSUM_V1, _RESTYPE_CHECKSUM_V1),
    ):
        try:
            # Item access returns a new function object each time, so these
            # bindings are private to this loader and never shared with any
            # attribute cache on the library object.
            function = library[name]
        except AttributeError as exc:
            raise NativeFnv1a32LoadError(
                f"native FNV library is missing symbol {name}"
            ) from exc
        function.argtypes = argtypes
        function.restype = restype
        bound.append(function)
    return tuple(bound)


def _invoke_checksum(checksum_v1, data: bytes) -> int:
    length = len(data)
    # Independent, ctypes-aligned output storage, allocated per call: it can
    # never overlap the input buffer and is never shared between calls.
    output = ctypes.c_uint32(0)
    # `data` stays referenced by this frame for the entire foreign call.
    status = checksum_v1(data, length, ctypes.byref(output))
    if status != _STATUS_OK:
        raise NativeFnv1a32CallError(
            f"native FNV checksum failed with ABI status {status}"
        )
    return output.value


class NativeFnv1a32:
    """A verified, callable native FNV-1a32 checksum. Create via the loader."""

    __slots__ = ("_library", "_checksum_v1", "_library_path")

    def __init__(self, token, library, checksum_v1, library_path):
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("use load_native_fnv1a32() to create NativeFnv1a32")
        object.__setattr__(self, "_library", library)
        object.__setattr__(self, "_checksum_v1", checksum_v1)
        object.__setattr__(self, "_library_path", library_path)

    def __setattr__(self, name, value):
        raise AttributeError("NativeFnv1a32 is immutable")

    def __delattr__(self, name):
        raise AttributeError("NativeFnv1a32 is immutable")

    def __reduce__(self):
        raise TypeError("NativeFnv1a32 cannot be pickled")

    @property
    def library_path(self) -> str:
        return self._library_path

    def __call__(self, data: bytes) -> int:
        if type(data) is not bytes:
            raise TypeError("native FNV checksum input must be exact bytes")
        if len(data) > MAX_INPUT_BYTES:
            raise ValueError(
                f"native FNV checksum input exceeds {MAX_INPUT_BYTES} bytes"
            )
        return _invoke_checksum(self._checksum_v1, data)


def load_native_fnv1a32(library_path: str) -> NativeFnv1a32:
    """Load, verify, and return the native FNV-1a32 checksum at an exact path.

    Raises TypeError for a non-str path and NativeFnv1a32LoadError for every
    other failure. Never falls back to another implementation or location.
    """
    platform = sys.platform
    path = _validate_library_path(library_path, platform)
    library = _open_library(path, platform)
    abi_version, max_len, checksum_v1 = _bind_symbols(library)

    reported_version = abi_version()
    if reported_version != ABI_VERSION:
        raise NativeFnv1a32LoadError(
            f"native FNV ABI version {reported_version} != {ABI_VERSION}"
        )
    reported_max_len = max_len()
    if reported_max_len != MAX_INPUT_BYTES:
        raise NativeFnv1a32LoadError(
            f"native FNV max length {reported_max_len} != {MAX_INPUT_BYTES}"
        )
    for vector, expected in _SELF_TEST_VECTORS:
        try:
            actual = _invoke_checksum(checksum_v1, vector)
        except NativeFnv1a32CallError as exc:
            raise NativeFnv1a32LoadError(
                "native FNV startup self-test returned a failure status"
            ) from exc
        if actual != expected:
            raise NativeFnv1a32LoadError(
                "native FNV startup self-test produced a wrong checksum"
            )

    return NativeFnv1a32(_CONSTRUCTION_TOKEN, library, checksum_v1, path)
