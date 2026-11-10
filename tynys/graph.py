"""Load the CSR street graph of a city (once per process) and answer simple spatial questions."""

import json
import math
import os

from tynys.astar import haversine_m
from tynys.classes import KIND_INDEX

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

_graphs = {}  # city -> Graph, so each process parses a graph file only once


class Graph:
    """CSR arrays of one city. Edge k goes from node n to targets[k] for offsets[n] <= k < offsets[n+1]."""

    def __init__(self, raw):
        self.city = raw["city"]
        self.bbox = raw["bbox"]  # [south, west, north, east]
        self.osm_timestamp = raw.get("osm_timestamp")
        self.lat = [x / 1e6 for x in raw["lat"]]
        self.lon = [x / 1e6 for x in raw["lon"]]
        self.offsets = raw["offsets"]
        self.targets = raw["targets"]
        self.kind = raw["kind"]
        self.length_m = [d / 10 for d in raw["length_dm"]]
        # edge costs of the two searches
        self.cost_shortest = self.length_m
        self.cost_cleanest = [length * KIND_INDEX[k] for length, k in zip(self.length_m, self.kind)]
        self.n_nodes = len(self.lat)
        self.n_edges = len(self.targets) // 2

    def in_bbox(self, lat, lon):
        south, west, north, east = self.bbox
        return south <= lat <= north and west <= lon <= east

    def nearest_node(self, lat, lon):
        """Closest graph node to (lat, lon): scan with a flat-earth distance, report the haversine metres."""
        kx = math.cos(math.radians(lat))
        best = -1
        best_d2 = math.inf
        lats = self.lat
        lons = self.lon
        for i in range(self.n_nodes):
            dy = lats[i] - lat
            dx = (lons[i] - lon) * kx
            d2 = dx * dx + dy * dy
            if d2 < best_d2:
                best_d2 = d2
                best = i
        return best, haversine_m(lat, lon, lats[best], lons[best])

    def edge_between(self, u, v, costs):
        """Index of the cheapest edge u -> v under the given cost list."""
        best = -1
        for k in range(self.offsets[u], self.offsets[u + 1]):
            if self.targets[k] == v and (best < 0 or costs[k] < costs[best]):
                best = k
        return best


def graph_path(city):
    return os.path.join(DATA_DIR, f"graph_{city}.json")


def load_graph(city):
    """Parse data/graph_<city>.json the first time it is needed, then reuse it."""
    if city not in _graphs:
        with open(graph_path(city), encoding="utf-8") as f:
            _graphs[city] = Graph(json.load(f))
    return _graphs[city]


def graph_summary(city):
    """Node / edge counts and bbox without keeping the arrays (for /api/meta)."""
    g = load_graph(city)
    return {"nodes": g.n_nodes, "edges": g.n_edges, "bbox": g.bbox}
