"""Service functions return the shapes of SPEC 6 for both cities, offline (bundled snapshots)."""

import json
import re
import unittest

from tynys import data, service

CITIES = ("astana", "almaty")
TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:00$")
_saved_flag = None


def setUpModule():
    global _saved_flag
    _saved_flag = data.FORCE_SNAPSHOT
    data.FORCE_SNAPSHOT = True


def tearDownModule():
    data.FORCE_SNAPSHOT = _saved_flag


class Base(unittest.TestCase):
    def prob(self, p):
        self.assertEqual(len(p), 4)
        self.assertAlmostEqual(sum(p), 1.0, delta=5e-4)
        for x in p:
            self.assertGreaterEqual(x, 0)

    def time(self, t):
        self.assertRegex(t, TIME)


class Meta(Base):
    def test_meta(self):
        m = service.meta()
        self.assertEqual([c["id"] for c in m["cities"]], list(CITIES))
        for c in m["cities"]:
            s, w, n, e = c["bbox"]
            self.assertTrue(s < c["center"][0] < n or c["id"] == "almaty")
            self.assertTrue(s < n and w < e)
            self.assertGreater(c["graph"]["nodes"], 1000)
            self.assertGreater(c["graph"]["edges"], 1000)
            self.assertTrue(8 <= len(c["places"]) <= 12)
            for p in c["places"]:
                self.assertEqual(set(p), {"id", "name", "lat", "lon"})
                self.assertTrue(s <= p["lat"] <= n and w <= p["lon"] <= e)
        self.assertEqual([k["id"] for k in m["classes"]], ["low", "moderate", "elevated", "high"])
        self.assertIsNone(m["classes"][3]["max"])
        self.assertEqual([a["id"] for a in m["activities"]], ["walk", "run", "kids", "errand"])
        self.assertEqual(m["defaults"], {"reliability": 0.8, "wait_cost": 0.3, "deadline_hours": 8,
                                         "harm": [0, 1, 4, 10]})
        self.assertEqual(len(m["kinds"]), 8)
        self.assertTrue(m["assumptions"])
        json.dumps(m)


class Air(Base):
    def test_air_shape(self):
        for city in CITIES:
            a = service.air(city)
            self.assertEqual(a["source"], "snapshot")
            self.assertIn("snapshot_taken", a)
            self.assertEqual(a["timezone"], "Asia/Almaty")
            self.time(a["now"])
            self.assertEqual(set(a["current"]), {"pm25", "pm10", "band"})
            self.assertEqual(len(a["readings"]), 48)
            self.assertEqual(a["readings"][-1]["time"], a["now"])
            self.assertEqual(len(a["forecast"]), 48)
            self.assertGreater(a["forecast"][0]["time"], a["now"])
            for r in a["readings"] + a["forecast"]:
                self.time(r["time"])
                self.assertEqual(set(r), {"time", "pm25", "band"})
            h = a["hmm"]
            for key in ("history_hours", "reliability", "agreement", "prior", "rep_pm25", "emission",
                        "transitions", "transition_counts", "backed_off", "filtered", "belief_now",
                        "state_now", "bayes_step", "predicted"):
                self.assertIn(key, h)
            self.assertGreater(h["history_hours"], 2000)
            self.assertTrue(0 <= h["agreement"] <= 1)
            self.prob(h["prior"])
            for row in h["emission"]:
                self.prob(row)
            self.assertEqual(set(h["transitions"]), {"night", "morning", "day", "evening"})
            self.assertEqual(set(h["transition_counts"]), {"night", "morning", "day", "evening", "all"})
            for block in h["transitions"].values():
                for row in block:
                    self.prob(row)
            for b in h["backed_off"]:
                self.assertEqual(set(b), {"block", "row", "count"})
                self.assertLess(b["count"], 20)
            self.assertEqual(len(h["filtered"]), 24)
            for f in h["filtered"]:
                self.prob(f["belief"])
                self.assertIn(f["viterbi"], range(4))
            self.prob(h["belief_now"])
            self.assertEqual(h["state_now"], h["belief_now"].index(max(h["belief_now"])))
            step = h["bayes_step"]
            self.prob(step["posterior"])
            self.assertEqual(step["time"], a["now"])
            self.assertEqual(len(h["predicted"]), 48)
            self.assertAlmostEqual(h["predicted"][0]["forecast_reliability"], 0.745)
            for p in h["predicted"]:
                self.prob(p["belief"])
            if a["weather"] is not None:
                self.assertEqual(set(a["weather"]), {"wind_kmh", "temp_c"})
            json.dumps(a)


class Plan(Base):
    def test_plan_shape(self):
        for city in CITIES:
            for activity in ("walk", "run", "kids", "errand"):
                p = service.plan(city, activity, deadline=8)
                self.assertEqual(p["source"], "snapshot")
                inputs = p["inputs"]
                self.assertEqual(inputs["activity"], activity)
                self.assertEqual(inputs["sensitivity"], 2 if activity == "kids" else 1)
                self.assertEqual(len(p["reward_go"]), 4)
                self.prob(p["belief_now"])
                self.assertEqual(len(p["hours"]), 9)
                total = p["p_skip"]
                for h in p["hours"]:
                    self.time(h["time"])
                    total += h["p_go"]
                    self.assertEqual(len(h["policy"]), 4)
                    if activity == "errand":
                        self.assertNotIn("skip", h["policy"])
                    if h["t"] == 8:
                        self.assertIsNone(h["transition"])
                        self.assertIsNone(h["q_wait"])
                        self.assertNotIn("wait", h["policy"])
                    else:
                        for row in h["transition"]:
                            self.prob(row)
                self.assertAlmostEqual(total, 1.0, delta=1e-3)
                self.assertAlmostEqual(p["hours"][-1]["p_go_cumulative"] + p["p_skip"], 1.0, delta=1e-3)
                d = p["decision"]
                self.assertIn(d["action"], ("go", "wait", "skip"))
                if d["action"] == "wait":
                    self.assertNotEqual(d["best_t"], 0)
                if d["best_t"] is not None:
                    self.assertEqual(d["best_time"], p["hours"][d["best_t"]]["time"])
                b = d["bellman"]
                self.assertAlmostEqual(b["q_wait"], round(-b["wait_cost"] + b["expected_next"], 4), delta=2e-4)
                json.dumps(p)

    def test_plan_through_query_string(self):
        status, body, cache = service.handle("plan", {"city": "almaty", "activity": "kids", "deadline": "6",
                                                      "wait_cost": "0.5", "sensitive": "1"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["inputs"]["duration_min"], 60)
        self.assertEqual(body["inputs"]["deadline_hours"], 6)
        self.assertTrue(body["inputs"]["sensitive"])
        self.assertEqual(cache, service.CACHE_SHORT)
        for endpoint in ("meta", "air", "places"):
            status, body, _ = service.handle(endpoint, {"city": "astana"})
            self.assertEqual(status, 200, body)

    def test_plan_rejects_bad_input(self):
        status, body, _ = service.handle("plan", {"city": "astana", "activity": "swim"})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "unknown_activity")
        status, body, _ = service.handle("plan", {"city": "astana", "deadline": "40"})
        self.assertEqual(status, 400)
        status, body, _ = service.handle("air", {"city": "paris"})
        self.assertEqual(body["error"]["code"], "unknown_city")


class Route(Base):
    def test_route_shape(self):
        for city in CITIES:
            places = service.load_places(city)
            a, b = places[0], places[2]
            r = service.route(city, f"{a['lat']},{a['lon']}", f"{b['lat']},{b['lon']}", "walk")
            self.assertEqual(r["ventilation_m3h"], 1.2)
            self.time(r["at"])
            for end in ("from", "to"):
                self.assertEqual(set(r[end]), {"lat", "lon", "snapped", "snap_m"})
                self.assertLessEqual(r[end]["snap_m"], 400)
            for name in ("shortest", "cleanest"):
                s = r[name]
                for key in ("coords", "distance_m", "minutes", "weighted_cost", "mean_index", "exposure_score",
                            "by_kind", "expanded", "expanded_dijkstra"):
                    self.assertIn(key, s)
                self.assertTrue(s["dijkstra_agrees"])
                self.assertAlmostEqual(sum(s["by_kind"].values()), 1.0, delta=1e-3)
                self.assertLessEqual(s["expanded"], s["expanded_dijkstra"])
            self.assertLessEqual(len(r["cleanest"]["explored"]), 1500)
            self.assertLessEqual(r["cleanest"]["weighted_cost"], r["shortest"]["weighted_cost"])
            c = r["comparison"]
            self.assertEqual(set(c), {"extra_distance_pct", "extra_minutes", "exposure_reduction_pct", "same_route"})
            self.assertGreaterEqual(c["exposure_reduction_pct"], 0)
            json.dumps(r)

    def test_route_errors(self):
        cases = [
            ({"city": "astana", "from": "51.20,71.43", "to": "51.1283,71.4305"}, "outside_area"),
            ({"city": "astana", "from": "51.0,71.0", "to": "51.1283,71.4305"}, "too_far"),
            ({"city": "astana", "from": "abc", "to": "51.1283,71.4305"}, "bad_point"),
            ({"city": "astana", "to": "51.1283,71.4305"}, "missing_parameter"),
            ({"city": "astana", "from": "51.1283,71.4305", "to": "51.1325,71.4039", "at": "2020-01-01T10:00"},
             "bad_time"),
        ]
        for params, code in cases:
            status, body, cache = service.handle("route", params)
            self.assertEqual(status, 400, params)
            self.assertEqual(body["error"]["code"], code, params)
            self.assertEqual(cache, "no-store")

    def test_route_at_future_hour_and_run(self):
        a = service.air("almaty")
        at = a["forecast"][5]["time"]
        places = service.load_places("almaty")
        p, q = places[0], places[1]
        r = service.route("almaty", f"{p['lat']},{p['lon']}", f"{q['lat']},{q['lon']}", "run", at)
        self.assertEqual(r["at"], at)
        self.assertEqual(r["ventilation_m3h"], 3.0)
        self.assertAlmostEqual(r["pm25_at"], a["hmm"]["predicted"][5]["expected_pm25"], delta=0.01)


class Places(Base):
    def test_places_offline(self):
        for city in CITIES:
            out = service.places(city, "")
            self.assertLessEqual(len(out["results"]), 6)
            for r in out["results"]:
                self.assertEqual(set(r), {"name", "detail", "lat", "lon"})
        out = service.places("astana", "khan")
        self.assertEqual(out["results"][0]["name"], "Khan Shatyr")


if __name__ == "__main__":
    unittest.main()
