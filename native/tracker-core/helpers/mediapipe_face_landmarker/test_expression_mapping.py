"""Standard-library tests for expression_mapping.py.

Run directly: python -B test_expression_mapping.py
"""

import math
import unittest

from expression_mapping import ExpressionValues, map_blendshape_scores


class UnsupportedScore:
    """A placeholder object that is not a valid numeric score."""


class MapBlendshapeScoresTests(unittest.TestCase):
    def test_empty_input_is_neutral(self) -> None:
        result = map_blendshape_scores({})
        self.assertEqual(
            result,
            ExpressionValues(
                left_eye_open=1.0,
                right_eye_open=1.0,
                mouth_open=0.0,
                mouth_smile=0.0,
            ),
        )

    def test_representative_valid_input(self) -> None:
        scores = {
            "eyeBlinkLeft": 0.25,
            "eyeBlinkRight": 0.75,
            "jawOpen": 0.4,
            "mouthSmileLeft": 0.2,
            "mouthSmileRight": 0.6,
        }
        result = map_blendshape_scores(scores)
        self.assertAlmostEqual(result.left_eye_open, 0.75)
        self.assertAlmostEqual(result.right_eye_open, 0.25)
        self.assertAlmostEqual(result.mouth_open, 0.4)
        self.assertAlmostEqual(result.mouth_smile, 0.4)

    def test_exact_zero_boundary(self) -> None:
        scores = {
            "eyeBlinkLeft": 0.0,
            "eyeBlinkRight": 0.0,
            "jawOpen": 0.0,
            "mouthSmileLeft": 0.0,
            "mouthSmileRight": 0.0,
        }
        result = map_blendshape_scores(scores)
        self.assertEqual(result.left_eye_open, 1.0)
        self.assertEqual(result.right_eye_open, 1.0)
        self.assertEqual(result.mouth_open, 0.0)
        self.assertEqual(result.mouth_smile, 0.0)

    def test_exact_one_boundary(self) -> None:
        scores = {
            "eyeBlinkLeft": 1.0,
            "eyeBlinkRight": 1.0,
            "jawOpen": 1.0,
            "mouthSmileLeft": 1.0,
            "mouthSmileRight": 1.0,
        }
        result = map_blendshape_scores(scores)
        self.assertEqual(result.left_eye_open, 0.0)
        self.assertEqual(result.right_eye_open, 0.0)
        self.assertEqual(result.mouth_open, 1.0)
        self.assertEqual(result.mouth_smile, 1.0)

    def test_negative_values_clamp_to_zero(self) -> None:
        scores = {
            "eyeBlinkLeft": -0.5,
            "eyeBlinkRight": -100.0,
            "jawOpen": -0.1,
            "mouthSmileLeft": -1.0,
            "mouthSmileRight": -1.0,
        }
        result = map_blendshape_scores(scores)
        self.assertEqual(result.left_eye_open, 1.0)
        self.assertEqual(result.right_eye_open, 1.0)
        self.assertEqual(result.mouth_open, 0.0)
        self.assertEqual(result.mouth_smile, 0.0)

    def test_greater_than_one_values_clamp_to_one(self) -> None:
        scores = {
            "eyeBlinkLeft": 1.5,
            "eyeBlinkRight": 2.0,
            "jawOpen": 5.0,
            "mouthSmileLeft": 1.2,
            "mouthSmileRight": 1.8,
        }
        result = map_blendshape_scores(scores)
        self.assertEqual(result.left_eye_open, 0.0)
        self.assertEqual(result.right_eye_open, 0.0)
        self.assertEqual(result.mouth_open, 1.0)
        self.assertEqual(result.mouth_smile, 1.0)

    def test_nan_is_treated_as_missing(self) -> None:
        result = map_blendshape_scores({"jawOpen": math.nan})
        self.assertEqual(result.mouth_open, 0.0)

    def test_positive_infinity_is_treated_as_missing(self) -> None:
        result = map_blendshape_scores({"jawOpen": math.inf})
        self.assertEqual(result.mouth_open, 0.0)

    def test_negative_infinity_is_treated_as_missing(self) -> None:
        result = map_blendshape_scores({"jawOpen": -math.inf})
        self.assertEqual(result.mouth_open, 0.0)

    def test_none_value_is_treated_as_missing(self) -> None:
        result = map_blendshape_scores({"jawOpen": None})
        self.assertEqual(result.mouth_open, 0.0)

    def test_string_value_is_treated_as_missing(self) -> None:
        result = map_blendshape_scores({"jawOpen": "0.5"})
        self.assertEqual(result.mouth_open, 0.0)

    def test_bool_value_is_treated_as_missing(self) -> None:
        result_true = map_blendshape_scores({"jawOpen": True})
        result_false = map_blendshape_scores({"jawOpen": False})
        self.assertEqual(result_true.mouth_open, 0.0)
        self.assertEqual(result_false.mouth_open, 0.0)

    def test_unsupported_object_value_is_treated_as_missing(self) -> None:
        result = map_blendshape_scores({"jawOpen": UnsupportedScore()})
        self.assertEqual(result.mouth_open, 0.0)

    def test_one_missing_smile_side_still_averages(self) -> None:
        result = map_blendshape_scores({"mouthSmileLeft": 0.8})
        self.assertAlmostEqual(result.mouth_smile, 0.4)

    def test_unknown_categories_are_ignored(self) -> None:
        scores = {
            "eyeBlinkLeft": 0.1,
            "someUnknownCategory": 0.9,
            "anotherUnknownCategory": "not-a-number",
        }
        result = map_blendshape_scores(scores)
        self.assertAlmostEqual(result.left_eye_open, 0.9)

    def test_input_mapping_is_not_mutated(self) -> None:
        scores = {
            "eyeBlinkLeft": 2.0,
            "jawOpen": -1.0,
            "mouthSmileLeft": None,
        }
        original = dict(scores)
        map_blendshape_scores(scores)
        self.assertEqual(scores, original)

    def test_all_outputs_are_finite_and_bounded(self) -> None:
        cases = [
            {},
            {
                "eyeBlinkLeft": math.nan,
                "eyeBlinkRight": math.inf,
                "jawOpen": -math.inf,
                "mouthSmileLeft": -50.0,
                "mouthSmileRight": 50.0,
            },
            {
                "eyeBlinkLeft": "bad",
                "eyeBlinkRight": None,
                "jawOpen": True,
                "mouthSmileLeft": UnsupportedScore(),
            },
        ]
        for scores in cases:
            result = map_blendshape_scores(scores)
            for value in (
                result.left_eye_open,
                result.right_eye_open,
                result.mouth_open,
                result.mouth_smile,
            ):
                self.assertTrue(math.isfinite(value))
                self.assertGreaterEqual(value, 0.0)
                self.assertLessEqual(value, 1.0)


if __name__ == "__main__":
    unittest.main()
