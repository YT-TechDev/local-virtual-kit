"""Standard-library tests for helper_native_fnv.py (P2-B).

The compiled lvk-fnv1a32 shared library is REQUIRED; its absolute path must
be supplied explicitly. There is no default location, no search, and no skip:
a missing or unloadable artifact fails the run.

Run directly:
  python -B test_helper_native_fnv.py --native-library <absolute path>

Bounded synthetic benchmark (no camera, no MediaPipe):
  python -B test_helper_native_fnv.py --native-library <absolute path> \
      --benchmark [--samples N] [--warmup N] [--enforce-acceptance]
"""

from __future__ import annotations

import ast
import contextlib
import ctypes
import gc
import hashlib
import json
import math
import os
import pathlib
import platform
import subprocess
import sys
import tempfile
import time
import tracemalloc
import unittest
import weakref
from unittest import mock

import helper_frame_input
import helper_frame_rgb
import helper_native_fnv
from helper_native_fnv import (
    MAX_INPUT_BYTES,
    NativeFnv1a32,
    NativeFnv1a32CallError,
    NativeFnv1a32LoadError,
    load_native_fnv1a32,
)

_MODULE_PATH = pathlib.Path(helper_native_fnv.__file__).resolve()
_HELPER_DIR = _MODULE_PATH.parent

# Set by main() from --native-library. Never derived or searched for.
_NATIVE_LIBRARY_PATH: str | None = None

_MAX = 32 * 1024 * 1024
_OFFSET_BASIS = 0x811C9DC5
_SELF_TEST_CALLS = len(helper_native_fnv._SELF_TEST_VECTORS)
_BYTES_DATA_OFFSET = bytes.__basicsize__ - 1  # CPython PyBytesObject.ob_sval


def _reference_fnv1a32(data: bytes) -> int:
    """Test-only pure-Python reference. Never used by the loader."""
    hash_value = _OFFSET_BASIS
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * 0x01000193) & 0xFFFFFFFF
    return hash_value


def _required_native_library_path() -> str:
    if _NATIVE_LIBRARY_PATH is None:
        raise RuntimeError(
            "--native-library <absolute path> is required; native integration "
            "tests are never skipped"
        )
    return _NATIVE_LIBRARY_PATH


def _current_platform_suffix() -> str:
    return ".dll" if sys.platform == "win32" else ".so"


# --- Deterministic payload construction -------------------------------------


def _pseudo_random_block(seed: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(seed + counter.to_bytes(8, "little")).digest()
        counter += 1
    return bytes(out[:length])


def _tiled(block: bytes, length: int) -> bytes:
    return (block * (length // len(block) + 1))[:length]


def _bgr24_frame(width: int, height: int, seed: bytes) -> bytes:
    # 4093-byte (prime) pseudo-random block tiled across the frame, so rows
    # and channels do not repeat at frame-aligned offsets.
    return _tiled(_pseudo_random_block(seed, 4093), width * height * 3)


def _parity_vectors():
    """Yield the 314 P1 parity vectors, reconstructed deterministically.

    Composition (P1 methodology: empty / NUL / all byte values / prefix
    sweep / camera frame sizes / maximum frame / raw maximum):
      5   edge vectors: empty, single NUL, embedded NUL, all 256 byte values
          ascending, all 256 byte values descending
      301 prefix sweep: lengths 0..300 of one pseudo-random stream
      3   BGR24 frames: 320x240, 640x480, 1280x720
      2   640x480 uniform frames: all 0x00, all 0xFF
      3   maximum vectors: 7680x1456 BGR24 frame, raw exactly 32 MiB
          pseudo-random, raw exactly 32 MiB all 0x00
    Generated lazily so at most one large vector is alive at a time.
    """
    yield "empty", b""
    yield "nul", b"\x00"
    yield "embedded-nul", b"foo\x00bar\x00\x00baz"
    yield "all-bytes-ascending", bytes(range(256))
    yield "all-bytes-descending", bytes(range(255, -1, -1))
    stream = _pseudo_random_block(b"lvk-p2b-prefix", 300)
    for length in range(301):
        yield f"prefix-{length}", stream[:length]
    yield "bgr24-320x240", _bgr24_frame(320, 240, b"320x240")
    yield "bgr24-640x480", _bgr24_frame(640, 480, b"640x480")
    yield "bgr24-1280x720", _bgr24_frame(1280, 720, b"1280x720")
    yield "uniform-640x480-00", bytes(640 * 480 * 3)
    yield "uniform-640x480-ff", b"\xff" * (640 * 480 * 3)
    yield "bgr24-7680x1456", _bgr24_frame(7680, 1456, b"7680x1456")
    yield "raw-32mib-random", _tiled(_pseudo_random_block(b"raw", 65521), _MAX)
    yield "raw-32mib-zero", bytes(_MAX)


# --- Fake library for deterministic failure paths ---------------------------

_PROTO_U32 = ctypes.CFUNCTYPE(ctypes.c_uint32)
_PROTO_SIZE = ctypes.CFUNCTYPE(ctypes.c_size_t)
# Raw-address callback prototype: C-ABI-compatible with the real signature,
# but receives the pointers as integers so tests can inspect them.
_PROTO_V1 = ctypes.CFUNCTYPE(
    ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p
)


class _FakeLibrary:
    """CDLL-like object backed by in-process C callbacks.

    `checksum` computes the value written to *output; `status_for(index)`
    returns the ABI status for the index-th checksum call (0-based).
    """

    def __init__(
        self,
        *,
        abi_version=1,
        max_len=_MAX,
        checksum=_reference_fnv1a32,
        status_for=lambda index: 0,
        missing=(),
    ):
        self.calls = []
        self._missing = frozenset(missing)

        def v1(data_address, length, output_address):
            index = len(self.calls)
            data = ctypes.string_at(data_address, length) if length else b""
            self.calls.append(
                {
                    "data_address": data_address,
                    "length": length,
                    "output_address": output_address,
                    "data": data,
                }
            )
            status = status_for(index)
            if status == 0:
                ctypes.c_uint32.from_address(output_address).value = checksum(data)
            return status

        self._functions = {
            "lvk_fnv1a32_abi_version": _PROTO_U32(lambda: abi_version),
            "lvk_fnv1a32_max_len": _PROTO_SIZE(lambda: max_len),
            "lvk_fnv1a32_v1": _PROTO_V1(v1),
        }

    def __getitem__(self, name):
        if name in self._missing or name not in self._functions:
            raise AttributeError(name)
        return self._functions[name]


@contextlib.contextmanager
def _fake_library_loaded(fake):
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "lvk-fnv1a32" + _current_platform_suffix())
        with open(path, "wb") as handle:
            handle.write(b"placeholder")
        with mock.patch.object(
            helper_native_fnv, "_open_library", return_value=fake
        ) as opener:
            yield path, opener


def _load_with_fake(fake):
    with _fake_library_loaded(fake) as (path, _):
        return load_native_fnv1a32(path)


# --- Path validation ---------------------------------------------------------


class PathValidationTests(unittest.TestCase):
    def test_accepts_existing_absolute_path_for_current_platform(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "lib" + _current_platform_suffix())
            pathlib.Path(path).write_bytes(b"x")
            self.assertIs(
                helper_native_fnv._validate_library_path(path, sys.platform), path
            )

    def test_rejects_non_str_types(self):
        class _StrSubclass(str):
            pass

        absolute = os.path.join(tempfile.gettempdir(), "x" + _current_platform_suffix())
        for value in (
            None,
            1,
            absolute.encode(),
            bytearray(absolute.encode()),
            pathlib.Path(absolute),
            _StrSubclass(absolute),
        ):
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(TypeError):
                    helper_native_fnv._validate_library_path(value, sys.platform)
                with self.assertRaises(TypeError):
                    load_native_fnv1a32(value)

    def test_rejects_empty_and_nul(self):
        for platform_name in ("win32", "linux"):
            for value in ("", "C:\\x\\lvk\x00.dll", "/x/lvk\x00.so"):
                with self.subTest(platform=platform_name, value=value):
                    with self.assertRaises(NativeFnv1a32LoadError):
                        helper_native_fnv._validate_library_path(value, platform_name)

    def test_rejects_invalid_windows_paths(self):
        for value in (
            "lvk-fnv1a32.dll",
            ".\\lvk-fnv1a32.dll",
            "..\\lvk-fnv1a32.dll",
            "C:lvk-fnv1a32.dll",
            "\\lvk-fnv1a32.dll",
            "\\\\server\\share\\lvk-fnv1a32.dll",
            "\\\\?\\C:\\x\\lvk-fnv1a32.dll",
            "\\\\.\\C:\\x\\lvk-fnv1a32.dll",
            "C:/x/lvk-fnv1a32.dll",
            "C:\\x/lvk-fnv1a32.dll",
            "/x/lvk-fnv1a32.dll",
            "C:\\x\\lvk-fnv1a32",
            "C:\\x\\lvk-fnv1a32.dll.",
            "C:\\x\\lvk-fnv1a32.so",
        ):
            with self.subTest(value=value):
                with self.assertRaises(NativeFnv1a32LoadError):
                    helper_native_fnv._validate_library_path(value, "win32")

    def test_rejects_invalid_linux_paths(self):
        for value in (
            "liblvk-fnv1a32.so",
            "./liblvk-fnv1a32.so",
            "../liblvk-fnv1a32.so",
            "~/liblvk-fnv1a32.so",
            "/x/liblvk-fnv1a32",
            "/x/liblvk-fnv1a32.so.1",
            "/x/lvk-fnv1a32.dll",
            "C:\\x\\liblvk-fnv1a32.so",
        ):
            with self.subTest(value=value):
                with self.assertRaises(NativeFnv1a32LoadError):
                    helper_native_fnv._validate_library_path(value, "linux")

    def test_rejects_unsupported_platforms(self):
        for platform_name in ("darwin", "cygwin", "freebsd14", "emscripten", ""):
            with self.subTest(platform=platform_name):
                with self.assertRaises(NativeFnv1a32LoadError):
                    helper_native_fnv._validate_library_path(
                        "/x/liblvk-fnv1a32.so", platform_name
                    )

    def test_rejects_missing_file_and_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = os.path.join(directory, "missing" + _current_platform_suffix())
            directory_named_like_library = os.path.join(
                directory, "dir" + _current_platform_suffix()
            )
            os.mkdir(directory_named_like_library)
            for value in (missing, directory_named_like_library):
                with self.subTest(value=os.path.basename(value)):
                    with self.assertRaises(NativeFnv1a32LoadError):
                        load_native_fnv1a32(value)

    def test_invalid_path_never_reaches_library_loading(self):
        with mock.patch.object(helper_native_fnv.ctypes, "CDLL") as cdll:
            for value in ("", "relative" + _current_platform_suffix()):
                with self.assertRaises(NativeFnv1a32LoadError):
                    load_native_fnv1a32(value)
            cdll.assert_not_called()

    def test_no_environment_or_search_based_resolution(self):
        source = _MODULE_PATH.read_text(encoding="utf-8")
        for forbidden in (
            "os.environ",
            "getenv",
            "find_library",
            "ctypes.util",
            "LoadLibrary(",
            "cdll.",
            "windll",
            "os.getcwd",
            "abspath",
            "realpath",
            "os.pathsep",
            "sys.path",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)


# --- Library opening flags ---------------------------------------------------


class OpenLibraryTests(unittest.TestCase):
    def test_windows_uses_system32_only_dependency_search(self):
        sentinel = object()
        with mock.patch.object(
            helper_native_fnv.ctypes, "CDLL", return_value=sentinel
        ) as cdll:
            result = helper_native_fnv._open_library("C:\\x\\lvk-fnv1a32.dll", "win32")
        self.assertIs(result, sentinel)
        cdll.assert_called_once_with("C:\\x\\lvk-fnv1a32.dll", winmode=0x00000800)

    def test_linux_uses_rtld_now_local(self):
        sentinel = object()
        with contextlib.ExitStack() as stack:
            # os.RTLD_* exist only on POSIX; give them their Linux values when
            # this branch is exercised on Windows.
            if not hasattr(os, "RTLD_NOW"):
                stack.enter_context(
                    mock.patch.object(helper_native_fnv.os, "RTLD_NOW", 2, create=True)
                )
                stack.enter_context(
                    mock.patch.object(helper_native_fnv.os, "RTLD_LOCAL", 0, create=True)
                )
            cdll = stack.enter_context(
                mock.patch.object(helper_native_fnv.ctypes, "CDLL", return_value=sentinel)
            )
            result = helper_native_fnv._open_library("/x/liblvk-fnv1a32.so", "linux")
            expected_mode = os.RTLD_NOW | os.RTLD_LOCAL
        self.assertIs(result, sentinel)
        cdll.assert_called_once_with("/x/liblvk-fnv1a32.so", mode=expected_mode)

    def test_real_load_passes_platform_flags(self):
        path = _required_native_library_path()
        with mock.patch.object(
            helper_native_fnv.ctypes, "CDLL", wraps=ctypes.CDLL
        ) as cdll:
            checksum = load_native_fnv1a32(path)
        self.assertIsInstance(checksum, NativeFnv1a32)
        if sys.platform == "win32":
            cdll.assert_called_once_with(path, winmode=0x00000800)
        else:
            cdll.assert_called_once_with(path, mode=os.RTLD_NOW | os.RTLD_LOCAL)

    def test_os_error_becomes_load_error_with_cause(self):
        error = OSError("boom")
        with mock.patch.object(helper_native_fnv.ctypes, "CDLL", side_effect=error):
            with self.assertRaises(NativeFnv1a32LoadError) as context:
                helper_native_fnv._open_library("/x/liblvk-fnv1a32.so", sys.platform)
        self.assertIs(context.exception.__cause__, error)

    def test_unexpected_exceptions_propagate_unchanged(self):
        for error_type in (ValueError, RuntimeError, MemoryError, KeyboardInterrupt):
            with self.subTest(error=error_type.__name__):
                with mock.patch.object(
                    helper_native_fnv.ctypes, "CDLL", side_effect=error_type("x")
                ):
                    with self.assertRaises(error_type):
                        helper_native_fnv._open_library(
                            "C:\\x\\lvk-fnv1a32.dll", "win32"
                        )

    def test_invalid_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "bogus" + _current_platform_suffix())
            pathlib.Path(path).write_bytes(b"MZ not a real library \x00" * 64)
            with self.assertRaises(NativeFnv1a32LoadError) as context:
                load_native_fnv1a32(path)
            self.assertIsInstance(context.exception.__cause__, OSError)


# --- Initialization checks (mocked) ------------------------------------------


class InitializationTests(unittest.TestCase):
    def test_fake_library_with_correct_behavior_loads(self):
        fake = _FakeLibrary()
        checksum = _load_with_fake(fake)
        self.assertIsInstance(checksum, NativeFnv1a32)
        self.assertEqual(len(fake.calls), _SELF_TEST_CALLS)
        self.assertEqual(checksum(b"abc"), _reference_fnv1a32(b"abc"))

    def test_missing_each_symbol_is_rejected(self):
        for name in (
            "lvk_fnv1a32_abi_version",
            "lvk_fnv1a32_max_len",
            "lvk_fnv1a32_v1",
        ):
            with self.subTest(symbol=name):
                with self.assertRaises(NativeFnv1a32LoadError) as context:
                    _load_with_fake(_FakeLibrary(missing=(name,)))
                self.assertIn(name, str(context.exception))
                self.assertIsInstance(context.exception.__cause__, AttributeError)

    def test_abi_version_mismatch_is_rejected_before_any_checksum(self):
        for version in (0, 2, 0xFFFFFFFF):
            with self.subTest(version=version):
                fake = _FakeLibrary(abi_version=version)
                with self.assertRaises(NativeFnv1a32LoadError):
                    _load_with_fake(fake)
                self.assertEqual(fake.calls, [])

    def test_max_length_mismatch_is_rejected_before_any_checksum(self):
        for max_len in (0, _MAX - 1, _MAX + 1, 2 * _MAX, (1 << 32) - 1):
            with self.subTest(max_len=max_len):
                fake = _FakeLibrary(max_len=max_len)
                with self.assertRaises(NativeFnv1a32LoadError):
                    _load_with_fake(fake)
                self.assertEqual(fake.calls, [])

    def test_wrong_known_answer_is_rejected(self):
        cases = {
            "all-wrong": lambda data: _reference_fnv1a32(data) ^ 1,
            "empty-wrong": lambda data: 0 if data == b"" else _reference_fnv1a32(data),
            # A NUL-terminated (strlen-style) implementation must be caught by
            # the embedded-NUL self-test vectors.
            "truncates-at-nul": lambda data: _reference_fnv1a32(data.split(b"\x00")[0]),
            "all-bytes-wrong": lambda data: (
                0 if len(data) == 256 else _reference_fnv1a32(data)
            ),
        }
        for label, checksum in cases.items():
            with self.subTest(case=label):
                with self.assertRaises(NativeFnv1a32LoadError):
                    _load_with_fake(_FakeLibrary(checksum=checksum))

    def test_self_test_nonzero_status_is_rejected(self):
        for failing_index in range(_SELF_TEST_CALLS):
            with self.subTest(index=failing_index):
                fake = _FakeLibrary(
                    status_for=lambda index, f=failing_index: 3 if index == f else 0
                )
                with self.assertRaises(NativeFnv1a32LoadError) as context:
                    _load_with_fake(fake)
                self.assertIsInstance(
                    context.exception.__cause__, NativeFnv1a32CallError
                )

    def test_self_test_covers_empty_and_embedded_nul(self):
        vectors = [vector for vector, _ in helper_native_fnv._SELF_TEST_VECTORS]
        self.assertIn(b"", vectors)
        self.assertTrue(any(b"\x00" in v and len(v) > 1 for v in vectors))
        for vector, expected in helper_native_fnv._SELF_TEST_VECTORS:
            self.assertEqual(_reference_fnv1a32(vector), expected)

    def test_direct_construction_is_refused(self):
        with self.assertRaises(TypeError):
            NativeFnv1a32(object(), None, None, "/x")
        with self.assertRaises(TypeError):
            NativeFnv1a32()  # type: ignore[call-arg]

    def test_unexpected_symbol_lookup_exception_propagates(self):
        class _Exploding(_FakeLibrary):
            def __getitem__(self, name):
                raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            _load_with_fake(_Exploding())


# --- Invocation contract (mocked) ---------------------------------------------


class InvocationContractTests(unittest.TestCase):
    def setUp(self):
        self.fake = _FakeLibrary()
        self.checksum = _load_with_fake(self.fake)
        del self.fake.calls[:]

    def test_rejects_non_bytes_inputs_without_native_call(self):
        class _BytesSubclass(bytes):
            pass

        import array

        rejected = (
            None,
            0,
            123,
            "abc",
            bytearray(b"abc"),
            memoryview(b"abc"),
            _BytesSubclass(b"abc"),
            array.array("B", b"abc"),
            ctypes.create_string_buffer(b"abc"),
            ctypes.c_char_p(b"abc"),
            ctypes.c_void_p(1),
            [97, 98, 99],
        )
        for value in rejected:
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(TypeError):
                    self.checksum(value)
        self.assertEqual(self.fake.calls, [])

    def test_oversized_rejected_before_native_call(self):
        oversized = bytes(_MAX + 1)
        with self.assertRaises(ValueError):
            self.checksum(oversized)
        self.assertEqual(self.fake.calls, [])

    def test_length_derived_from_len_and_buffer_passed_without_copy(self):
        for data in (b"", b"\x00", b"foo\x00bar", bytes(range(256)) * 37):
            with self.subTest(length=len(data)):
                del self.fake.calls[:]
                self.assertEqual(self.checksum(data), _reference_fnv1a32(data))
                (call,) = self.fake.calls
                self.assertEqual(call["length"], len(data))
                self.assertEqual(call["data"], data)
                # The native side receives the bytes object's own buffer.
                self.assertEqual(
                    call["data_address"], id(data) + _BYTES_DATA_OFFSET
                )

    def test_output_is_independent_and_aligned(self):
        data = bytes(range(256)) * 16
        self.checksum(data)
        (call,) = self.fake.calls
        data_start = call["data_address"]
        data_end = data_start + len(data)
        output = call["output_address"]
        output_end = output + ctypes.sizeof(ctypes.c_uint32)
        self.assertTrue(output_end <= data_start or output >= data_end)
        self.assertEqual(output % ctypes.alignment(ctypes.c_uint32), 0)

    def test_every_nonzero_status_raises(self):
        for status in (1, 2, 3, 4, 127, -1, -(1 << 31), (1 << 31) - 1):
            with self.subTest(status=status):
                fake = _FakeLibrary(
                    status_for=lambda index, s=status: s if index >= _SELF_TEST_CALLS else 0
                )
                checksum = _load_with_fake(fake)
                with self.assertRaises(NativeFnv1a32CallError) as context:
                    checksum(b"abc")
                self.assertIn(str(status), str(context.exception))

    def test_unexpected_exception_from_native_binding_propagates(self):
        for error_type in (MemoryError, KeyboardInterrupt, SystemExit):
            with self.subTest(error=error_type.__name__):

                def exploding(*args):
                    raise error_type

                with self.assertRaises(error_type):
                    helper_native_fnv._invoke_checksum(exploding, b"abc")

    def test_object_is_immutable_and_not_picklable(self):
        import pickle

        with self.assertRaises(AttributeError):
            self.checksum._checksum_v1 = None
        with self.assertRaises(AttributeError):
            self.checksum.extra = 1
        with self.assertRaises(AttributeError):
            del self.checksum._library
        with self.assertRaises(TypeError):
            pickle.dumps(self.checksum)


# --- Real compiled library ---------------------------------------------------


class NativeLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = _required_native_library_path()
        cls.checksum = load_native_fnv1a32(cls.path)

    def test_library_path_is_exactly_the_supplied_path(self):
        self.assertIs(self.checksum.library_path, self.path)
        self.assertIsInstance(self.checksum._library, ctypes.CDLL)

    def test_all_three_signatures_bound_exactly(self):
        abi_version, max_len, checksum_v1 = helper_native_fnv._bind_symbols(
            self.checksum._library
        )
        expected = (
            (abi_version, (), ctypes.c_uint32),
            (max_len, (), ctypes.c_size_t),
            (
                checksum_v1,
                (ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_uint32)),
                ctypes.c_int,
            ),
            (
                self.checksum._checksum_v1,
                (ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_uint32)),
                ctypes.c_int,
            ),
        )
        for function, argtypes, restype in expected:
            with self.subTest(function=function.__name__):
                self.assertEqual(tuple(function.argtypes), argtypes)
                self.assertIs(function.restype, restype)
                # C calling convention, not stdcall, and the GIL is released.
                self.assertTrue(function._flags_ & ctypes._FUNCFLAG_CDECL)
                self.assertFalse(function._flags_ & ctypes._FUNCFLAG_PYTHONAPI)
        self.assertEqual(abi_version(), 1)
        self.assertEqual(max_len(), _MAX)
        self.assertEqual(MAX_INPUT_BYTES, _MAX)

    def test_native_status_semantics_through_raw_binding(self):
        _, _, checksum_v1 = helper_native_fnv._bind_symbols(self.checksum._library)
        output = ctypes.c_uint32(0xDEADBEEF)
        self.assertEqual(checksum_v1(b"abc", 3, None), 1)
        self.assertEqual(checksum_v1(None, 1, ctypes.byref(output)), 2)
        self.assertEqual(checksum_v1(None, _MAX + 1, ctypes.byref(output)), 3)
        self.assertEqual(output.value, 0xDEADBEEF)  # never written on failure
        self.assertEqual(checksum_v1(None, 0, ctypes.byref(output)), 0)
        self.assertEqual(output.value, _OFFSET_BASIS)

    def test_empty_embedded_nul_and_all_byte_values(self):
        for data in (
            b"",
            b"\x00",
            b"\x00" * 17,
            b"foo\x00bar",
            b"\x00foo",
            bytes(range(256)),
        ):
            with self.subTest(data=data[:16]):
                self.assertEqual(self.checksum(data), _reference_fnv1a32(data))
        for value in range(256):
            with self.subTest(byte=value):
                single = bytes((value,))
                self.assertEqual(self.checksum(single), _reference_fnv1a32(single))
        self.assertNotEqual(self.checksum(b"foo\x00bar"), self.checksum(b"foo"))

    def test_314_parity_vectors(self):
        count = 0
        for label, data in _parity_vectors():
            count += 1
            with self.subTest(vector=label):
                expected = _reference_fnv1a32(data)
                self.assertEqual(self.checksum(data), expected)
                # Three-way parity with the unchanged production Python
                # implementations, on vectors where their cost is bounded.
                if len(data) <= 640 * 480 * 3:
                    self.assertEqual(helper_frame_input._fnv1a32(data), expected)
                    self.assertEqual(helper_frame_rgb._fnv1a32(data), expected)
            del data
        self.assertEqual(count, 314)

    def test_camera_frame_sizes(self):
        for width, height in ((320, 240), (640, 480), (1280, 720)):
            with self.subTest(size=f"{width}x{height}"):
                frame = _bgr24_frame(width, height, b"frame-size")
                self.assertEqual(len(frame), width * height * 3)
                self.assertEqual(self.checksum(frame), _reference_fnv1a32(frame))

    def test_exact_maximum_and_oversized(self):
        maximum = b"\xa5" * _MAX
        self.assertEqual(self.checksum(maximum), _reference_fnv1a32(maximum))
        del maximum
        with self.assertRaises(ValueError):
            self.checksum(bytes(_MAX + 1))

    def test_input_immutable_and_repeated_invocation_stable(self):
        data = _bgr24_frame(640, 480, b"immutability")
        snapshot = bytes(bytearray(data))
        digest = hashlib.sha256(data).digest()
        expected = _reference_fnv1a32(data)
        other = _bgr24_frame(320, 240, b"other")
        other_expected = _reference_fnv1a32(other)
        for _ in range(500):
            self.assertEqual(self.checksum(data), expected)
            self.assertEqual(self.checksum(other), other_expected)
        self.assertEqual(data, snapshot)
        self.assertEqual(hashlib.sha256(data).digest(), digest)

    def test_no_full_payload_copy(self):
        data = _bgr24_frame(640, 480, b"no-copy")
        self.checksum(data)  # warm any lazily created ctypes state
        gc.collect()
        tracemalloc.start()
        try:
            tracemalloc.reset_peak()
            self.checksum(data)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 64 * 1024)
        self.assertLess(peak, len(data) // 10)

    def test_c_char_p_binding_passes_bytes_buffer_address(self):
        data = b"payload\x00with-nul" * 1000
        # The loader's c_char_p argtype references the bytes object's own
        # immutable buffer; the call-path proof is in InvocationContractTests.
        pointer = ctypes.c_char_p(data)
        address = ctypes.cast(pointer, ctypes.c_void_p).value
        self.assertEqual(address, id(data) + _BYTES_DATA_OFFSET)

    def test_library_handle_lifetime(self):
        def make():
            checksum = load_native_fnv1a32(self.path)
            return checksum, weakref.ref(checksum._library)

        checksum, library_ref = make()
        gc.collect()
        self.assertIsNotNone(library_ref())
        self.assertIs(library_ref(), checksum._library)
        self.assertEqual(checksum(b"lifetime"), _reference_fnv1a32(b"lifetime"))
        call = checksum.__call__
        del checksum
        gc.collect()
        self.assertIsNotNone(library_ref())
        self.assertEqual(call(b"lifetime"), _reference_fnv1a32(b"lifetime"))

    def test_independent_loads(self):
        first = load_native_fnv1a32(self.path)
        second = load_native_fnv1a32(self.path)
        self.assertIsNot(first, second)
        self.assertIsNot(first._checksum_v1, second._checksum_v1)
        self.assertEqual(first(b"x"), second(b"x"))


# --- Module-level invariants ---------------------------------------------------


class ModuleInvariantTests(unittest.TestCase):
    def test_import_has_no_filesystem_or_loading_side_effects(self):
        code = r"""
import __future__, ctypes, importlib.util, json, os, re, sys
events = []
def hook(event, args):
    if event.startswith("ctypes.") or event in (
        "open", "os.listdir", "os.scandir", "socket.connect", "socket.getaddrinfo",
        "subprocess.Popen", "os.system",
    ):
        events.append([event, repr(args)[:300]])
sys.addaudithook(hook)
import helper_native_fnv
source = helper_native_fnv.__file__
allowed = [source, importlib.util.cache_from_source(source)]
sys.stdout.write(json.dumps({"events": events, "allowed": allowed}))
"""
        result = subprocess.run(
            [sys.executable, "-B", "-c", code],
            cwd=str(_HELPER_DIR),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        allowed = [repr(path) for path in report["allowed"]]
        unexpected = []
        for event, args in report["events"]:
            if event == "open" and any(args.startswith("(" + a) for a in allowed):
                continue  # the import system reading the module source/cache
            if event == "os.listdir":
                continue  # the import system's directory cache
            unexpected.append((event, args))
        self.assertEqual(unexpected, [])

    def test_no_mutable_module_state(self):
        mutable = (list, dict, set, bytearray, ctypes.CDLL)
        for name, value in vars(helper_native_fnv).items():
            if name.startswith("__"):
                continue
            with self.subTest(name=name):
                self.assertNotIsInstance(value, mutable)

    def test_standard_library_imports_only_and_no_fallback(self):
        tree = ast.parse(_MODULE_PATH.read_text(encoding="utf-8"))
        imported = set()
        constants = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module)
            elif isinstance(node, ast.Constant) and type(node.value) is int:
                constants.add(node.value)
        self.assertEqual(imported, {"__future__", "ctypes", "os", "re", "sys"})
        # No pure-Python FNV implementation (prime) lives in the loader.
        self.assertNotIn(0x01000193, constants)
        source = _MODULE_PATH.read_text(encoding="utf-8")
        for forbidden in ("FreeLibrary", "dlclose", "def _fnv1a32", "except Exception",
                          "except BaseException", "except:", "print(", "logging"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_load_failure_never_returns_a_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = os.path.join(directory, "missing" + _current_platform_suffix())
            with self.assertRaises(NativeFnv1a32LoadError):
                load_native_fnv1a32(missing)

    def test_existing_production_checksums_untouched_and_independent(self):
        for module in (helper_frame_input, helper_frame_rgb):
            with self.subTest(module=module.__name__):
                self.assertTrue(callable(module._fnv1a32))
                self.assertNotIn("helper_native_fnv", vars(module))
                self.assertEqual(module._fnv1a32(b"foobar"), 0xBF9CF968)


# --- Bounded synthetic benchmark ----------------------------------------------


def _percentile(sorted_values, percent):
    rank = max(1, math.ceil(percent / 100.0 * len(sorted_values)))
    return sorted_values[rank - 1]


def _measure(operation, samples, warmup):
    for _ in range(warmup):
        operation()
    timings = []
    for _ in range(samples):
        start = time.perf_counter_ns()
        operation()
        timings.append((time.perf_counter_ns() - start) / 1e6)
    timings.sort()
    return {
        "samples": samples,
        "warmup": warmup,
        "p50_ms": round(_percentile(timings, 50), 4),
        "p95_ms": round(_percentile(timings, 95), 4),
        "p99_ms": round(_percentile(timings, 99), 4),
        "max_ms": round(timings[-1], 4),
    }


def _run_benchmark(library_path, samples, warmup, enforce):
    checksum = load_native_fnv1a32(library_path)
    report = {
        "environment": {
            "python": sys.version.split()[0],
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "library": os.path.basename(library_path),
            "library_parent": os.path.basename(os.path.dirname(library_path)),
            "payload": "synthetic BGR24 (no camera, no MediaPipe)",
        },
        "results": {},
    }
    for width, height in ((320, 240), (640, 480), (1280, 720)):
        payload = _bgr24_frame(width, height, b"benchmark")
        expected = _reference_fnv1a32(payload) if width <= 640 else checksum(payload)
        if checksum(payload) != expected:
            raise AssertionError("benchmark payload parity failure")

        def single():
            checksum(payload)

        def double():
            checksum(payload)
            checksum(payload)

        report["results"][f"{width}x{height}"] = {
            "single": _measure(single, samples, warmup),
            "two_checksums": _measure(double, samples, warmup),
        }
    vga = report["results"]["640x480"]
    acceptance = {
        "single_p95_le_3ms": vga["single"]["p95_ms"] <= 3.0,
        "two_checksums_p95_le_6ms": vga["two_checksums"]["p95_ms"] <= 6.0,
    }
    report["acceptance_640x480"] = acceptance
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    if enforce and not all(acceptance.values()):
        return 1
    return 0


def main(argv):
    global _NATIVE_LIBRARY_PATH
    remaining = [argv[0]]
    benchmark = False
    enforce = False
    samples = 2000
    warmup = 200
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument in ("--native-library", "--samples", "--warmup"):
            if index + 1 >= len(argv):
                sys.stderr.write(f"{argument} requires a value\n")
                return 2
            value = argv[index + 1]
            if argument == "--native-library":
                _NATIVE_LIBRARY_PATH = value
            elif argument == "--samples":
                samples = int(value)
            else:
                warmup = int(value)
            index += 2
            continue
        if argument == "--benchmark":
            benchmark = True
        elif argument == "--enforce-acceptance":
            enforce = True
        else:
            remaining.append(argument)
        index += 1
    if _NATIVE_LIBRARY_PATH is None:
        sys.stderr.write(
            "error: --native-library <absolute path> is required; native "
            "integration tests are never skipped\n"
        )
        return 2
    if benchmark:
        return _run_benchmark(_NATIVE_LIBRARY_PATH, samples, warmup, enforce)
    program = unittest.main(module=__name__, argv=remaining, exit=False)
    return 0 if program.result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
