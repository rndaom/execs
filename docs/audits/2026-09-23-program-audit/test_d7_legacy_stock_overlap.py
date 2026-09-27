"""Synthetic checks for the name-level Viewmodels migration probe."""

import unittest

from d7_legacy_stock_overlap import matched_animation
from d7_stock_mdl_probe import Animation, Model, ProbeError, Sequence


def model(animations: tuple[str, ...], sequences: tuple[Sequence, ...]) -> Model:
    return Model(
        "weapons/c_models/c_scout_animations.mdl",
        "synthetic",
        tuple(Animation(name, 1, 30.0) for name in animations),
        sequences,
    )


class LegacyStockOverlapTests(unittest.TestCase):
    def test_one_sequence_and_its_sole_named_animation_match(self):
        source = model(("@ss_draw",), (Sequence("ss_draw", (0,)),))
        self.assertEqual(matched_animation(source, "ss_draw"), "@ss_draw")

    def test_matching_names_do_not_hide_an_extra_blend(self):
        source = model(("@ss_draw", "@other"), (Sequence("ss_draw", (0, 1)),))
        with self.assertRaises(ProbeError):
            matched_animation(source, "ss_draw")

    def test_matching_animation_must_be_the_sequence_reference(self):
        source = model(("@ss_draw", "@other"), (Sequence("ss_draw", (1,)),))
        with self.assertRaises(ProbeError):
            matched_animation(source, "ss_draw")

    def test_duplicate_sequence_label_is_ambiguous(self):
        source = model(("@ss_draw",), (Sequence("ss_draw", (0,)), Sequence("ss_draw", (0,))))
        with self.assertRaises(ProbeError):
            matched_animation(source, "ss_draw")

    def test_case_changed_name_is_not_an_exact_match(self):
        source = model(("@SS_Draw",), (Sequence("SS_Draw", (0,)),))
        with self.assertRaises(ProbeError):
            matched_animation(source, "ss_draw")


if __name__ == "__main__":
    unittest.main()
