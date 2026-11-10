"""Geocode well-known places of each city with Photon and keep the ones the graph covers.

    python scripts/build_places.py [astana|almaty ...]      -> data/places_<city>.json

A place is kept only if a real Photon result matches its expected name, lies inside the graph's
bounding box and is within 400 m of a graph node. Places that fail are dropped, never guessed.
Raw Photon responses are cached under .cache/.
"""

import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tynys.classes import MAX_SNAP_M, USER_AGENT  # noqa: E402
from tynys.graph import load_graph  # noqa: E402

PHOTON = "https://photon.komoot.io/api/"
CACHE_DIR = os.path.join(ROOT, ".cache")

# Each candidate: display name, Photon queries to try in order, substrings one of which must appear in the
# result's name (lower case), and the OSM tags accepted ("key" or "key=value"), so that a bus stop or a shop
# that merely shares the name is never taken for the landmark.
def place(place_id, name, queries, expect, tags):
    return {"id": place_id, "name": name, "queries": queries, "expect": expect, "tags": tags}


CANDIDATES = {
    "astana": [
        place("baiterek", "Baiterek", ["Baiterek"], ["bayterek", "baiterek"], ["historic", "tourism", "man_made"]),
        place("khan-shatyr", "Khan Shatyr", ["Khan Shatyr Astana"], ["khan shatyr"], ["shop=mall"]),
        place("expo", "EXPO 2017 area", ["EXPO Astana"], ["expo-2017", "expo 2017"], ["place=quarter"]),
        place("alem-ai", "Alem.ai", ["Alem.ai Astana"], ["alem.ai", "alem ai"], ["office"]),
        place("nazarbayev-university", "Nazarbayev University", ["Nazarbayev University Astana"],
              ["nazarbayev university"], ["amenity=university"]),
        place("ak-orda", "Ak Orda", ["Ak Orda Astana"], ["ak orda", "akorda"], ["office", "historic", "tourism"]),
        place("hazret-sultan", "Hazret Sultan Mosque", ["Hazret Sultan Mosque Astana"],
              ["hazrat sultan", "hazret sultan"], ["amenity=place_of_worship"]),
        place("palace-of-peace", "Palace of Peace and Reconciliation", ["Palace of Peace and Reconciliation Astana"],
              ["peace and reconciliation"], ["amenity", "tourism", "building"]),
        place("astana-opera", "Astana Opera", ["Astana Opera"], ["astana opera"], ["amenity=theatre"]),
        place("mega-silk-way", "Mega Silk Way", ["Mega Silk Way Astana"], ["mega silk way"], ["shop=mall"]),
        place("presidential-park", "Presidential Park", ["Presidential Park Astana"], ["presidential park"],
              ["leisure=park"]),
        place("astana-arena", "Astana Arena", ["Astana Arena"], ["astana arena"], ["leisure=stadium"]),
    ],
    "almaty": [
        place("republic-square", "Republic Square", ["Republic Square Almaty"], ["republic square"], ["place=square"]),
        place("panfilov-park", "Panfilov Park", ["Panfilov Park", "Парк 28 панфиловцев Алматы"],
              ["panfilov", "панфилов"], ["leisure=park"]),
        place("zenkov-cathedral", "Ascension Cathedral", ["Ascension Cathedral Almaty"], ["ascension"],
              ["amenity=place_of_worship"]),
        place("green-bazaar", "Green Bazaar", ["Green Bazaar"], ["green bazar", "green bazaar"],
              ["amenity=marketplace"]),
        place("arbat", "Arbat (Zhibek Zholy)", ["Арбат Алматы"], ["арбат", "arbat"], ["highway=pedestrian"]),
        place("central-park", "Central Park", ["Central Park Almaty", "Central Park of Culture and Recreation"],
              ["central park", "culture and recreation", "орталық демалыс"], ["leisure=park"]),
        place("abay-opera", "Abai Opera and Ballet Theatre", ["Abai Opera Theatre Almaty"], ["abai", "abay"],
              ["amenity=theatre"]),
        place("dostyk-plaza", "Dostyk Plaza", ["Dostyk Plaza Almaty"], ["dostyk plaza"], ["shop=mall"]),
        place("kbtu", "Kazakh-British Technical University", ["Kazakh-British Technical University"],
              ["kazakh-british"], ["amenity=university"]),
        place("almaty-2", "Almaty-2 station", ["Almaty-2"], ["almaty-2", "almaty 2"],
              ["railway=station", "building=train_station"]),
        place("kaznu", "Al-Farabi Kazakh National University", ["Al-Farabi Kazakh National University"],
              ["al-farabi"], ["amenity=university"]),
        place("esentai-mall", "Esentai Mall", ["Esentai Mall"], ["esentai"], ["shop=mall"]),
        place("kok-tobe", "Kok-Tobe cable car (lower station)", ["Kok Tobe"],
              ["kok-tobe cable car", "kok tobe gondola"], ["aerialway=station"]),
    ],
}


def tag_ok(props, tags):
    key, value = props.get("osm_key"), props.get("osm_value")
    return any(t == key or t == f"{key}={value}" for t in tags)


def photon(query, bbox):
    """Photon search inside the bbox (Photon wants minLon,minLat,maxLon,maxLat), cached on disk."""
    south, west, north, east = bbox
    params = {"q": query, "limit": 8, "lang": "en", "bbox": f"{west},{south},{east},{north}"}
    url = PHOTON + "?" + urllib.parse.urlencode(params)
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, "photon_" + hashlib.sha1(url.encode()).hexdigest()[:12] + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    time.sleep(1.0)  # be polite: at most one request per second
    return result


def build(city):
    graph = load_graph(city)
    kept = []
    for cand in CANDIDATES[city]:
        place_id, name, expect = cand["id"], cand["name"], cand["expect"]
        chosen = None
        seen = []
        for query in cand["queries"]:
            result = photon(query, graph.bbox)
            for feature in result.get("features", []):
                props = feature["properties"]
                lon, lat = feature["geometry"]["coordinates"]
                label = (props.get("name") or "").lower()
                seen.append(f"{props.get('name')} [{props.get('osm_key')}={props.get('osm_value')}]")
                if not any(e in label for e in expect) or not tag_ok(props, cand["tags"]):
                    continue
                if not graph.in_bbox(lat, lon):
                    continue
                node, dist = graph.nearest_node(lat, lon)
                if dist > MAX_SNAP_M:
                    continue
                chosen = (props, lat, lon, dist)
                break
            if chosen:
                break
        if chosen is None:
            print(f"  DROP {place_id}: no matching result inside the bbox near the graph (got {seen})")
            continue
        props, lat, lon, dist = chosen
        kept.append({"id": place_id, "name": name, "lat": round(lat, 6), "lon": round(lon, 6),
                     "geocoder_name": props.get("name"),
                     "osm": f"{props.get('osm_type')}/{props.get('osm_id')}",
                     "osm_tag": f"{props.get('osm_key')}={props.get('osm_value')}",
                     "snap_m": round(dist)})
        print(f"  keep {place_id}: {props.get('name')!r} {props.get('osm_key')}={props.get('osm_value')} "
              f"({lat:.5f}, {lon:.5f}) {dist:.0f} m from graph")
    out = {"city": city, "source": "Photon geocoder (komoot) over OpenStreetMap data",
           "built_at": time.strftime("%Y-%m-%d"), "places": kept}
    with open(os.path.join(ROOT, "data", f"places_{city}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{city}: {len(kept)} places")


def main():
    for city in sys.argv[1:] or list(CANDIDATES):
        build(city)


if __name__ == "__main__":
    main()
