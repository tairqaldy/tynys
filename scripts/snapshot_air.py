"""Save real Open-Meteo responses for both cities as the offline fallback.

    python scripts/snapshot_air.py            -> data/air_snapshot_astana.json, data/air_snapshot_almaty.json

Each file holds the raw air-quality response (CAMS model, 92 days back + 3 days forecast),
the raw current-weather response and the local time of the fetch.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tynys import data  # noqa: E402
from tynys.classes import CITIES  # noqa: E402


def main():
    for city in CITIES:
        bundle = data.fetch_live(city["id"])
        snap = {"city": city["id"], "fetched_at": bundle["fetched_at"],
                "note": "Raw Open-Meteo responses (CAMS model output, not sensor measurements).",
                "air_url": data.air_url(city["id"]), "weather_url": data.weather_url(city["id"]),
                "air": bundle["air"], "weather": bundle["weather"]}
        with open(data.snapshot_path(city["id"]), "w", encoding="utf-8") as f:
            json.dump(snap, f, separators=(",", ":"))
        series = data.split_series({**bundle, "source": "snapshot"})
        print(f"{city['id']}: fetched {bundle['fetched_at']}, {len(series['history'])} history hours, "
              f"{len(series['forecast'])} forecast hours, weather {'ok' if bundle['weather'] else 'missing'}")


if __name__ == "__main__":
    main()
