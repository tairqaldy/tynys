"""Service functions return the shapes of SPEC 6 for both cities, offline (bundled snapshots)."""

import json
import math
import re
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer

from tynys import data, hmm, mdp, service
from tynys.classes import block_of_hour
from tynys.web import ApiHandler

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
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "unknown_city")
        for endpoint in ("air", "plan", "places"):
            status, body, _ = service.handle(endpoint, {})
            self.assertEqual(status, 400)
            self.assertEqual(body["error"]["code"], "missing_parameter")


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
            ({"city": "astana", "from": "51.1283,71.4305", "to": "51.1325,71.4039", "at": "tomorrow"},
             "bad_time"),
            ({"from": "51.1283,71.4305", "to": "51.1325,71.4039"}, "missing_parameter"),
            ({"city": "paris", "from": "51.1283,71.4305", "to": "51.1325,71.4039"}, "unknown_city"),
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


def hour_of(time_text):
    return int(time_text[11:13])


def plus_hours(time_text, k):
    t = datetime.strptime(time_text, "%Y-%m-%dT%H:%M") + timedelta(hours=k)
    return t.strftime("%Y-%m-%dT%H:00")


def synthetic_bundle(now_hour=5):
    """A hand-made Open-Meteo payload whose band changes often, with "now" just before a block boundary."""
    start = datetime(2026, 8, 10, 0)
    n_hours = 95 * 24
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(n_hours)]
    pm25 = [round(2 + 30 * abs(math.sin(i * 0.37)) + (i % 7), 1) for i in range(n_hours)]
    fetched = (start + timedelta(days=92, hours=now_hour, minutes=23)).strftime("%Y-%m-%dT%H:%M")
    return {"city": "almaty", "source": "snapshot", "fetched_at": fetched,
            "air": {"hourly": {"time": times, "pm2_5": pm25, "pm10": pm25}}, "weather": None}


class TimeAlignment(Base):
    """Recompute every time-indexed quantity from the public pieces of the responses; a one-hour shift
    anywhere (wrong block, wrong forecast hour, wrong r_f) makes these comparisons fail."""

    TOL = 2e-3  # the responses are rounded to 4 decimals

    def assertVec(self, a, b, msg=None):
        self.assertEqual(len(a), len(b))
        for x, y in zip(a, b):
            self.assertAlmostEqual(x, y, delta=self.TOL, msg=msg)

    def check(self, a, plans):
        h = a["hmm"]
        A = h["transitions"]
        B = h["emission"]
        now = a["now"]

        # readings end at now, forecast[k] is now + (k+1) h, predicted[k] likewise
        self.assertEqual(a["readings"][-1]["time"], now)
        for k, f in enumerate(a["forecast"]):
            self.assertEqual(f["time"], plus_hours(now, k + 1))
        for k, p in enumerate(h["predicted"]):
            self.assertEqual(p["time"], plus_hours(now, k + 1))
            self.assertEqual(p["lead_h"], k + 1)
            self.assertEqual(p["forecast_band"], a["forecast"][k]["band"])

        # forward filter over the 24 hours, recomputed with an independent loop
        filtered = h["filtered"]
        self.assertEqual([f["time"] for f in filtered], [r["time"] for r in a["readings"][-24:]])
        self.assertEqual([f["obs"] for f in filtered], [r["band"] for r in a["readings"][-24:]])
        belief = None
        for t, f in enumerate(filtered):
            if t == 0:
                predicted = list(h["prior"])
            else:
                matrix = A[block_of_hour(hour_of(filtered[t - 1]["time"]))]  # block of the PREVIOUS hour
                predicted = [sum(matrix[i][j] * belief[i] for i in range(4)) for j in range(4)]
            unnorm = [B[s][f["obs"]] * predicted[s] for s in range(4)]
            belief = [x / sum(unnorm) for x in unnorm]
            self.assertVec(f["belief"], belief, f"filter step {t}")
        self.assertVec(h["belief_now"], belief)

        # the Bayes step is the last filter step
        step = h["bayes_step"]
        self.assertEqual(step["time"], now)
        self.assertEqual(step["posterior"], h["belief_now"])
        prev = filtered[-2]
        matrix = A[block_of_hour(hour_of(prev["time"]))]
        self.assertVec(step["predicted"], [sum(matrix[i][j] * prev["belief"][i] for i in range(4)) for j in range(4)])
        self.assertEqual(step["likelihood"], [B[s][step["obs"]] for s in range(4)])

        # prediction: belief_k from belief_(k-1), block of hour k-1, r_f(k), forecast band of hour k
        belief = h["belief_now"]
        previous_time = now
        for k, p in enumerate(h["predicted"], start=1):
            matrix = A[block_of_hour(hour_of(previous_time))]
            prior_k = [sum(matrix[i][j] * belief[i] for i in range(4)) for j in range(4)]
            r_f = max(0.5, 0.75 - 0.005 * k)
            self.assertAlmostEqual(p["forecast_reliability"], r_f)
            emission = hmm.emission_matrix(r_f)
            unnorm = [emission[s][a["forecast"][k - 1]["band"]] * prior_k[s] for s in range(4)]
            expected = [x / sum(unnorm) for x in unnorm]
            self.assertVec(p["belief"], expected, f"prediction k={k}")
            belief = p["belief"]
            previous_time = p["time"]

        # MDP: T_t from the block of hour t, r_f(t + 1) and the forecast band of hour t + 1
        for plan in plans:
            hours = plan["hours"]
            self.assertEqual(hours[0]["time"], now)
            self.assertEqual(hours[0]["band_source"], "reading")
            self.assertEqual(hours[0]["forecast_band"], a["current"]["band"])
            for t in range(len(hours) - 1):
                self.assertEqual(hours[t + 1]["time"], plus_hours(now, t + 1))
                self.assertEqual(hours[t + 1]["band_source"], "forecast")
                self.assertEqual(hours[t + 1]["forecast_band"], a["forecast"][t]["band"])
                expected = mdp.waiting_transition(A[block_of_hour(hour_of(hours[t]["time"]))],
                                                  hmm.forecast_reliability(t + 1), a["forecast"][t]["band"])
                for row, row_expected in zip(hours[t]["transition"], expected):
                    self.assertVec(row, row_expected, f"T_{t}")
                if t >= 1:
                    self.assertAlmostEqual(hours[t]["expected_pm25"], h["predicted"][t - 1]["expected_pm25"],
                                           delta=0.01)

    def test_snapshots(self):
        for city in CITIES:
            self.check(service.air(city), [service.plan(city, act, deadline=12) for act in ("walk", "errand")])

    def test_synthetic_series_at_block_boundaries(self):
        original = data.get_air_bundle
        try:
            for now_hour in (5, 11, 17, 23):
                bundle = synthetic_bundle(now_hour)
                data.get_air_bundle = lambda city, offline=None, b=bundle: b
                a = service.air("almaty")
                self.assertEqual(hour_of(a["now"]), now_hour)
                self.check(a, [service.plan("almaty", "walk", deadline=12)])
        finally:
            data.get_air_bundle = original


class SplitSeries(unittest.TestCase):
    def payload(self, values, fetched_at):
        times = [f"2026-11-10T{h:02d}:00" for h in range(len(values))]
        return {"fetched_at": fetched_at, "air": {"hourly": {"time": times, "pm2_5": values, "pm10": values}}}

    def test_now_is_the_fetch_hour(self):
        s = data.split_series(self.payload([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "2026-11-10T07:23"))
        self.assertEqual(s["now"], "2026-11-10T07:00")
        self.assertEqual(s["history"][-1][0], "2026-11-10T07:00")
        self.assertEqual([r[0][11:13] for r in s["forecast"]], ["08", "09"])

    def test_trailing_missing_hours_move_now_back(self):
        s = data.split_series(self.payload([None, 2, 3, 4, 5, 6, None, None, 9, 10], "2026-11-10T07:23"))
        self.assertEqual(s["now"], "2026-11-10T05:00")
        self.assertEqual(s["history"][0][0], "2026-11-10T01:00")  # leading None dropped
        self.assertEqual(s["history"][-1][1], 6)
        self.assertEqual(s["forecast"], [])  # 06:00 is missing, so no forecast can start at now + 1 h

    def test_forecast_stops_at_first_gap_and_middle_gaps_stay(self):
        s = data.split_series(self.payload([1, 2, None, 4, 5, 6, 7, None, 9, 10], "2026-11-10T04:05"))
        self.assertEqual(s["now"], "2026-11-10T04:00")
        self.assertEqual([r[1] for r in s["history"]], [1, 2, None, 4, 5])
        self.assertEqual([r[0][11:13] for r in s["forecast"]], ["05", "06"])

    def test_live_path_without_network(self):
        payload = self.payload([float(x) for x in range(1, 11)], "unused")["air"]  # the raw API response
        payload["utc_offset_seconds"] = 18000
        saved = (data.fetch_json, data.local_now, dict(data._cache), dict(data._failed))
        try:
            data.fetch_json = lambda url, timeout=None: (
                payload if "air-quality" in url else {"current": {"temperature_2m": -3.0, "wind_speed_10m": 9.0}})
            data.local_now = lambda offset: datetime(2026, 11, 10, 6, 41)
            data._cache.clear()
            data._failed.clear()
            bundle = data.get_air_bundle("astana", offline=False)
            self.assertEqual(bundle["source"], "live")
            self.assertEqual(bundle["fetched_at"], "2026-11-10T06:41")
            self.assertEqual(data.split_series(bundle)["now"], "2026-11-10T06:00")
            self.assertEqual(data.current_weather(bundle), {"wind_kmh": 9.0, "temp_c": -3.0})
        finally:
            data.fetch_json, data.local_now = saved[0], saved[1]
            data._cache.clear()
            data._cache.update(saved[2])
            data._failed.clear()
            data._failed.update(saved[3])


class RouteTime(Base):
    def test_past_and_far_future_at_are_clamped(self):
        a = service.air("astana")
        places = {p["id"]: p for p in service.load_places("astana")}
        p, q = places["baiterek"], places["khan-shatyr"]
        frm, to = f"{p['lat']},{p['lon']}", f"{q['lat']},{q['lon']}"
        r = service.route("astana", frm, to, "walk", plus_hours(a["now"], -3))
        self.assertEqual(r["at"], a["now"])
        self.assertTrue(r["at_clamped"])
        r = service.route("astana", frm, to, "walk", "2099-01-01T10:00")
        self.assertEqual(r["at"], a["hmm"]["predicted"][-1]["time"])
        self.assertTrue(r["at_clamped"])
        r = service.route("astana", frm, to, "walk", a["forecast"][2]["time"][:13] + ":40")
        self.assertEqual(r["at"], a["forecast"][2]["time"])
        self.assertFalse(r["at_clamped"])
        r = service.route("astana", frm, to, "walk")
        self.assertEqual(r["at"], a["now"])
        self.assertFalse(r["at_clamped"])


class QuietHandler(ApiHandler):
    def log_message(self, fmt, *args):
        pass


class Http(unittest.TestCase):
    """The real handler on an ephemeral port (not 8787)."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, method="GET"):
        req = urllib.request.Request(self.base + path, method=method)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=10) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def test_get_head_options(self):
        status, headers, body = self.request("/api/meta")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], service.CACHE_LONG)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(int(headers["Content-Length"]), len(body))
        status, head_headers, head_body = self.request("/api/meta", "HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(head_body, b"")
        self.assertEqual(head_headers["Content-Length"], headers["Content-Length"])
        self.assertEqual(head_headers["Content-Type"], "application/json; charset=utf-8")
        status, headers, body = self.request("/api/air", "OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertIn("GET", headers["Access-Control-Allow-Methods"])

    def test_errors_and_cache_headers(self):
        status, headers, body = self.request("/api/air")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "missing_parameter")
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, headers, _ = self.request("/api/plan?city=almaty")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "public, s-maxage=900, stale-while-revalidate=300")
        # offline, a search is answered from the bundled places and must not be cached for a day
        status, headers, body = self.request("/api/places?city=astana&q=khan")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["source"], "local")
        self.assertEqual(headers["Cache-Control"], "no-store")


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
