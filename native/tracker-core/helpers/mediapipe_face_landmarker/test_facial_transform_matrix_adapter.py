"""Standard-library tests for facial_transform_matrix_adapter.py.

Run directly: python -B test_facial_transform_matrix_adapter.py

Does not import real numpy or mediapipe. Measured runtime behavior is
represented with minimal fake objects exposing only the structural
`shape`/`ndim`/`tolist` contract observed during the completed local probe.
"""

import contextlib
import io
import math
import unittest
from collections.abc import Sequence as SequenceABC

from facial_transform_matrix_adapter import adapt_facial_transform_matrix_payload
from matrix_mapping import normalize_facial_transform_matrix

IDENTITY_MATRIX = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]

DISTINCT_MATRIX = [
    [1.0, 2.0, 3.0, 4.0],
    [5.0, 6.0, 7.0, 8.0],
    [9.0, 10.0, 11.0, 12.0],
    [13.0, 14.0, 15.0, 16.0],
]


class _FloatLike:
    """Defines `__float__` but is not a built-in `int`/`float`."""

    def __init__(self, value: float) -> None:
        self._value = value

    def __float__(self) -> float:
        return self._value


class _RaisingFloatConversion(int):
    """A built-in-numeric subtype whose float conversion raises."""

    def __float__(self):
        raise RuntimeError("float conversion failed")


class _LenRaisesSequence(SequenceABC):
    def __len__(self):
        raise RuntimeError("len failed")

    def __getitem__(self, index):
        raise IndexError(index)


class _LenRaisesSystemExit(SequenceABC):
    def __len__(self):
        raise SystemExit("boom")

    def __getitem__(self, index):
        raise IndexError(index)


class _RowIterationRaisesSequence(SequenceABC):
    def __len__(self):
        return 4

    def __getitem__(self, index):
        raise RuntimeError("row access failed")


class _FakeNdarray:
    """Minimal ndarray-like fake: shape/ndim/tolist only, no NumPy import."""

    def __init__(self, shape, ndim, rows, dtype: object = "unused"):
        self.shape = shape
        self.ndim = ndim
        self.dtype = dtype
        self._rows = rows
        self.tolist_calls = 0

    def tolist(self):
        self.tolist_calls += 1
        return self._rows


class _ShapeRaises:
    ndim = 2

    def tolist(self):
        return [[0.0] * 4 for _ in range(4)]

    @property
    def shape(self):
        raise RuntimeError("shape failed")


class _ShapeRaisesSystemExit:
    ndim = 2

    def tolist(self):
        return [[0.0] * 4 for _ in range(4)]

    @property
    def shape(self):
        raise SystemExit("boom")


class _NoNdim:
    shape = (4, 4)

    def tolist(self):
        return [[0.0] * 4 for _ in range(4)]


class _NdimRaises:
    shape = (4, 4)

    def tolist(self):
        return [[0.0] * 4 for _ in range(4)]

    @property
    def ndim(self):
        raise RuntimeError("ndim failed")


class _NdimRaisesKeyboardInterrupt:
    shape = (4, 4)

    def tolist(self):
        return [[0.0] * 4 for _ in range(4)]

    @property
    def ndim(self):
        raise KeyboardInterrupt()


class _NoTolist:
    shape = (4, 4)
    ndim = 2


class _NonCallableTolist:
    shape = (4, 4)
    ndim = 2
    tolist = "not-callable"


class _TolistRaises:
    shape = (4, 4)
    ndim = 2

    def tolist(self):
        raise RuntimeError("tolist failed")


class _TolistRaisesSystemExit:
    shape = (4, 4)
    ndim = 2

    def tolist(self):
        raise SystemExit("boom")


class FacialTransformMatrixAdapterTests(unittest.TestCase):
    # -- Already-plain route ------------------------------------------------

    def test_plain_list_of_lists_identity_matrix_accepted(self) -> None:
        result = adapt_facial_transform_matrix_payload(IDENTITY_MATRIX)
        self.assertEqual(
            result,
            (
                (1.0, 0.0, 0.0, 0.0),
                (0.0, 1.0, 0.0, 0.0),
                (0.0, 0.0, 1.0, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            ),
        )

    def test_plain_tuple_of_tuples_accepted(self) -> None:
        payload = tuple(tuple(row) for row in IDENTITY_MATRIX)
        result = adapt_facial_transform_matrix_payload(payload)
        self.assertEqual(result[0], (1.0, 0.0, 0.0, 0.0))

    def test_integer_values_become_built_in_floats(self) -> None:
        payload = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        result = adapt_facial_transform_matrix_payload(payload)
        for row in result:
            for value in row:
                self.assertIs(type(value), float)

    def test_output_is_tuple_of_tuples(self) -> None:
        result = adapt_facial_transform_matrix_payload(IDENTITY_MATRIX)
        self.assertIsInstance(result, tuple)
        for row in result:
            self.assertIsInstance(row, tuple)

    def test_output_has_exact_4x4_shape(self) -> None:
        result = adapt_facial_transform_matrix_payload(IDENTITY_MATRIX)
        self.assertEqual(len(result), 4)
        for row in result:
            self.assertEqual(len(row), 4)

    def test_output_detached_from_mutable_input(self) -> None:
        payload = [list(row) for row in DISTINCT_MATRIX]
        result = adapt_facial_transform_matrix_payload(payload)
        payload[0][0] = -999.0
        self.assertEqual(result[0][0], 1.0)

    def test_input_not_mutated(self) -> None:
        payload = [list(row) for row in DISTINCT_MATRIX]
        before = [list(row) for row in payload]
        adapt_facial_transform_matrix_payload(payload)
        self.assertEqual(payload, before)

    def test_row_column_order_preserved_with_distinct_values(self) -> None:
        result = adapt_facial_transform_matrix_payload(DISTINCT_MATRIX)
        for row_index, row in enumerate(DISTINCT_MATRIX):
            for col_index, value in enumerate(row):
                self.assertEqual(result[row_index][col_index], float(value))

    def test_outer_str_bytes_bytearray_rejected(self) -> None:
        for payload in ("abcd", b"abcd", bytearray(b"abcd")):
            with self.subTest(payload=payload):
                self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_wrong_outer_length_rejected(self) -> None:
        self.assertIsNone(
            adapt_facial_transform_matrix_payload(IDENTITY_MATRIX[:3])
        )

    def test_non_sequence_row_rejected(self) -> None:
        payload = [5, [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_string_like_row_rejected(self) -> None:
        payload = ["abcd", [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_wrong_row_length_rejected(self) -> None:
        payload = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_bool_scalar_rejected(self) -> None:
        payload = [[True, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_non_built_in_numeric_like_scalar_rejected(self) -> None:
        payload = [[_FloatLike(1.0), 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_scalar_conversion_exception_returns_none(self) -> None:
        payload = [
            [_RaisingFloatConversion(1), 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_outer_length_exception_returns_none(self) -> None:
        self.assertIsNone(
            adapt_facial_transform_matrix_payload(_LenRaisesSequence())
        )

    def test_row_length_index_iteration_exception_returns_none(self) -> None:
        payload = [
            _RowIterationRaisesSequence(),
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
        self.assertIsNone(adapt_facial_transform_matrix_payload(payload))

    def test_keyboard_interrupt_and_system_exit_not_swallowed_plain_route(self) -> None:
        with self.assertRaises(SystemExit):
            adapt_facial_transform_matrix_payload(_LenRaisesSystemExit())

    # -- Responsibility separation -------------------------------------------

    def test_nan_adapted_but_rejected_by_normalize(self) -> None:
        payload = [
            [math.nan, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
        adapted = adapt_facial_transform_matrix_payload(payload)
        self.assertIsNotNone(adapted)
        self.assertIsNone(normalize_facial_transform_matrix(adapted))

    def test_infinity_adapted_but_rejected_downstream(self) -> None:
        payload = [
            [math.inf, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
        adapted = adapt_facial_transform_matrix_payload(payload)
        self.assertIsNotNone(adapted)
        self.assertIsNone(normalize_facial_transform_matrix(adapted))

    def test_structurally_valid_affine_invalid_rejected_by_matrix_mapping(self) -> None:
        payload = [
            [2.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
        adapted = adapt_facial_transform_matrix_payload(payload)
        self.assertIsNotNone(adapted)
        self.assertIsNone(normalize_facial_transform_matrix(adapted))

    def test_adapter_does_not_transpose_or_reorder_synthetic_values(self) -> None:
        result = adapt_facial_transform_matrix_payload(DISTINCT_MATRIX)
        self.assertEqual(result[0], (1.0, 2.0, 3.0, 4.0))
        self.assertEqual(result[3], (13.0, 14.0, 15.0, 16.0))

    # -- Measured runtime-like tolist route -----------------------------------

    def test_fake_runtime_object_is_not_a_sequence(self) -> None:
        fake = _FakeNdarray((4, 4), 2, [[0.0] * 4 for _ in range(4)])
        self.assertFalse(isinstance(fake, SequenceABC))

    def test_fake_runtime_shape_ndim_tolist_accepted(self) -> None:
        fake = _FakeNdarray((4, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        result = adapt_facial_transform_matrix_payload(fake)
        self.assertEqual(
            result,
            (
                (1.0, 0.0, 0.0, 0.0),
                (0.0, 1.0, 0.0, 0.0),
                (0.0, 0.0, 1.0, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            ),
        )

    def test_tolist_called_exactly_once(self) -> None:
        fake = _FakeNdarray((4, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        adapt_facial_transform_matrix_payload(fake)
        self.assertEqual(fake.tolist_calls, 1)

    def test_output_detached_from_tolist_result(self) -> None:
        rows = [list(row) for row in DISTINCT_MATRIX]
        fake = _FakeNdarray((4, 4), 2, rows)
        result = adapt_facial_transform_matrix_payload(fake)
        rows[0][0] = -999.0
        self.assertEqual(result[0][0], 1.0)

    def test_missing_shape_rejected(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(object()))

    def test_shape_access_exception_returns_none(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(_ShapeRaises()))

    def test_wrong_shape_rank_rejected(self) -> None:
        fake = _FakeNdarray((4,), 2, [list(row) for row in IDENTITY_MATRIX])
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))
        fake3 = _FakeNdarray((4, 4, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake3))

    def test_wrong_dimensions_rejected(self) -> None:
        fake = _FakeNdarray((3, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_bool_shape_dimensions_rejected(self) -> None:
        fake = _FakeNdarray((True, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_missing_ndim_rejected(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(_NoNdim()))

    def test_ndim_access_exception_returns_none(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(_NdimRaises()))

    def test_ndim_other_than_2_rejected(self) -> None:
        fake = _FakeNdarray((4, 4), 3, [list(row) for row in IDENTITY_MATRIX])
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_bool_ndim_rejected(self) -> None:
        fake = _FakeNdarray((4, 4), True, [list(row) for row in IDENTITY_MATRIX])
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_missing_tolist_rejected(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(_NoTolist()))

    def test_non_callable_tolist_rejected(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(_NonCallableTolist()))

    def test_tolist_exception_returns_none(self) -> None:
        self.assertIsNone(adapt_facial_transform_matrix_payload(_TolistRaises()))

    def test_tolist_returning_non_list_outer_rejected(self) -> None:
        rows = tuple(tuple(row) for row in IDENTITY_MATRIX)
        fake = _FakeNdarray((4, 4), 2, rows)
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_tolist_returning_non_list_rows_rejected(self) -> None:
        rows = [tuple(row) for row in IDENTITY_MATRIX]
        fake = _FakeNdarray((4, 4), 2, rows)
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_tolist_returning_wrong_dimensions_rejected(self) -> None:
        rows = [list(row) for row in IDENTITY_MATRIX[:3]]
        fake = _FakeNdarray((4, 4), 2, rows)
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_tolist_returning_bool_scalar_rejected(self) -> None:
        rows = [list(row) for row in IDENTITY_MATRIX]
        rows[0][0] = True
        fake = _FakeNdarray((4, 4), 2, rows)
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_tolist_returning_custom_numeric_scalar_rejected(self) -> None:
        rows = [list(row) for row in IDENTITY_MATRIX]
        rows[0][0] = _FloatLike(1.0)
        fake = _FakeNdarray((4, 4), 2, rows)
        self.assertIsNone(adapt_facial_transform_matrix_payload(fake))

    def test_tolist_returning_built_in_finite_floats_accepted(self) -> None:
        rows = [list(row) for row in IDENTITY_MATRIX]
        fake = _FakeNdarray((4, 4), 2, rows)
        result = adapt_facial_transform_matrix_payload(fake)
        self.assertIsNotNone(result)

    def test_tolist_returning_non_finite_floats_adapted_but_rejected_later(self) -> None:
        rows = [list(row) for row in IDENTITY_MATRIX]
        rows[0][0] = math.nan
        fake = _FakeNdarray((4, 4), 2, rows)
        adapted = adapt_facial_transform_matrix_payload(fake)
        self.assertIsNotNone(adapted)
        self.assertIsNone(normalize_facial_transform_matrix(adapted))

    def test_base_exception_from_shape_ndim_tolist_not_swallowed(self) -> None:
        with self.assertRaises(SystemExit):
            adapt_facial_transform_matrix_payload(_ShapeRaisesSystemExit())
        with self.assertRaises(KeyboardInterrupt):
            adapt_facial_transform_matrix_payload(_NdimRaisesKeyboardInterrupt())
        with self.assertRaises(SystemExit):
            adapt_facial_transform_matrix_payload(_TolistRaisesSystemExit())

    def test_no_dtype_attribute_required(self) -> None:
        fake = _FakeNdarray((4, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        del fake.dtype
        result = adapt_facial_transform_matrix_payload(fake)
        self.assertIsNotNone(result)

    def test_dtype_attribute_ignored(self) -> None:
        fake = _FakeNdarray(
            (4, 4), 2, [list(row) for row in IDENTITY_MATRIX], dtype="totally-wrong"
        )
        result = adapt_facial_transform_matrix_payload(fake)
        self.assertIsNotNone(result)

    def test_no_input_or_converted_value_logged_or_retained(self) -> None:
        fake = _FakeNdarray((4, 4), 2, [list(row) for row in DISTINCT_MATRIX])
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            adapt_facial_transform_matrix_payload(fake)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
