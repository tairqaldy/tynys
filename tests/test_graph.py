"""A* on the real street graphs (data/graph_<city>.json)."""

import heapq
import math
import random
import unittest

from tynys import astar
from tynys.classes import H_FACTOR, KIND_INDEX, MAX_TRIP_M
from tynys.graph import load_graph

CITIES = ("astana", "almaty")
N_PAIRS = 30


def all_distances(g, costs, source):
    """Plain Dijkstra from source to every node (the graph is undirected, so these are distances to source)."""
    dist = [math.inf] * g.n_nodes
    dist[source] = 0.0
    heap = [(0.0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for k in range(g.offsets[u], g.offsets[u + 1]):
            v = g.targets[k]
            nd = d + costs[k]
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist


def random_pairs(g, seed):
    rng = random.Random(seed)
    pairs = []
    while len(pairs) < N_PAIRS:
        a, b = rng.randrange(g.n_nodes), rng.randrange(g.n_nodes)
        if a != b and astar.haversine_m(g.lat[a], g.lon[a], g.lat[b], g.lon[b]) <= MAX_TRIP_M:
            pairs.append((a, b))
    return pairs


class GraphFile(unittest.TestCase):
    def test_structure(self):
        for city in CITIES:
            g = load_graph(city)
            self.assertEqual(len(g.offsets), g.n_nodes + 1)
            self.assertEqual(g.offsets[-1], len(g.targets))
            self.assertEqual(len(g.targets) % 2, 0)
            self.assertLessEqual(g.n_nodes, 110000)
            south, west, north, east = g.bbox
            self.assertTrue(south < north and west < east)
            for i in range(0, g.n_nodes, 97):
                self.assertTrue(g.in_bbox(g.lat[i], g.lon[i]))

    def test_edge_lengths_never_below_straight_line(self):
        for city in CITIES:
            g = load_graph(city)
            for u in range(0, g.n_nodes, 13):
                for k in range(g.offsets[u], g.offsets[u + 1]):
                    v = g.targets[k]
                    straight = astar.haversine_m(g.lat[u], g.lon[u], g.lat[v], g.lon[v])
                    self.assertGreaterEqual(g.length_m[k], straight - 1e-9)
                    self.assertGreaterEqual(g.cost_cleanest[k], H_FACTOR * straight - 1e-9)
                    self.assertIn(g.kind[k], range(len(KIND_INDEX)))

    def test_h_factor(self):
        self.assertEqual(min(KIND_INDEX), H_FACTOR)


class AStarOnRealGraph(unittest.TestCase):
    def check_city(self, city, seed):
        g = load_graph(city)
        for (start, goal) in random_pairs(g, seed):
            weighted = {}
            for name, costs, factor in (("shortest", g.cost_shortest, 1.0),
                                        ("cleanest", g.cost_cleanest, H_FACTOR)):
                h = astar.make_heuristic(g.lat, g.lon, goal, factor)
                found = astar.astar(g.offsets, g.targets, costs, start, goal, h)
                dijkstra = astar.astar(g.offsets, g.targets, costs, start, goal, None)
                msg = f"{city} {name} {start}->{goal}"
                self.assertIsNotNone(found["path"], msg)
                self.assertAlmostEqual(found["cost"], dijkstra["cost"], delta=1e-6 * dijkstra["cost"], msg=msg)
                self.assertLessEqual(found["expanded"], dijkstra["expanded"], msg)
                # h never exceeds the true remaining cost at any node the search expanded
                to_goal = all_distances(g, costs, goal)
                for node in found["order"]:
                    self.assertLessEqual(h(node), to_goal[node] + 1e-6, msg)
                # the path is connected and its cost adds up
                total = 0.0
                for u, v in zip(found["path"], found["path"][1:]):
                    total += costs[g.edge_between(u, v, costs)]
                self.assertAlmostEqual(total, found["cost"], delta=1e-6 * max(1.0, total))
                weighted[name] = sum(g.cost_cleanest[g.edge_between(u, v, costs)]
                                     for u, v in zip(found["path"], found["path"][1:]))
            self.assertLessEqual(weighted["cleanest"], weighted["shortest"] + 1e-6)

    def test_astana(self):
        self.check_city("astana", 2026)

    def test_almaty(self):
        self.check_city("almaty", 1303)


if __name__ == "__main__":
    unittest.main()
