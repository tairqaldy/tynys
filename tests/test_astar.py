import unittest

from tynys import astar
from tynys.classes import H_FACTOR, KIND_INDEX

GRID = [
    "S....",
    "####.",
    ".....",
    ".####",
    "....G",
]


def grid_graph(rows):
    """CSR graph of the free cells, 4-neighbour moves of cost 1."""
    cells = [(r, c) for r in range(len(rows)) for c in range(len(rows[0])) if rows[r][c] != "#"]
    index = {cell: i for i, cell in enumerate(cells)}
    offsets, targets, cost = [0], [], []
    for (r, c) in cells:
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (r + dr, c + dc) in index:
                targets.append(index[(r + dr, c + dc)])
                cost.append(1.0)
        offsets.append(len(targets))
    return cells, index, offsets, targets, cost


class GridWithWall(unittest.TestCase):
    def test_known_optimal_cost(self):
        cells, index, offsets, targets, cost = grid_graph(GRID)
        start, goal = index[(0, 0)], index[(4, 4)]

        def manhattan(n):
            return abs(cells[n][0] - 4) + abs(cells[n][1] - 4)

        a = astar.astar(offsets, targets, cost, start, goal, manhattan)
        d = astar.astar(offsets, targets, cost, start, goal, None)
        self.assertEqual(a["cost"], 16)
        self.assertEqual(d["cost"], 16)
        self.assertEqual(len(a["path"]), 17)
        for u, v in zip(a["path"], a["path"][1:]):
            (r1, c1), (r2, c2) = cells[u], cells[v]
            self.assertEqual(abs(r1 - r2) + abs(c1 - c2), 1)
        self.assertLessEqual(a["expanded"], d["expanded"])

    def test_unreachable(self):
        cells, index, offsets, targets, cost = grid_graph(["S#G"])
        r = astar.astar(offsets, targets, cost, index[(0, 0)], index[(0, 2)], None)
        self.assertIsNone(r["path"])


class Heuristic(unittest.TestCase):
    def test_h_factor_is_min_index(self):
        self.assertEqual(min(KIND_INDEX), H_FACTOR)

    def test_haversine(self):
        # one degree of latitude ~ 111.2 km
        self.assertAlmostEqual(astar.haversine_m(51.0, 71.0, 52.0, 71.0), 111195, delta=5)
        self.assertEqual(astar.haversine_m(51.0, 71.0, 51.0, 71.0), 0.0)


if __name__ == "__main__":
    unittest.main()
