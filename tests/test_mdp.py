import random
import unittest

from tynys import hmm, mdp
from tynys.classes import HARM


class HandSolved(unittest.TestCase):
    """2 states, H = 2, solved on paper:

    t=2: V = [5 (go), 0 (skip)]
    t=1: Q_wait = [-0.5 + 0.9*5 + 0.1*0, -0.5 + 0.4*5 + 0.6*0] = [4.0, 1.5]  ->  V = [5 go, 1.5 wait]
    t=0: Q_wait = [-0.5 + 0.8*5 + 0.2*1.5, -0.5 + 0.5*5 + 0.5*1.5] = [3.8, 2.75] -> policy [go, wait]
    """

    def setUp(self):
        self.r_go = [5.0, -1.0]
        self.T = [[[0.8, 0.2], [0.5, 0.5]], [[0.9, 0.1], [0.4, 0.6]]]
        self.stages = mdp.backward_induction(self.r_go, self.T, 0.5, must=False)

    def test_values(self):
        s = self.stages
        self.assertEqual(s[2]["policy"], ["go", "skip"])
        self.assertIsNone(s[2]["q_wait"])
        self.assertEqual(s[2]["value"], [5.0, 0.0])
        self.assertAlmostEqual(s[1]["q_wait"][0], 4.0)
        self.assertAlmostEqual(s[1]["q_wait"][1], 1.5)
        self.assertEqual(s[1]["policy"], ["go", "wait"])
        self.assertAlmostEqual(s[0]["q_wait"][0], 3.8)
        self.assertAlmostEqual(s[0]["q_wait"][1], 2.75)
        self.assertEqual(s[0]["policy"], ["go", "wait"])

    def test_qmdp_and_go_distribution(self):
        action, q_go, q_wait, q_skip = mdp.qmdp_decision([0.3, 0.7], self.stages[0])
        self.assertEqual(action, "wait")
        self.assertAlmostEqual(q_go, 0.8)
        self.assertAlmostEqual(q_wait, 3.065)
        self.assertEqual(q_skip, 0.0)
        p_go, p_skip = mdp.go_probabilities([0.3, 0.7], action, self.stages, self.T)
        self.assertAlmostEqual(p_go[0], 0.0)
        self.assertAlmostEqual(p_go[1], 0.59)
        self.assertAlmostEqual(p_go[2], 0.164)
        self.assertAlmostEqual(p_skip, 0.246)
        self.assertEqual(mdp.median_go_hour(p_go), 1)

    def test_tie_prefers_go(self):
        self.assertEqual(mdp.best_action(1.0, 1.0, 1.0)[0], "go")
        self.assertEqual(mdp.best_action(0.0, 1.0, 1.0)[0], "wait")
        self.assertEqual(mdp.best_action(-1.0, None, 0.0)[0], "skip")


def random_problem(rng, horizon):
    A = []
    for _ in range(4):
        row = [rng.random() + 0.05 for _ in range(4)]
        A.append([x / sum(row) for x in row])
    T = [mdp.waiting_transition(A, hmm.forecast_reliability(t + 1), rng.randrange(4)) for t in range(horizon)]
    belief = [rng.random() for _ in range(4)]
    belief = [x / sum(belief) for x in belief]
    return T, belief


class Properties(unittest.TestCase):
    def test_reward_go(self):
        self.assertEqual(mdp.reward_go(5, HARM, 45, 1.0, 1), [5, 4.25, 2.0, -2.5])
        self.assertEqual(mdp.reward_go(6, HARM, 60, 1.0, 2), [6, 4, -2, -14])

    def test_waiting_transition_is_bayes(self):
        A = [[0.5, 0.5, 0, 0], [0.25, 0.25, 0.25, 0.25], [0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5]]
        T = mdp.waiting_transition(A, 0.8, 1)
        # row 0: A * B[:,1] = [0.5*0.2, 0.5*0.8, 0, 0] -> [0.2, 0.8, 0, 0]
        for a, b in zip(T[0], [0.2, 0.8, 0, 0]):
            self.assertAlmostEqual(a, b)
        for row in T:
            self.assertAlmostEqual(sum(row), 1.0)

    def test_must_has_no_skip(self):
        rng = random.Random(1)
        for horizon in (1, 4, 12):
            T, belief = random_problem(rng, horizon)
            r_go = mdp.reward_go(6, HARM, 30, 1.0, 2)
            stages = mdp.backward_induction(r_go, T, 0.3, must=True)
            for stage in stages:
                self.assertNotIn("skip", stage["policy"])
            action, _, _, q_skip = mdp.qmdp_decision(belief, stages[0])
            self.assertNotEqual(action, "skip")
            self.assertIsNone(q_skip)
            p_go, p_skip = mdp.go_probabilities(belief, action, stages, T)
            self.assertEqual(p_skip, 0.0)
            self.assertAlmostEqual(sum(p_go), 1.0)

    def test_go_region_grows_with_wait_cost(self):
        rng = random.Random(7)
        costs = [0.1, 0.2, 0.3, 0.5, 0.7, 1.0]
        for trial in range(40):
            horizon = rng.randint(1, 12)
            T, _ = random_problem(rng, horizon)
            r_go = mdp.reward_go(rng.choice([5, 6, 8]), HARM, rng.randint(10, 180), rng.choice([1.0, 2.5]),
                                 rng.choice([1, 2]))
            policies = [mdp.backward_induction(r_go, T, c, must=False) for c in costs]
            for i in range(len(costs)):
                for j in range(i + 1, len(costs)):
                    for t in range(horizon + 1):
                        for s in range(4):
                            if policies[i][t]["policy"][s] == "go":
                                self.assertEqual(policies[j][t]["policy"][s], "go",
                                                 f"trial {trial} t={t} s={s} c={costs[i]}->{costs[j]}")

    def test_probabilities_sum_to_one_and_wait_never_best_now(self):
        rng = random.Random(3)
        for _ in range(200):
            horizon = rng.randint(1, 12)
            T, belief = random_problem(rng, horizon)
            r_go = mdp.reward_go(rng.choice([5, 6, 8]), HARM, rng.randint(10, 180), rng.choice([1.0, 2.5]),
                                 rng.choice([1, 2]))
            must = rng.random() < 0.3
            stages = mdp.backward_induction(r_go, T, rng.choice([0.1, 0.3, 1.0]), must)
            action, _, _, _ = mdp.qmdp_decision(belief, stages[0])
            p_go, p_skip = mdp.go_probabilities(belief, action, stages, T)
            self.assertAlmostEqual(sum(p_go) + p_skip, 1.0)
            if action == "wait":
                self.assertNotEqual(mdp.median_go_hour(p_go), 0)


if __name__ == "__main__":
    unittest.main()
