import math
import unittest

from tynys import hmm
from tynys.classes import BLOCKS, band, block_of_hour

# AIMA umbrella world: state 0 = rain, 1 = no rain; observation 0 = umbrella, 1 = no umbrella.
UMBRELLA_PRIOR = [0.5, 0.5]
UMBRELLA_T = [[0.7, 0.3], [0.3, 0.7]]
UMBRELLA_E = [[0.9, 0.1], [0.2, 0.8]]


class UmbrellaWorld(unittest.TestCase):
    def test_forward_matches_aima(self):
        beliefs = hmm.forward([0, 0], UMBRELLA_PRIOR, [UMBRELLA_T], UMBRELLA_E)
        self.assertAlmostEqual(beliefs[0][0], 0.818, places=3)
        self.assertAlmostEqual(beliefs[1][0], 0.883, places=3)

    def test_viterbi_matches_aima(self):
        obs = [0, 0, 1, 0, 0]  # u, u, not u, u, u
        path = hmm.viterbi(obs, UMBRELLA_PRIOR, [UMBRELLA_T] * 4, UMBRELLA_E)
        self.assertEqual(path, [0, 0, 1, 0, 0])  # r, r, not r, r, r

    def test_bayes_step_parts(self):
        step = hmm.bayes_update([0.5, 0.5], UMBRELLA_E, 0)
        self.assertEqual(step["likelihood"], [0.9, 0.2])
        self.assertAlmostEqual(step["evidence"], 0.55)
        self.assertAlmostEqual(step["posterior"][0], 0.45 / 0.55)


class Parameters(unittest.TestCase):
    def test_band_cutpoints(self):
        self.assertEqual([band(x) for x in (0, 5, 5.1, 15, 15.1, 25, 25.1, 200)], [0, 0, 1, 1, 2, 2, 3, 3])

    def test_blocks(self):
        self.assertEqual([block_of_hour(h) for h in (0, 5, 6, 11, 12, 17, 18, 23)],
                         ["night", "night", "morning", "morning", "day", "day", "evening", "evening"])

    def test_emission_rows_sum_to_one(self):
        for r in (0.55, 0.8, 0.95):
            e = hmm.emission_matrix(r)
            for row in e:
                self.assertAlmostEqual(sum(row), 1.0)
            self.assertEqual(e[0], [r, 1 - r, 0.0, 0.0])
            self.assertAlmostEqual(e[1][0], (1 - r) / 2)
            self.assertEqual(e[1][3], 0.0)

    def test_forecast_reliability(self):
        self.assertAlmostEqual(hmm.forecast_reliability(1), 0.745)
        self.assertAlmostEqual(hmm.forecast_reliability(48), 0.51)
        self.assertEqual(hmm.forecast_reliability(100), 0.5)

    def test_transition_rows_sum_to_one_and_sparse_rows_back_off(self):
        # 300 hours that are mostly low / moderate, one "high" hour at 13:00 (day block).
        bands = []
        hours = []
        for t in range(300):
            hours.append(t % 24)
            bands.append(0 if (t // 7) % 2 == 0 else 1)
        bands[13] = 3
        model = hmm.fit(bands, hours)
        for block in BLOCKS:
            for row in model["transitions"][block]:
                self.assertAlmostEqual(sum(row), 1.0)
        backed = {(b["block"], b["row"]) for b in model["backed_off"]}
        self.assertIn(("day", 3), backed)
        self.assertIn(("night", 2), backed)
        # a backed-off row equals the smoothed pooled row
        self.assertEqual(model["transitions"]["day"][3], hmm.smoothed_row(model["counts"]["all"][3]))
        # a dense row does not back off and uses its own block counts
        self.assertNotIn(("day", 0), backed)
        self.assertEqual(model["transitions"]["day"][0], hmm.smoothed_row(model["counts"]["day"][0]))
        # counts are integers and add up to the number of consecutive pairs
        self.assertEqual(sum(sum(r) for r in model["counts"]["all"]), 299)

    def test_prior_add_one(self):
        self.assertEqual(hmm.prior_from_bands([0, 0, 1, None]), [3 / 7, 2 / 7, 1 / 7, 1 / 7])

    def test_representative_pm25(self):
        rep = hmm.representative_pm25([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 30])
        self.assertEqual(rep, [3, 8.5, 20.0, 35.0])


class FilteringOnClasses(unittest.TestCase):
    def setUp(self):
        self.A = [[0.7, 0.2, 0.07, 0.03], [0.15, 0.7, 0.1, 0.05], [0.05, 0.2, 0.65, 0.1], [0.02, 0.08, 0.2, 0.7]]
        self.B = hmm.emission_matrix(0.8)

    def test_beliefs_sum_to_one(self):
        obs = [0, 1, 1, 2, 3, 3, 2, 1, 0]
        for belief in hmm.forward(obs, [0.25] * 4, [self.A] * 8, self.B):
            self.assertAlmostEqual(sum(belief), 1.0)
            self.assertTrue(all(p >= 0 for p in belief))

    def test_viterbi_survives_zero_emissions(self):
        # reading 0 is impossible from classes 2, 3; reading 3 is impossible from classes 0, 1
        obs = [0, 3, 0, 3]
        path = hmm.viterbi(obs, [0.25] * 4, [self.A] * 3, self.B)
        self.assertEqual(len(path), 4)
        for t, s in enumerate(path):
            self.assertGreater(self.B[s][obs[t]], 0)

    def test_predict_ahead(self):
        out = hmm.predict_ahead([0, 1, 0, 0], [self.A] * 3, [1, 2, 2])
        self.assertEqual([o["lead_h"] for o in out], [1, 2, 3])
        self.assertAlmostEqual(out[0]["forecast_reliability"], 0.745)
        for o in out:
            self.assertAlmostEqual(sum(o["belief"]), 1.0)
        self.assertFalse(math.isnan(hmm.expected_pm25(out[-1]["belief"], [2.5, 10, 20, 35])))


if __name__ == "__main__":
    unittest.main()
