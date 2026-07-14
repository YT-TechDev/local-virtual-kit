"""Standard-library tests for blendshape_category_adapter.py.

Run directly: python -B test_blendshape_category_adapter.py
"""

import math
import unittest
from dataclasses import dataclass

from blendshape_category_adapter import (
    MAX_BLENDSHAPE_CATEGORY_COUNT,
    _EXPRESSION_BLENDSHAPE_NAMES,
    extract_expression_blendshape_scores,
)
from expression_mapping import ExpressionValues, map_blendshape_scores


@dataclass
class FakeCategory:
    """Synthetic stand-in for a MediaPipe Category, not imported by the adapter."""

    index: int
    score: float | None
    display_name: str | None
    category_name: str | None


class _MissingCategoryNameCategory:
    score = 0.5
    display_name = None
    index = 0


class _MissingScoreCategory:
    category_name = "jawOpen"
    display_name = None
    index = 0


class _RaisingCategoryNameCategory:
    score = 0.5

    @property
    def category_name(self) -> str:
        raise RuntimeError("category_name access failed")


class _RaisingScoreCategory:
    category_name = "jawOpen"

    @property
    def score(self) -> float:
        raise RuntimeError("score access failed")


class _LyingLengthSequence:
    """Reports a small length but yields more items than that on iteration."""

    def __len__(self) -> int:
        return 1

    def __iter__(self):
        return iter(
            [FakeCategory(0, None, None, None)] * (MAX_BLENDSHAPE_CATEGORY_COUNT + 5)
        )


class ExtractExpressionBlendshapeScoresTests(unittest.TestCase):
    def test_valid_empty_sequence_returns_empty_dict(self) -> None:
        self.assertEqual(extract_expression_blendshape_scores([]), {})

    def test_complete_five_category_input(self) -> None:
        categories = [
            FakeCategory(0, 0.1, "Eye Blink Left", "eyeBlinkLeft"),
            FakeCategory(1, 0.2, "Eye Blink Right", "eyeBlinkRight"),
            FakeCategory(2, 0.3, "Jaw Open", "jawOpen"),
            FakeCategory(3, 0.4, "Mouth Smile Left", "mouthSmileLeft"),
            FakeCategory(4, 0.5, "Mouth Smile Right", "mouthSmileRight"),
        ]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(
            result,
            {
                "eyeBlinkLeft": 0.1,
                "eyeBlinkRight": 0.2,
                "jawOpen": 0.3,
                "mouthSmileLeft": 0.4,
                "mouthSmileRight": 0.5,
            },
        )

    def test_partial_input(self) -> None:
        categories = [FakeCategory(0, 0.7, "Jaw Open", "jawOpen")]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {"jawOpen": 0.7})

    def test_output_uses_canonical_order_regardless_of_input_order(self) -> None:
        categories = [
            FakeCategory(4, 0.5, None, "mouthSmileRight"),
            FakeCategory(3, 0.4, None, "mouthSmileLeft"),
            FakeCategory(2, 0.3, None, "jawOpen"),
            FakeCategory(1, 0.2, None, "eyeBlinkRight"),
            FakeCategory(0, 0.1, None, "eyeBlinkLeft"),
        ]
        result = extract_expression_blendshape_scores(categories)
        self.assertIsNotNone(result)
        self.assertEqual(list(result.keys()), list(_EXPRESSION_BLENDSHAPE_NAMES))

    def test_unknown_category_is_ignored(self) -> None:
        categories = [
            FakeCategory(0, 0.9, None, "someUnknownCategory"),
            FakeCategory(1, 0.2, None, "eyeBlinkLeft"),
        ]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {"eyeBlinkLeft": 0.2})

    def test_duplicate_unknown_category_is_ignored(self) -> None:
        categories = [
            FakeCategory(0, 0.9, None, "someUnknownCategory"),
            FakeCategory(1, 0.1, None, "someUnknownCategory"),
            FakeCategory(2, 0.3, None, "jawOpen"),
        ]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {"jawOpen": 0.3})

    def test_category_name_none_is_ignored(self) -> None:
        categories = [FakeCategory(0, 0.9, "Jaw Open", None)]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {})

    def test_display_name_never_used_as_fallback(self) -> None:
        categories = [FakeCategory(0, 0.9, "eyeBlinkLeft", None)]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {})

    def test_index_never_used_to_infer_name(self) -> None:
        categories = [FakeCategory(0, 0.9, None, None)]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {})

    def test_case_mismatch_is_ignored(self) -> None:
        categories = [FakeCategory(0, 0.9, None, "EyeBlinkLeft")]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {})

    def test_whitespace_is_not_normalized(self) -> None:
        categories = [FakeCategory(0, 0.9, None, " eyeBlinkLeft ")]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {})

    def test_integer_score_becomes_float(self) -> None:
        categories = [FakeCategory(0, 1, None, "jawOpen")]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {"jawOpen": 1.0})
        self.assertIsInstance(result["jawOpen"], float)

    def test_finite_negative_score_is_preserved(self) -> None:
        categories = [FakeCategory(0, -3.5, None, "jawOpen")]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {"jawOpen": -3.5})

    def test_finite_score_above_one_is_preserved(self) -> None:
        categories = [FakeCategory(0, 7.25, None, "jawOpen")]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {"jawOpen": 7.25})

    def test_required_score_none_returns_none(self) -> None:
        categories = [FakeCategory(0, None, None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_required_score_string_returns_none(self) -> None:
        categories = [FakeCategory(0, "0.5", None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_required_score_bool_returns_none(self) -> None:
        categories_true = [FakeCategory(0, True, None, "jawOpen")]
        categories_false = [FakeCategory(0, False, None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories_true))
        self.assertIsNone(extract_expression_blendshape_scores(categories_false))

    def test_nan_score_returns_none(self) -> None:
        categories = [FakeCategory(0, math.nan, None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_positive_infinity_score_returns_none(self) -> None:
        categories = [FakeCategory(0, math.inf, None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_negative_infinity_score_returns_none(self) -> None:
        categories = [FakeCategory(0, -math.inf, None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_integer_too_large_for_float_conversion_returns_none(self) -> None:
        categories = [FakeCategory(0, 10**400, None, "jawOpen")]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_identical_duplicate_required_name_returns_none(self) -> None:
        categories = [
            FakeCategory(0, 0.3, None, "jawOpen"),
            FakeCategory(1, 0.3, None, "jawOpen"),
        ]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_differing_duplicate_required_name_returns_none(self) -> None:
        categories = [
            FakeCategory(0, 0.3, None, "jawOpen"),
            FakeCategory(1, 0.9, None, "jawOpen"),
        ]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_item_missing_category_name_returns_none(self) -> None:
        categories = [_MissingCategoryNameCategory()]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_required_item_missing_score_returns_none(self) -> None:
        categories = [_MissingScoreCategory()]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_category_name_property_raising_returns_none(self) -> None:
        categories = [_RaisingCategoryNameCategory()]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_score_property_raising_returns_none(self) -> None:
        categories = [_RaisingScoreCategory()]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_none_input_returns_none(self) -> None:
        self.assertIsNone(extract_expression_blendshape_scores(None))

    def test_str_input_returns_none(self) -> None:
        self.assertIsNone(extract_expression_blendshape_scores("eyeBlinkLeft"))

    def test_bytes_input_returns_none(self) -> None:
        self.assertIsNone(extract_expression_blendshape_scores(b"eyeBlinkLeft"))

    def test_bytearray_input_returns_none(self) -> None:
        self.assertIsNone(extract_expression_blendshape_scores(bytearray(b"x")))

    def test_generator_input_returns_none(self) -> None:
        generator = (FakeCategory(0, 0.5, None, "jawOpen") for _ in range(1))
        self.assertIsNone(extract_expression_blendshape_scores(generator))

    def test_exactly_max_count_items_accepted(self) -> None:
        categories = [
            FakeCategory(i, None, None, None)
            for i in range(MAX_BLENDSHAPE_CATEGORY_COUNT)
        ]
        result = extract_expression_blendshape_scores(categories)
        self.assertEqual(result, {})

    def test_more_than_max_count_items_returns_none(self) -> None:
        categories = [
            FakeCategory(i, None, None, None)
            for i in range(MAX_BLENDSHAPE_CATEGORY_COUNT + 1)
        ]
        self.assertIsNone(extract_expression_blendshape_scores(categories))

    def test_lying_reported_length_returns_none(self) -> None:
        self.assertIsNone(
            extract_expression_blendshape_scores(_LyingLengthSequence())
        )

    def test_input_objects_and_sequence_are_not_mutated(self) -> None:
        categories = [
            FakeCategory(0, 0.1, "Eye Blink Left", "eyeBlinkLeft"),
            FakeCategory(1, 0.9, None, "someUnknownCategory"),
        ]
        snapshot = [FakeCategory(c.index, c.score, c.display_name, c.category_name) for c in categories]

        extract_expression_blendshape_scores(categories)

        self.assertEqual(categories, snapshot)
        self.assertEqual(len(categories), 2)

    def test_output_contains_at_most_five_keys(self) -> None:
        categories = [
            FakeCategory(0, 0.1, None, "eyeBlinkLeft"),
            FakeCategory(1, 0.2, None, "eyeBlinkRight"),
            FakeCategory(2, 0.3, None, "jawOpen"),
            FakeCategory(3, 0.4, None, "mouthSmileLeft"),
            FakeCategory(4, 0.5, None, "mouthSmileRight"),
            FakeCategory(5, 0.9, None, "someUnknownCategory"),
            FakeCategory(6, 0.9, None, "anotherUnknownCategory"),
        ]
        result = extract_expression_blendshape_scores(categories)
        self.assertLessEqual(len(result), 5)
        self.assertEqual(len(result), 5)

    def test_integration_with_map_blendshape_scores(self) -> None:
        categories = [
            FakeCategory(0, 0.25, None, "eyeBlinkLeft"),
            FakeCategory(1, 0.75, None, "eyeBlinkRight"),
            FakeCategory(2, 0.4, None, "jawOpen"),
            FakeCategory(3, 0.2, None, "mouthSmileLeft"),
            FakeCategory(4, 0.6, None, "mouthSmileRight"),
        ]
        scores = extract_expression_blendshape_scores(categories)
        self.assertIsNotNone(scores)
        result = map_blendshape_scores(scores)
        self.assertAlmostEqual(result.left_eye_open, 0.75)
        self.assertAlmostEqual(result.right_eye_open, 0.25)
        self.assertAlmostEqual(result.mouth_open, 0.4)
        self.assertAlmostEqual(result.mouth_smile, 0.4)

    def test_missing_required_category_produces_neutral_expression_via_map(
        self,
    ) -> None:
        scores = extract_expression_blendshape_scores([])
        self.assertEqual(scores, {})
        result = map_blendshape_scores(scores)
        self.assertEqual(
            result,
            ExpressionValues(
                left_eye_open=1.0,
                right_eye_open=1.0,
                mouth_open=0.0,
                mouth_smile=0.0,
            ),
        )

    def test_finite_out_of_range_scores_clamped_only_by_map(self) -> None:
        categories = [
            FakeCategory(0, -2.0, None, "eyeBlinkLeft"),
            FakeCategory(1, 5.0, None, "jawOpen"),
        ]
        scores = extract_expression_blendshape_scores(categories)
        self.assertEqual(scores["eyeBlinkLeft"], -2.0)
        self.assertEqual(scores["jawOpen"], 5.0)

        result = map_blendshape_scores(scores)
        self.assertEqual(result.left_eye_open, 1.0)
        self.assertEqual(result.mouth_open, 1.0)


if __name__ == "__main__":
    unittest.main()
