"""A* search on a street graph stored as CSR arrays (SPEC 4.5).

The graph is undirected and stored in "compressed sparse row" form:
the neighbours of node n are targets[offsets[n] : offsets[n + 1]], and edge k
(from n to targets[k]) costs edge_cost[k].

The same function runs both searches:
  shortest: cost(e) = length,          h(n) = haversine(n, goal)
  cleanest: cost(e) = length * index,  h(n) = haversine(n, goal) * H_FACTOR
and, with heuristic=None (h = 0), it is Dijkstra / uniform-cost search.
"""

import heapq
import math

EARTH_RADIUS_M = 6371008.8  # mean Earth radius, used for edge lengths and for the heuristic


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres:
    d = 2 R asin( sqrt( sin^2(dlat/2) + cos(lat1) cos(lat2) sin^2(dlon/2) ) ).
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def make_heuristic(lat, lon, goal, factor=1.0):
    """h(n) = haversine(n, goal) * factor. factor = 1 for the shortest route, H_FACTOR for the cleanest.

    It never overestimates: every edge costs at least factor * (its straight-line length).
    """
    goal_lat = lat[goal]
    goal_lon = lon[goal]

    def heuristic(node):
        return haversine_m(lat[node], lon[node], goal_lat, goal_lon) * factor

    return heuristic


def astar(offsets, targets, edge_cost, start, goal, heuristic=None):
    """A* search: always expand the open node with the smallest f(n) = g(n) + h(n).

    g(n) = cost of the best path found so far from start to n.
    With an admissible and consistent h, the first time the goal is expanded its g is optimal.
    heuristic=None means h(n) = 0 (Dijkstra).
    Returns {"path": [nodes], "cost": g(goal), "expanded": number of expanded nodes,
             "order": nodes in expansion order}; path is None if the goal is unreachable.
    """
    n_nodes = len(offsets) - 1
    g = [math.inf] * n_nodes
    parent = [-1] * n_nodes
    closed = [False] * n_nodes
    order = []

    g[start] = 0.0
    h_start = heuristic(start) if heuristic else 0.0
    open_heap = [(h_start, start)]

    while open_heap:
        f, node = heapq.heappop(open_heap)
        if closed[node]:
            continue  # an older, worse entry for a node we already expanded
        closed[node] = True
        order.append(node)
        if node == goal:
            break
        for k in range(offsets[node], offsets[node + 1]):
            neighbour = targets[k]
            if closed[neighbour]:
                continue
            new_g = g[node] + edge_cost[k]
            if new_g < g[neighbour]:
                g[neighbour] = new_g
                parent[neighbour] = node
                h = heuristic(neighbour) if heuristic else 0.0
                heapq.heappush(open_heap, (new_g + h, neighbour))

    if not closed[goal]:
        return {"path": None, "cost": math.inf, "expanded": len(order), "order": order}

    path = [goal]
    while path[-1] != start:
        path.append(parent[path[-1]])
    path.reverse()
    return {"path": path, "cost": g[goal], "expanded": len(order), "order": order}
