"""Plain functions behind the HTTP API (SPEC 6): meta(), air(), plan(), route(), places().

Each returns a JSON-ready dict or raises ApiError. The dev server, the Vercel functions,
the tests and the console demo all call these same functions.
"""

import json
import os
import urllib.parse
import urllib.request

from tynys import astar, data, hmm, mdp
from tynys.classes import (ACTIVITIES, ACTIVITY_BY_ID, ASSUMPTIONS, CITIES, CITY_BY_ID, CLASSES, DEFAULTS,
                           H_FACTOR, HARM, KIND_IDS, KIND_INDEX, KINDS, LIMITS, MAX_SNAP_M, MAX_TRIP_M,
                           RUN_M_PER_MIN, TIMEZONE, USER_AGENT, VENTILATION_RUN, VENTILATION_WALK,
                           WALK_M_PER_MIN, band, block_of_hour)
from tynys.graph import load_graph

DATA_DIR = data.DATA_DIR
PHOTON_URL = "https://photon.komoot.io/api/"
EXPLORED_MAX_POINTS = 1500


class ApiError(Exception):
    """An error with an HTTP status and a machine-readable code."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def payload(self):
        return {"error": {"code": self.code, "message": self.message}}


# ---------------------------------------------------------------- rounding helpers

def r4(values):
    return [round(v, 4) for v in values]


def r4m(matrix):
    return [r4(row) for row in matrix]


def check_city(city):
    if city not in CITY_BY_ID:
        raise ApiError(400, "unknown_city", f"Unknown city '{city}'. Use one of: "
                       + ", ".join(c["id"] for c in CITIES) + ".")
    return city


def load_places(city):
    with open(os.path.join(DATA_DIR, f"places_{city}.json"), encoding="utf-8") as f:
        return json.load(f)["places"]


# ---------------------------------------------------------------- meta

def meta():
    cities = []
    for c in CITIES:
        g = load_graph(c["id"])
        cities.append({
            "id": c["id"], "name": c["name"], "center": c["center"], "bbox": g.bbox,
            "graph": {"nodes": g.n_nodes, "edges": g.n_edges, "osm_timestamp": g.osm_timestamp},
            "places": [{"id": p["id"], "name": p["name"], "lat": p["lat"], "lon": p["lon"]}
                       for p in load_places(c["id"])],
        })
    return {
        "cities": cities,
        "timezone": TIMEZONE,
        "classes": CLASSES,
        "activities": ACTIVITIES,
        "defaults": dict(DEFAULTS),
        "limits": {k: list(v) for k, v in LIMITS.items()},
        "kinds": KINDS,
        "h_factor": H_FACTOR,
        "assumptions": ASSUMPTIONS,
    }


# ---------------------------------------------------------------- the HMM part (shared by air, plan, route)

def air_model(city, reliability=DEFAULTS["reliability"], offline=None):
    """Fetch (or load) the readings and run the whole HMM pipeline of SPEC 4.2-4.3."""
    check_city(city)
    bundle = data.get_air_bundle(city, offline)
    series = data.split_series(bundle)
    history = series["history"]
    forecast = series["forecast"][:48]
    if len(history) < 48 or len(forecast) < 12:
        raise ApiError(502, "not_enough_data", "The air-quality model returned too few hours.")

    times = [row[0] for row in history]
    hours = [int(t[11:13]) for t in times]
    bands = [None if row[1] is None else band(row[1]) for row in history]
    model = hmm.fit(bands, hours)
    prior = model["prior"]
    matrices = model["transitions"]
    rep = hmm.representative_pm25([row[1] for row in history if row[1] is not None])
    emission = hmm.emission_matrix(reliability)

    # agreement: filter the whole history, compare the most likely class with the reading's band
    all_beliefs = hmm.forward(bands, prior, hmm.transitions_for_hours(matrices, hours[:-1]), emission)
    agree = 0
    counted = 0
    for belief, b in zip(all_beliefs, bands):
        if b is not None:
            counted += 1
            agree += hmm.argmax(belief) == b
    agreement = agree / counted

    # filtering and decoding over the last 24 model readings
    obs24 = bands[-24:]
    hours24 = hours[-24:]
    trans24 = hmm.transitions_for_hours(matrices, hours24[:-1])
    beliefs24 = hmm.forward(obs24, prior, trans24, emission)
    path24 = hmm.viterbi(obs24, prior, trans24, emission)
    belief_now = beliefs24[-1]
    predicted_last = hmm.predict_step(beliefs24[-2], trans24[-1])
    if obs24[-1] is None:
        bayes = None
    else:
        bayes = hmm.bayes_update(predicted_last, emission, obs24[-1])
        bayes["time"] = times[-1]
        bayes["obs"] = obs24[-1]

    # prediction for the next hours with the forecast as a weaker reading
    forecast_bands = [band(row[1]) for row in forecast]
    hours_before = [hours[-1]] + [int(row[0][11:13]) for row in forecast[:-1]]
    ahead = hmm.predict_ahead(belief_now, hmm.transitions_for_hours(matrices, hours_before), forecast_bands)
    for k, item in enumerate(ahead):
        item["time"] = forecast[k][0]
        item["expected_pm25"] = hmm.expected_pm25(item["belief"], rep)

    return {
        "city": city, "bundle": bundle, "now": series["now"], "history": history, "forecast": forecast,
        "hours": hours, "bands": bands, "model": model, "rep": rep, "emission": emission,
        "reliability": reliability, "agreement": agreement, "times24": times[-24:], "obs24": obs24,
        "beliefs24": beliefs24, "path24": path24, "belief_now": belief_now, "bayes": bayes,
        "forecast_bands": forecast_bands, "predicted": ahead,
    }


def source_fields(bundle):
    out = {"source": bundle["source"]}
    if bundle["source"] == "snapshot":
        out["snapshot_taken"] = bundle["fetched_at"]
    return out


def reading(row):
    return {"time": row[0], "pm25": None if row[1] is None else round(row[1], 1),
            "band": None if row[1] is None else band(row[1])}


# ---------------------------------------------------------------- air

def air(city, reliability=DEFAULTS["reliability"], offline=None):
    m = air_model(city, reliability, offline)
    model = m["model"]
    last = m["history"][-1]
    bayes = m["bayes"]
    result = {
        "city": city, "timezone": TIMEZONE, "now": m["now"], **source_fields(m["bundle"]),
        "current": {"pm25": round(last[1], 1), "pm10": None if last[2] is None else round(last[2], 1),
                    "band": band(last[1])},
        "readings": [reading(row) for row in m["history"][-48:]],
        "forecast": [reading(row) for row in m["forecast"][:48]],
        "hmm": {
            "history_hours": len(m["history"]),
            "reliability": reliability,
            "agreement": round(m["agreement"], 4),
            "prior": r4(model["prior"]),
            "rep_pm25": [round(x, 2) for x in m["rep"]],
            "emission": r4m(m["emission"]),
            "transitions": {b: r4m(model["transitions"][b]) for b in model["transitions"]},
            "transition_counts": model["counts"],
            "backed_off": model["backed_off"],
            "filtered": [{"time": m["times24"][t], "obs": m["obs24"][t], "belief": r4(m["beliefs24"][t]),
                          "viterbi": m["path24"][t]} for t in range(len(m["obs24"]))],
            "belief_now": r4(m["belief_now"]),
            "state_now": hmm.argmax(m["belief_now"]),
            "bayes_step": None if bayes is None else {
                "time": bayes["time"], "obs": bayes["obs"], "predicted": r4(bayes["predicted"]),
                "likelihood": r4(bayes["likelihood"]), "unnormalised": r4(bayes["unnormalised"]),
                "evidence": round(bayes["evidence"], 4), "posterior": r4(bayes["posterior"])},
            "predicted": [{"time": p["time"], "lead_h": p["lead_h"], "forecast_band": p["forecast_band"],
                           "forecast_reliability": round(p["forecast_reliability"], 4),
                           "belief": r4(p["belief"]), "expected_pm25": round(p["expected_pm25"], 2)}
                          for p in m["predicted"]],
        },
        "weather": data.current_weather(m["bundle"]),
    }
    return result


# ---------------------------------------------------------------- plan

def plan(city, activity="walk", duration=None, deadline=DEFAULTS["deadline_hours"],
         wait_cost=DEFAULTS["wait_cost"], sensitive=False, reliability=DEFAULTS["reliability"], offline=None):
    check_city(city)
    if activity not in ACTIVITY_BY_ID:
        raise ApiError(400, "unknown_activity", f"Unknown activity '{activity}'. Use one of: "
                       + ", ".join(ACTIVITY_BY_ID) + ".")
    act = ACTIVITY_BY_ID[activity]
    if duration is None:
        duration = act["duration_min"]
    sensitivity = 2 if (sensitive or activity == "kids") else 1
    m = air_model(city, reliability, offline)
    horizon = min(int(deadline), len(m["forecast"]))

    rewards = mdp.reward_go(act["benefit"], HARM, duration, act["intensity"], sensitivity)
    hour_now = int(m["now"][11:13])
    hour_of = [hour_now] + [int(row[0][11:13]) for row in m["forecast"]]
    time_of = [m["now"]] + [row[0] for row in m["forecast"]]
    transitions = []
    for t in range(horizon):
        a = m["model"]["transitions"][block_of_hour(hour_of[t])]
        transitions.append(mdp.waiting_transition(a, hmm.forecast_reliability(t + 1), m["forecast_bands"][t]))

    stages = mdp.backward_induction(rewards, transitions, wait_cost, act["must"])
    belief = m["belief_now"]
    action, q_go, q_wait, q_skip = mdp.qmdp_decision(belief, stages[0])
    p_go, p_skip = mdp.go_probabilities(belief, action, stages, transitions)
    best_t = mdp.median_go_hour(p_go)
    state_now = hmm.argmax(belief)

    hours = []
    cumulative = 0.0
    for t in range(horizon + 1):
        cumulative += p_go[t]
        if t == 0:
            f_band = m["bands"][-1]
            expected = hmm.expected_pm25(belief, m["rep"])
        else:
            f_band = m["forecast_bands"][t - 1]
            expected = m["predicted"][t - 1]["expected_pm25"]
        st = stages[t]
        hours.append({
            "t": t, "time": time_of[t], "forecast_band": f_band, "expected_pm25": round(expected, 2),
            "transition": r4m(transitions[t]) if t < horizon else None,
            "q_go": r4(st["q_go"]), "q_wait": None if st["q_wait"] is None else r4(st["q_wait"]),
            "value": r4(st["value"]), "policy": st["policy"],
            "p_go": round(p_go[t], 4), "p_go_cumulative": round(cumulative, 4),
        })

    row = transitions[0][state_now]
    next_values = stages[1]["value"]
    expected_next = sum(row[s] * next_values[s] for s in range(len(row)))
    return {
        "city": city, "timezone": TIMEZONE, "now": m["now"], **source_fields(m["bundle"]),
        "inputs": {"activity": activity, "duration_min": duration, "deadline_hours": horizon,
                   "wait_cost": wait_cost, "sensitive": bool(sensitive), "must": act["must"],
                   "intensity": act["intensity"], "benefit": act["benefit"], "sensitivity": sensitivity,
                   "harm": HARM, "reliability": reliability},
        "reward_go": r4(rewards),
        "belief_now": r4(belief), "state_now": state_now,
        "hours": hours,
        "p_skip": round(p_skip, 4),
        "decision": {
            "action": action, "q_go": round(q_go, 4), "q_wait": None if q_wait is None else round(q_wait, 4),
            "q_skip": q_skip, "best_t": best_t, "best_time": None if best_t is None else time_of[best_t],
            "bellman": {"state": state_now, "wait_cost": wait_cost, "transition_row": r4(row),
                        "next_values": r4(next_values), "expected_next": round(expected_next, 4),
                        "q_wait": round(stages[0]["q_wait"][state_now], 4),
                        "q_go": round(stages[0]["q_go"][state_now], 4)},
        },
    }


# ---------------------------------------------------------------- route

def parse_point(text, name):
    try:
        lat_text, lon_text = text.split(",")
        lat, lon = float(lat_text), float(lon_text)
    except (AttributeError, ValueError):
        raise ApiError(400, "bad_point", f"'{name}' must be 'lat,lon', for example 51.1283,71.4305.")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ApiError(400, "bad_point", f"'{name}' is not a valid coordinate.")
    return lat, lon


def summarise_route(g, path, costs, pm25, ventilation, speed):
    """Distance, weighted cost, kind shares and the relative exposure score of one path."""
    distance = 0.0
    weighted = 0.0
    by_kind = {}
    for u, v in zip(path, path[1:]):
        k = g.edge_between(u, v, costs)
        length = g.length_m[k]
        distance += length
        weighted += length * KIND_INDEX[g.kind[k]]
        kind_id = KIND_IDS[g.kind[k]]
        by_kind[kind_id] = by_kind.get(kind_id, 0.0) + length
    mean_index = weighted / distance if distance > 0 else 1.0
    minutes = distance / speed
    exposure = pm25 * mean_index * ventilation * (minutes / 60)
    return {
        "coords": [[round(g.lat[n], 6), round(g.lon[n], 6)] for n in path],
        "distance_m": round(distance),
        "minutes": round(minutes, 1),
        "weighted_cost": round(weighted),
        "mean_index": round(mean_index, 3),
        "exposure_score": round(exposure, 2),
        "by_kind": {k: round(v / distance, 4) for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1])}
        if distance > 0 else {},
        "_weighted": weighted, "_distance": distance, "_minutes": minutes,
    }


def snap(g, lat, lon, name):
    if not g.in_bbox(lat, lon):
        s, w, n, e = g.bbox
        raise ApiError(400, "outside_area", f"The {name} point is outside the mapped area "
                       f"(lat {s}..{n}, lon {w}..{e}).")
    node, dist = g.nearest_node(lat, lon)
    if dist > MAX_SNAP_M:
        raise ApiError(400, "far_from_streets", f"The {name} point is {round(dist)} m from the nearest "
                       f"walkable street; the limit is {MAX_SNAP_M} m.")
    return node, dist


def route(city, from_point, to_point, activity="walk", at=None, reliability=DEFAULTS["reliability"],
          offline=None):
    check_city(city)
    if activity not in ACTIVITY_BY_ID:
        raise ApiError(400, "unknown_activity", f"Unknown activity '{activity}'.")
    from_lat, from_lon = parse_point(from_point, "from")
    to_lat, to_lon = parse_point(to_point, "to")
    straight = astar.haversine_m(from_lat, from_lon, to_lat, to_lon)
    if straight > MAX_TRIP_M:
        raise ApiError(400, "too_far", f"The two points are {straight / 1000:.1f} km apart; "
                       f"the limit is {MAX_TRIP_M // 1000} km in a straight line.")
    g = load_graph(city)
    start, start_d = snap(g, from_lat, from_lon, "start")
    goal, goal_d = snap(g, to_lat, to_lon, "destination")
    if start == goal:
        raise ApiError(400, "same_point", "Start and destination snap to the same street point.")

    # PM2.5 expected at the chosen hour (from the HMM belief), for the exposure score
    m = air_model(city, reliability, offline)
    now = m["now"]
    if at is None or at == "":
        at_hour = now
    else:
        if len(at) < 13 or at[10] != "T":
            raise ApiError(400, "bad_time", "'at' must look like 2026-11-10T15:00.")
        at_hour = at[:13] + ":00"
    allowed = [now] + [p["time"] for p in m["predicted"][:48]]
    if at_hour not in allowed:
        raise ApiError(400, "bad_time", f"'at' must be between {allowed[0]} and {allowed[-1]} (local time).")
    lead = allowed.index(at_hour)
    if lead == 0:
        pm25 = hmm.expected_pm25(m["belief_now"], m["rep"])
    else:
        pm25 = m["predicted"][lead - 1]["expected_pm25"]

    running = activity == "run"
    ventilation = VENTILATION_RUN if running else VENTILATION_WALK
    speed = RUN_M_PER_MIN if running else WALK_M_PER_MIN

    results = {}
    for name, costs, factor in (("shortest", g.cost_shortest, 1.0), ("cleanest", g.cost_cleanest, H_FACTOR)):
        heuristic = astar.make_heuristic(g.lat, g.lon, goal, factor)
        found = astar.astar(g.offsets, g.targets, costs, start, goal, heuristic)
        dijkstra = astar.astar(g.offsets, g.targets, costs, start, goal, None)
        if found["path"] is None:
            raise ApiError(404, "no_route", "No walkable route connects these points.")
        summary = summarise_route(g, found["path"], costs, pm25, ventilation, speed)
        summary["expanded"] = found["expanded"]
        summary["expanded_dijkstra"] = dijkstra["expanded"]
        summary["cost"] = round(found["cost"], 1)
        summary["dijkstra_agrees"] = abs(found["cost"] - dijkstra["cost"]) <= 1e-6 * max(1.0, dijkstra["cost"])
        if name == "cleanest":
            order = found["order"]
            step = max(1, -(-len(order) // EXPLORED_MAX_POINTS))  # ceil division
            summary["explored"] = [[round(g.lat[n], 5), round(g.lon[n], 5)] for n in order[::step]]
        summary["_path"] = found["path"]
        results[name] = summary

    sh, cl = results["shortest"], results["cleanest"]
    comparison = {
        "extra_distance_pct": round(100 * (cl["_distance"] / sh["_distance"] - 1), 1),
        "extra_minutes": round(cl["_minutes"] - sh["_minutes"], 1),
        "exposure_reduction_pct": round(100 * (1 - cl["_weighted"] / sh["_weighted"]), 1),
        "same_route": sh["_path"] == cl["_path"],
    }
    for summary in results.values():
        for key in [k for k in summary if k.startswith("_")]:
            del summary[key]

    return {
        "city": city, "timezone": TIMEZONE, **source_fields(m["bundle"]),
        "from": {"lat": from_lat, "lon": from_lon, "snapped": [round(g.lat[start], 6), round(g.lon[start], 6)],
                 "snap_m": round(start_d)},
        "to": {"lat": to_lat, "lon": to_lon, "snapped": [round(g.lat[goal], 6), round(g.lon[goal], 6)],
               "snap_m": round(goal_d)},
        "at": at_hour, "pm25_at": round(pm25, 2), "ventilation_m3h": ventilation, "h_factor": H_FACTOR,
        "shortest": sh, "cleanest": cl, "comparison": comparison,
    }


# ---------------------------------------------------------------- places

def photon_search(q, bbox, limit=12):
    south, west, north, east = bbox
    params = {"q": q, "limit": limit, "bbox": f"{west},{south},{east},{north}"}
    url = PHOTON_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=data.FETCH_TIMEOUT_S) as response:
        return json.loads(response.read().decode("utf-8"))


def describe(props):
    street = props.get("street")
    if street and props.get("housenumber"):
        street = f"{street} {props['housenumber']}"
    parts = [street or props.get("district") or props.get("locality"), props.get("city")]
    return ", ".join(p for p in parts if p) or (props.get("osm_value") or "").replace("_", " ")


def places(city, q="", offline=None):
    check_city(city)
    g = load_graph(city)
    q = (q or "").strip()
    local = load_places(city)
    if offline is None:
        offline = data.FORCE_SNAPSHOT
    if not q:
        return {"source": "local", "results": [
            {"name": p["name"], "detail": p["geocoder_name"], "lat": p["lat"], "lon": p["lon"]} for p in local][:6]}
    if len(q) > 100:
        raise ApiError(400, "bad_query", "The search text is too long.")
    if not offline:
        try:
            found = photon_search(q, g.bbox)
            results = []
            for feature in found.get("features", []):
                lon, lat = feature["geometry"]["coordinates"]
                if not g.in_bbox(lat, lon):
                    continue
                props = feature["properties"]
                name = props.get("name") or props.get("street")
                if not name:
                    continue
                results.append({"name": name, "detail": describe(props), "lat": round(lat, 6),
                                "lon": round(lon, 6)})
                if len(results) == 6:
                    break
            return {"source": "photon", "results": results}
        except Exception:
            pass
    words = q.lower().split()
    matches = [p for p in local
               if all(w in (p["name"] + " " + p["geocoder_name"]).lower() for w in words)]
    return {"source": "local", "results": [
        {"name": p["name"], "detail": p["geocoder_name"], "lat": p["lat"], "lon": p["lon"]} for p in matches][:6]}


# ---------------------------------------------------------------- query-string dispatch (used by api/ and devserver)

CACHE_LONG = "public, s-maxage=86400, stale-while-revalidate=3600"
CACHE_SHORT = "public, s-maxage=900, stale-while-revalidate=3600"


def _float(params, name, default, low=None, high=None):
    text = params.get(name)
    if text is None or text == "":
        return default
    try:
        value = float(text)
    except ValueError:
        raise ApiError(400, "bad_parameter", f"'{name}' must be a number.")
    if value != value or (low is not None and value < low) or (high is not None and value > high):
        raise ApiError(400, "bad_parameter", f"'{name}' must be between {low} and {high}.")
    return value


def _int(params, name, default, low, high):
    value = _float(params, name, default, low, high)
    if value is None:
        return None
    if value != int(value):
        raise ApiError(400, "bad_parameter", f"'{name}' must be a whole number.")
    return int(value)


def handle(endpoint, params):
    """Run one endpoint for a dict of query parameters. Returns (status, payload, cache_control)."""
    try:
        if endpoint == "meta":
            return 200, meta(), CACHE_LONG
        city = params.get("city", "astana")
        reliability = _float(params, "reliability", DEFAULTS["reliability"], *LIMITS["reliability"])
        if endpoint == "air":
            return 200, air(city, reliability), CACHE_SHORT
        if endpoint == "plan":
            activity = params.get("activity", "walk")
            return 200, plan(
                city, activity,
                duration=_int(params, "duration", None, *LIMITS["duration_min"]),
                deadline=_int(params, "deadline", DEFAULTS["deadline_hours"], *LIMITS["deadline_hours"]),
                wait_cost=_float(params, "wait_cost", DEFAULTS["wait_cost"], *LIMITS["wait_cost"]),
                sensitive=params.get("sensitive", "0") in ("1", "true", "yes"),
                reliability=reliability), CACHE_SHORT
        if endpoint == "route":
            if not params.get("from") or not params.get("to"):
                raise ApiError(400, "missing_parameter", "'from' and 'to' are required (lat,lon).")
            return 200, route(city, params["from"], params["to"], params.get("activity", "walk"),
                              params.get("at"), reliability), CACHE_SHORT
        if endpoint == "places":
            return 200, places(city, params.get("q", "")), CACHE_LONG
        raise ApiError(404, "not_found", f"Unknown endpoint '{endpoint}'.")
    except ApiError as error:
        return error.status, error.payload(), "no-store"
    except Exception as error:  # never leak a traceback to the client
        return 500, {"error": {"code": "internal", "message": f"Internal error: {type(error).__name__}"}}, "no-store"
