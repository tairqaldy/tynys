"""Air-quality data: live Open-Meteo fetch with a bundled snapshot as fallback.

The PM2.5 / PM10 values are output of the CAMS global atmospheric model served by
Open-Meteo ("model readings"), not sensor measurements.
"""

import json
import os
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from tynys.classes import CITY_BY_ID, TIMEZONE, USER_AGENT

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
FETCH_TIMEOUT_S = 6
CACHE_SECONDS = 600

# Set TYNYS_OFFLINE=1 (or data.FORCE_SNAPSHOT = True, as the tests do) to never touch the network.
FORCE_SNAPSHOT = os.environ.get("TYNYS_OFFLINE", "") == "1"

RETRY_AFTER_FAILURE_S = 60

_cache = {}  # city -> (monotonic time, bundle)
_failed = {}  # city -> monotonic time of the last failed live fetch (skip live for a minute after it)


def air_url(city):
    c = CITY_BY_ID[city]
    query = {"latitude": c["center"][0], "longitude": c["center"][1], "hourly": "pm2_5,pm10",
             "past_days": 92, "forecast_days": 3, "timezone": TIMEZONE}
    return AIR_URL + "?" + urllib.parse.urlencode(query)


def weather_url(city):
    c = CITY_BY_ID[city]
    query = {"latitude": c["center"][0], "longitude": c["center"][1],
             "current": "temperature_2m,wind_speed_10m", "wind_speed_unit": "kmh", "timezone": TIMEZONE}
    return WEATHER_URL + "?" + urllib.parse.urlencode(query)


def fetch_json(url, timeout=FETCH_TIMEOUT_S):
    """GET a URL and parse JSON, sending the project User-Agent."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def snapshot_path(city):
    return os.path.join(DATA_DIR, f"air_snapshot_{city}.json")


def load_snapshot(city):
    with open(snapshot_path(city), encoding="utf-8") as f:
        return json.load(f)


def local_now(utc_offset_seconds):
    """Current local time, using the UTC offset that Open-Meteo reports for the city."""
    return datetime.now(timezone.utc) + timedelta(seconds=utc_offset_seconds)


def fetch_live(city):
    """Fetch air quality and current weather in parallel. Raises on failure of the air request."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        air_future = pool.submit(fetch_json, air_url(city))
        weather_future = pool.submit(fetch_json, weather_url(city))
        air = air_future.result()
        try:
            weather = weather_future.result()
        except Exception:
            weather = None
    if "hourly" not in air:
        raise ValueError("unexpected Open-Meteo response")
    offset = air.get("utc_offset_seconds", 5 * 3600)
    now = local_now(offset)
    return {"city": city, "source": "live", "fetched_at": now.strftime("%Y-%m-%dT%H:%M"),
            "air": air, "weather": weather}


def get_air_bundle(city, offline=None):
    """Live data if possible (cached for 10 minutes), otherwise the bundled snapshot flagged "snapshot"."""
    if offline is None:
        offline = FORCE_SNAPSHOT
    if not offline:
        cached = _cache.get(city)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
        if time.monotonic() - _failed.get(city, -1e9) > RETRY_AFTER_FAILURE_S:
            try:
                bundle = fetch_live(city)
                _cache[city] = (time.monotonic(), bundle)
                return bundle
            except Exception:
                _failed[city] = time.monotonic()
    snap = load_snapshot(city)
    return {"city": city, "source": "snapshot", "fetched_at": snap["fetched_at"],
            "air": snap["air"], "weather": snap.get("weather")}


def split_series(bundle):
    """Turn the raw response into history (up to and including now) and forecast (after now).

    1. The clock hour of the fetch (minutes dropped) is the latest possible "now": the current local hour
       for live data, the hour the snapshot was taken for a snapshot.
    2. Missing values (None) at the start of the history are dropped; missing values at the END of the
       history (hours not published yet) move "now" back to the newest hour that has a value.
       Missing values in the middle stay as None so consecutive-hour counting stays correct.
    3. The forecast is the run of hours right after "now" that have values: it starts at now + 1 h and
       stops at the first missing value, so forecast[k] is always the hour now + (k + 1) h.
    Returns {"now", "history": [(time, pm25, pm10)], "forecast": [(time, pm25, pm10)]}.
    """
    latest = bundle["fetched_at"][:13] + ":00"
    hourly = bundle["air"]["hourly"]
    times = hourly["time"]
    pm25 = hourly["pm2_5"]
    pm10 = hourly.get("pm10") or [None] * len(times)
    rows = [(times[i], pm25[i], pm10[i]) for i in range(len(times))]

    history = [row for row in rows if row[0] <= latest]
    while history and history[0][1] is None:
        history.pop(0)
    while history and history[-1][1] is None:  # the newest hours may not be published yet
        history.pop()
    now = history[-1][0] if history else latest

    forecast = []
    for row in rows:
        if row[0] <= now:
            continue
        if row[1] is None:
            break
        forecast.append(row)
    return {"now": now, "history": history, "forecast": forecast}


def current_weather(bundle):
    w = bundle.get("weather")
    if not w or "current" not in w:
        return None
    cur = w["current"]
    if cur.get("wind_speed_10m") is None or cur.get("temperature_2m") is None:
        return None
    return {"wind_kmh": round(cur["wind_speed_10m"], 1), "temp_c": round(cur["temperature_2m"], 1)}
