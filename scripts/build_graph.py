"""Build the walkable street graph of a city centre from OpenStreetMap (Overpass API).

    python scripts/build_graph.py [astana|almaty ...]      -> data/graph_<city>.json

Steps (SPEC 4.5):
1. Download walkable ways and park / forest areas inside the bounding box (raw responses are
   cached under .cache/ so re-runs do not download again).
2. Drop parking aisles, driveways, private / no-access ways and foot=no ways.
3. Every OSM node of a kept way becomes a graph node; consecutive nodes become an undirected edge
   whose length is the haversine distance in decimetres, rounded up.
4. Tag each edge with a traffic-exposure kind: roadside (path/street within 25 m of a major or
   secondary road) > park (path/street midpoint inside a park / garden / forest) > base kind.
5. Keep the largest connected component and write CSR arrays.
"""

import hashlib
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tynys.astar import haversine_m  # noqa: E402
from tynys.classes import H_FACTOR, KIND_IDS, KIND_INDEX, KINDS, USER_AGENT  # noqa: E402

CACHE_DIR = os.path.join(ROOT, ".cache")
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter",
                 "https://overpass.private.coffee/api/interpreter"]

# Final bounding boxes [south, west, north, east].
BBOXES = {
    # Left bank (Baiterek, Khan Shatyr, EXPO / Nazarbayev University) and the old right-bank centre.
    "astana": [51.085, 71.385, 51.180, 71.485],
    # Central Almaty: Mega / Al-Farabi in the south to Almaty-2 station in the north.
    "almaty": [43.205, 76.880, 43.275, 76.975],
}

HIGHWAY_KIND = {
    "trunk": "major", "trunk_link": "major", "primary": "major", "primary_link": "major",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
    "residential": "street", "unclassified": "street", "living_street": "street", "service": "street",
    "footway": "path", "pedestrian": "path", "path": "path", "cycleway": "path", "steps": "path",
}
ROADSIDE_M = 25.0


# ---------------------------------------------------------------- Overpass with cache and back-off

def overpass(query, label):
    """POST a query to Overpass, caching the raw response in .cache/. Backs off on 429 / 504."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = hashlib.sha1(query.encode()).hexdigest()[:12]
    path = os.path.join(CACHE_DIR, f"overpass_{label}_{key}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    body = urllib.parse.urlencode({"data": query}).encode()
    delay = 20
    last_error = None
    for attempt in range(6):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
        try:
            print(f"  overpass {label} attempt {attempt + 1} ({url}) ...", flush=True)
            with urllib.request.urlopen(request, timeout=240) as response:
                raw = response.read()
            result = json.loads(raw.decode("utf-8"))
            if "remark" in result and "runtime error" in result["remark"]:
                raise RuntimeError(result["remark"])
            with open(path, "wb") as f:
                f.write(raw)
            return result
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as error:
            last_error = error
            status = getattr(error, "code", None)
            print(f"    failed: {error}; waiting {delay} s", flush=True)
            if status not in (None, 429, 502, 503, 504):
                raise
            time.sleep(delay)
            delay = min(delay * 2, 120)
    raise RuntimeError(f"Overpass failed for {label}: {last_error}")


def bbox_text(bbox):
    return ",".join(f"{x:.4f}" for x in bbox)


def fetch_ways(city, bbox):
    highways = "|".join(HIGHWAY_KIND)
    query = (f'[out:json][timeout:180];way["highway"~"^({highways})$"]({bbox_text(bbox)});'
             f"out body;>;out skel qt;")
    return overpass(query, f"{city}_ways")


def fetch_parks(city, bbox):
    b = bbox_text(bbox)
    query = (f'[out:json][timeout:180];('
             f'way["leisure"~"^(park|garden)$"]({b});relation["leisure"~"^(park|garden)$"]({b});'
             f'way["landuse"="forest"]({b});relation["landuse"="forest"]({b}););out geom;')
    return overpass(query, f"{city}_parks")


# ---------------------------------------------------------------- geometry helpers

def to_local_m(lat, lon, lat0):
    """Equirectangular projection to metres around latitude lat0 (fine at the 25 m scale)."""
    return (lon * math.cos(math.radians(lat0)) * 111320.0, lat * 110574.0)


def point_segment_m(p, a, b):
    """Distance from point p to segment ab, all in local metres."""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    u = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    u = max(0.0, min(1.0, u))
    return math.hypot(px - (ax + u * dx), py - (ay + u * dy))


def inside_even_odd(lat, lon, segments):
    """Ray casting: the point is inside if a ray to the east crosses an odd number of segments.

    Works for a multipolygon given as the set of all its ring segments (holes included).
    """
    inside = False
    for (lat1, lon1, lat2, lon2) in segments:
        if (lat1 > lat) != (lat2 > lat):
            cross_lon = lon1 + (lat - lat1) * (lon2 - lon1) / (lat2 - lat1)
            if cross_lon > lon:
                inside = not inside
    return inside


# ---------------------------------------------------------------- build

def keep_way(tags):
    if tags.get("service") in ("parking_aisle", "driveway"):
        return False
    if tags.get("foot") == "no":
        return False
    if tags.get("access") in ("private", "no") and tags.get("foot") not in ("yes", "designated", "permissive"):
        return False
    return True


def build(city):
    bbox = BBOXES[city]
    south, west, north, east = bbox
    lat0 = (south + north) / 2
    print(f"{city}: bbox {bbox}")
    ways_json = fetch_ways(city, bbox)
    parks_json = fetch_parks(city, bbox)

    # node coordinates, rounded to 1e-6 degrees (the stored precision)
    coord = {}
    ways = []
    for el in ways_json["elements"]:
        if el["type"] == "node":
            coord[el["id"]] = (round(el["lat"] * 1e6), round(el["lon"] * 1e6))
        elif el["type"] == "way":
            ways.append(el)

    def inside_bbox(node_id):
        lat, lon = coord[node_id]
        return south <= lat / 1e6 <= north and west <= lon / 1e6 <= east

    # road segments that produce traffic (all major / secondary ways, even foot=no ones)
    cell = 0.0005
    road_grid = {"major": {}, "secondary": {}}
    for way in ways:
        kind = HIGHWAY_KIND.get(way["tags"].get("highway"))
        if kind not in road_grid:
            continue
        refs = [r for r in way["nodes"] if r in coord]
        for a, b in zip(refs, refs[1:]):
            la, oa = coord[a][0] / 1e6, coord[a][1] / 1e6
            lb, ob = coord[b][0] / 1e6, coord[b][1] / 1e6
            seg = (to_local_m(la, oa, lat0), to_local_m(lb, ob, lat0))
            for i in range(int(min(la, lb) / cell) - 1, int(max(la, lb) / cell) + 2):
                for j in range(int(min(oa, ob) / cell) - 1, int(max(oa, ob) / cell) + 2):
                    road_grid[kind].setdefault((i, j), []).append(seg)

    def near_road(kind, lat, lon):
        p = to_local_m(lat, lon, lat0)
        for seg in road_grid[kind].get((int(lat / cell), int(lon / cell)), ()):
            if point_segment_m(p, seg[0], seg[1]) <= ROADSIDE_M:
                return True
        return False

    # park polygons as segment sets, indexed by a coarse grid of their bounding boxes
    parks = []
    for el in parks_json["elements"]:
        rings = []
        if el["type"] == "way" and "geometry" in el:
            rings.append(el["geometry"])
        elif el["type"] == "relation":
            for m in el.get("members", []):
                if m.get("type") == "way" and "geometry" in m and m.get("role") in ("outer", "inner", ""):
                    rings.append(m["geometry"])
        segments = []
        for ring in rings:
            pts = [(p["lat"], p["lon"]) for p in ring if p]
            for (a, b) in zip(pts, pts[1:]):
                segments.append((a[0], a[1], b[0], b[1]))
        if segments:
            lats = [s[0] for s in segments] + [s[2] for s in segments]
            lons = [s[1] for s in segments] + [s[3] for s in segments]
            parks.append({"bbox": (min(lats), min(lons), max(lats), max(lons)), "segments": segments})
    park_cell = 0.005
    park_grid = {}
    for k, park in enumerate(parks):
        s, w, n, e = park["bbox"]
        for i in range(int(s / park_cell), int(n / park_cell) + 1):
            for j in range(int(w / park_cell), int(e / park_cell) + 1):
                park_grid.setdefault((i, j), []).append(k)

    def in_park(lat, lon):
        for k in park_grid.get((int(lat / park_cell), int(lon / park_cell)), ()):
            s, w, n, e = parks[k]["bbox"]
            if s <= lat <= n and w <= lon <= e and inside_even_odd(lat, lon, parks[k]["segments"]):
                return True
        return False

    # edges between consecutive nodes of kept ways, both endpoints inside the bbox
    kind_number = {k: i for i, k in enumerate(KIND_IDS)}
    edges = {}  # (u, v) with u < v -> kind number
    dropped_ways = 0
    for way in ways:
        tags = way["tags"]
        base = HIGHWAY_KIND.get(tags.get("highway"))
        if base is None:
            continue
        if not keep_way(tags):
            dropped_ways += 1
            continue
        refs = way["nodes"]
        for a, b in zip(refs, refs[1:]):
            if a == b or a not in coord or b not in coord or not inside_bbox(a) or not inside_bbox(b):
                continue
            kind = base
            if base in ("path", "street"):
                mid_lat = (coord[a][0] + coord[b][0]) / 2e6
                mid_lon = (coord[a][1] + coord[b][1]) / 2e6
                if near_road("major", mid_lat, mid_lon):
                    kind = "roadside_major"
                elif near_road("secondary", mid_lat, mid_lon):
                    kind = "roadside_secondary"
                elif in_park(mid_lat, mid_lon):
                    kind = "park"
            key = (a, b) if a < b else (b, a)
            number = kind_number[kind]
            # the same pair on two ways: keep the higher exposure index (the conservative choice)
            if key not in edges or KIND_INDEX[number] > KIND_INDEX[edges[key]]:
                edges[key] = number

    # largest connected component (iterative depth-first search)
    adjacency = {}
    for (a, b) in edges:
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)
    seen = set()
    best = []
    for start in adjacency:
        if start in seen:
            continue
        component = [start]
        seen.add(start)
        stack = [start]
        while stack:
            u = stack.pop()
            for v in adjacency[u]:
                if v not in seen:
                    seen.add(v)
                    component.append(v)
                    stack.append(v)
        if len(component) > len(best):
            best = component
    keep = set(best)

    # number the nodes south-to-north so nearby nodes have nearby ids
    nodes = sorted(keep, key=lambda n: (coord[n][0], coord[n][1]))
    index = {n: i for i, n in enumerate(nodes)}
    neighbours = [[] for _ in nodes]
    for (a, b), number in edges.items():
        if a in keep:
            neighbours[index[a]].append((index[b], number))
            neighbours[index[b]].append((index[a], number))

    lat = [coord[n][0] for n in nodes]
    lon = [coord[n][1] for n in nodes]
    offsets = [0]
    targets = []
    length_dm = []
    kind = []
    for u, nbrs in enumerate(neighbours):
        for v, number in sorted(nbrs):
            d = haversine_m(lat[u] / 1e6, lon[u] / 1e6, lat[v] / 1e6, lon[v] / 1e6)
            dm = math.ceil(d * 10)
            if dm / 10 < d:
                dm += 1
            targets.append(v)
            length_dm.append(dm)
            kind.append(number)
        offsets.append(len(targets))

    assert H_FACTOR == min(KIND_INDEX), "H_FACTOR must equal the smallest exposure index"
    counts = {k: 0 for k in KIND_IDS}
    total_dm = 0
    for k, dm in zip(kind, length_dm):
        counts[KIND_IDS[k]] += dm
        total_dm += dm
    graph = {
        "city": city,
        "bbox": bbox,
        "source": "OpenStreetMap contributors (ODbL), via Overpass API",
        "built_at": time.strftime("%Y-%m-%d"),
        "osm_timestamp": ways_json.get("osm3s", {}).get("timestamp_osm_base"),
        "kinds": KINDS,
        "h_factor": H_FACTOR,
        "nodes": len(nodes),
        "edges": len(targets) // 2,
        "lat": lat, "lon": lon, "offsets": offsets, "targets": targets,
        "length_dm": length_dm, "kind": kind,
    }
    path = os.path.join(ROOT, "data", f"graph_{city}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(graph, f, separators=(",", ":"))
    size = os.path.getsize(path) / 1e6
    print(f"  ways {len(ways)} (dropped {dropped_ways}), parks {len(parks)}, "
          f"components -> largest {len(nodes)} nodes, {len(targets) // 2} edges, {size:.2f} MB")
    print("  length share by kind: " + ", ".join(
        f"{k} {100 * v / total_dm:.1f}%" for k, v in counts.items() if v))


def main():
    cities = sys.argv[1:] or list(BBOXES)
    for city in cities:
        build(city)


if __name__ == "__main__":
    main()
