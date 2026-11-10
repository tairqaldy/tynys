"""Save real responses of the service functions to fixtures/ for the frontend.

    python scripts/save_fixtures.py [--offline]

Everything is produced by tynys.service exactly as the API would return it.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tynys import data, service  # noqa: E402

OUT = os.path.join(ROOT, "fixtures")

ROUTES = {  # one realistic trip per city between two bundled places
    "astana": ("khan-shatyr", "ak-orda"),
    "almaty": ("republic-square", "green-bazaar"),
}
SEARCHES = {"astana": "khan shatyr", "almaty": "арбат"}


def save(name, payload):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"  {name}: {os.path.getsize(path) / 1000:.0f} kB")


def main():
    if "--offline" in sys.argv:
        data.FORCE_SNAPSHOT = True
    os.makedirs(OUT, exist_ok=True)
    save("meta.json", service.meta())
    for city in ("astana", "almaty"):
        save(f"air_{city}.json", service.air(city))
        for activity in ("walk", "run", "kids", "errand"):
            save(f"plan_{city}_{activity}.json", service.plan(city, activity))
        places = {p["id"]: p for p in service.load_places(city)}
        a, b = (places[i] for i in ROUTES[city])
        save(f"route_{city}.json", service.route(city, f"{a['lat']},{a['lon']}", f"{b['lat']},{b['lon']}", "walk"))
        save(f"places_{city}.json", service.places(city, SEARCHES[city]))
    status, payload, _ = service.handle("route", {"city": "astana", "from": "51.20,71.43", "to": "51.1283,71.4305"})
    save("error_route_outside_area.json", {"status": status, "body": payload})
    status, payload, _ = service.handle("plan", {"city": "astana", "activity": "swim"})
    save("error_unknown_activity.json", {"status": status, "body": payload})


if __name__ == "__main__":
    main()
