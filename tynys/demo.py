"""Console demo: Input -> Steps -> Output -> Why this algorithm, for the HMM, the MDP and A*.

    python -m tynys.demo --city almaty [--offline] [--activity walk] [--no-save]

The run is also written to docs/demo_output_<city>.txt (unless --no-save).
Every number printed comes from tynys.service, the same code the web API runs.
"""

import argparse
import io
import os
import sys

from tynys import data, service
from tynys.classes import ASSUMPTIONS, CITY_BY_ID, CLASSES, H_FACTOR, KINDS, block_of_hour

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = [c["id"] for c in CLASSES]
SHORT = ["low", "mod", "elev", "high"]
TRIPS = {"astana": ("khan-shatyr", "ak-orda"), "almaty": ("republic-square", "green-bazaar")}


def vec(p, digits=3):
    return "[" + " ".join(f"{x:.{digits}f}" for x in p) + "]"


def table(headers, rows):
    """Print a small left-aligned text table."""
    widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    line = "  ".join(str(h).ljust(w) for h, w in zip(headers, widths))
    print("    " + line)
    print("    " + "  ".join("-" * w for w in widths))
    for r in rows:
        print("    " + "  ".join(str(c).ljust(w) for c, w in zip(r, widths)))


def matrix(m, row_labels=SHORT, col_labels=SHORT, digits=3):
    table([""] + col_labels, [[row_labels[i]] + [f"{x:.{digits}f}" for x in row] for i, row in enumerate(m)])


def heading(text):
    print()
    print("=" * 78)
    print(text)
    print("=" * 78)


def sub(text):
    print()
    print(f"  {text}")


def run(city, activity):
    a = service.air(city)
    h = a["hmm"]
    print(f"Tynys console demo - {CITY_BY_ID[city]['name']}")
    src = a["source"] + (f" (taken {a['snapshot_taken']})" if a["source"] == "snapshot" else "")
    print(f"Local time {a['now']} ({a['timezone']}), data source: {src}")
    print("PM2.5 values are CAMS model readings served by Open-Meteo (~40 km grid), not sensor measurements.")

    # ------------------------------------------------------------ HMM
    heading("1. HIDDEN MARKOV MODEL - how is the air right now?")
    sub("INPUT")
    print(f"    {h['history_hours']} hourly model readings (92 days); the last 24 are filtered.")
    print(f"    Classes: low <= 5, moderate 5-15, elevated 15-25, high > 25 ug/m3 (hourly PM2.5).")
    print(f"    Reading trust r = {h['reliability']} (assumption), prior pi = {vec(h['prior'])}")
    block = block_of_hour(int(a["now"][11:13]))
    print(f"    Transition matrix A_{block} (rows: class now, columns: class next hour), add-one smoothed:")
    matrix(h["transitions"][block])
    print(f"    raw counts N_{block}:")
    table([""] + SHORT, [[SHORT[i]] + row for i, row in enumerate(h["transition_counts"][block])])
    if h["backed_off"]:
        rows = ", ".join(f"{b['block']} row {SHORT[b['row']]} ({b['count']} counts)" for b in h["backed_off"])
        print(f"    Rows with < 20 counts use the pooled all-day row instead: {rows}")
    print("    Emission B(r)[true class][reading band]:")
    matrix(h["emission"])

    sub("STEPS - forward filter, last 12 of the 24 hours (belief = P(class | readings so far))")
    table(["time", "PM2.5", "reading", "belief [low mod elev high]", "Viterbi"],
          [[f["time"][11:], next(r["pm25"] for r in a["readings"] if r["time"] == f["time"]),
            SHORT[f["obs"]], vec(f["belief"]), SHORT[f["viterbi"]]] for f in h["filtered"][-12:]])
    s = h["bayes_step"]
    print(f"\n    Bayes update for the last hour ({s['time']}, reading band {NAMES[s['obs']]}):")
    print(f"      predicted prior  A^T belief(t-1) = {vec(s['predicted'], 4)}")
    print(f"      likelihood       B[:, reading]   = {vec(s['likelihood'], 4)}")
    print(f"      unnormalised     product         = {vec(s['unnormalised'], 4)}")
    print(f"      evidence         sum             = {s['evidence']:.4f}")
    print(f"      posterior        product / sum   = {vec(s['posterior'], 4)}")

    sub("OUTPUT")
    print(f"    Model reading now: {a['current']['pm25']} ug/m3 -> band {NAMES[a['current']['band']]}")
    print(f"    belief_now = {vec(h['belief_now'], 4)}  ->  most likely class: {NAMES[h['state_now']]}")
    print(f"    Viterbi sequence (24 h): {' '.join(SHORT[f['viterbi']] for f in h['filtered'])}")
    print(f"    Filter agrees with the reading's band in {100 * h['agreement']:.1f}% of history hours "
          f"(high by design: it mostly smooths isolated jumps).")
    print("    Next 12 hours, forecast used as a weaker reading (trust r_f(k) = max(0.5, 0.75 - 0.005k)):")
    table(["time", "forecast band", "r_f", "belief [low mod elev high]", "E[PM2.5]"],
          [[p["time"][11:], SHORT[p["forecast_band"]], p["forecast_reliability"], vec(p["belief"]),
            p["expected_pm25"]] for p in h["predicted"][:12]])
    sub("WHY AN HMM")
    print("    The true class on your street is hidden and the grid value is a noisy reading of it; Bayes")
    print("    filtering combines what usually happens next (transitions) with each new reading (emission).")

    # ------------------------------------------------------------ MDP
    p = service.plan(city, activity)
    i = p["inputs"]
    heading("2. MARKOV DECISION PROCESS - when should I go out?")
    sub("INPUT")
    print(f"    Activity {i['activity']}: {i['duration_min']} min, intensity {i['intensity']}, benefit "
          f"{i['benefit']}, sensitivity {i['sensitivity']}, must = {i['must']}")
    print(f"    Deadline H = {i['deadline_hours']} h, waiting costs {i['wait_cost']} per hour, "
          f"harm per hour = {i['harm']} (assumptions)")
    print(f"    R_go(s) = benefit - harm[s] * hours * intensity * sensitivity = {vec(p['reward_go'], 2)}")
    print(f"    belief_now (from the HMM) = {vec(p['belief_now'], 4)}")
    print(f"    T_0 = P(class next hour | class now, next forecast band "
          f"{NAMES[p['hours'][1]['forecast_band']]}):")
    matrix(p["hours"][0]["transition"])

    sub("STEPS - backward induction from t = H down to t = 0")
    print("    Q_go = R_go;  Q_wait = -wait_cost + sum_s' T_t[s][s'] V_(t+1)(s');  V = max (ties: go, wait, skip)")
    rows = []
    for hr in reversed(p["hours"]):
        rows.append([hr["t"], hr["time"][11:], SHORT[hr["forecast_band"]],
                     vec(hr["q_wait"], 2) if hr["q_wait"] else "-", vec(hr["value"], 2),
                     " ".join(x[:4] for x in hr["policy"])])
    table(["t", "time", "forecast", "Q_wait [low mod elev high]", "V", "policy (low mod elev high)"], rows)
    b = p["decision"]["bellman"]
    print(f"\n    Bellman example for the most likely class now ({NAMES[b['state']]}) at t = 0:")
    print(f"      Q_wait = -{b['wait_cost']} + {vec(b['transition_row'], 3)} . {vec(b['next_values'], 2)}")
    print(f"             = -{b['wait_cost']} + {b['expected_next']:.4f} = {b['q_wait']:.4f}")
    print(f"      Q_go   = {b['q_go']:.4f}")

    sub("OUTPUT")
    d = p["decision"]
    q_skip = "not allowed" if d["q_skip"] is None else f"{d['q_skip']}"
    print(f"    Belief-weighted (QMDP): Q(go) = {d['q_go']:.4f}, Q(wait) = {d['q_wait']:.4f}, Q(skip) = {q_skip}")
    if d["action"] == "go":
        verdict = "Go now"
    elif d["action"] == "skip":
        verdict = "Skip it today"
    elif d["best_t"] is None:
        verdict = "Wait - probably not today"
    else:
        verdict = f"Wait - most likely around {d['best_time'][11:]}"
    print(f"    Decision: {d['action'].upper()}  ->  \"{verdict}\"")
    print("    Probability of going in each hour under the policy:")
    table(["t", "time", "p_go", "cumulative"],
          [[hr["t"], hr["time"][11:], f"{hr['p_go']:.3f}", f"{hr['p_go_cumulative']:.3f}"] for hr in p["hours"]])
    print(f"    p_skip = {p['p_skip']:.3f}")
    sub("WHY AN MDP")
    print("    Going now versus waiting is a sequence of decisions under uncertain future air; backward")
    print("    induction weighs the benefit now against the expected value of waiting one more hour.")

    # ------------------------------------------------------------ A*
    places = {pl["id"]: pl for pl in service.load_places(city)}
    origin, dest = (places[x] for x in TRIPS[city])
    at = d["best_time"] if d["action"] == "wait" and d["best_time"] else None
    r = service.route(city, f"{origin['lat']},{origin['lon']}", f"{dest['lat']},{dest['lon']}", activity, at)
    heading("3. A* SEARCH - which way should I walk?")
    sub("INPUT")
    print(f"    From {origin['name']} ({origin['lat']}, {origin['lon']}) to {dest['name']} "
          f"({dest['lat']}, {dest['lon']})")
    print(f"    Snapped to street nodes {r['from']['snap_m']} m and {r['to']['snap_m']} m away.")
    print(f"    Hour {r['at']} (chosen by the MDP)" if at else f"    Hour {r['at']} (now)")
    print(f"    Expected PM2.5 at that hour (HMM) = {r['pm25_at']} ug/m3, ventilation {r['ventilation_m3h']} m3/h")
    print("    Traffic exposure index per street kind (assumption):")
    table(["kind", "index"], [[k["id"], k["index"]] for k in KINDS])
    print("    shortest: cost = length,          h(n) = haversine(n, goal)")
    print(f"    cleanest: cost = length x index,  h(n) = haversine(n, goal) x {H_FACTOR}")
    print(f"    h is admissible: no edge costs less than {H_FACTOR} x its straight-line length.")

    sub("STEPS - node expansions (A* vs Dijkstra = A* with h = 0, same cost function)")
    rows = []
    for name in ("shortest", "cleanest"):
        s = r[name]
        saved = 100 * (1 - s["expanded"] / s["expanded_dijkstra"])
        rows.append([name, s["expanded"], s["expanded_dijkstra"], f"{saved:.0f}%", s["cost"],
                     "yes" if s["dijkstra_agrees"] else "NO"])
    table(["search", "A* expanded", "Dijkstra expanded", "saved", "optimal cost", "same cost"], rows)

    sub("OUTPUT")
    rows = []
    for name in ("shortest", "cleanest"):
        s = r[name]
        top = ", ".join(f"{k} {100 * v:.0f}%" for k, v in list(s["by_kind"].items())[:3])
        rows.append([name, s["distance_m"], s["minutes"], s["weighted_cost"], s["mean_index"], s["exposure_score"], top])
    table(["route", "metres", "minutes", "weighted", "mean index", "exposure (ug)", "main kinds"], rows)
    c = r["comparison"]
    if c["same_route"]:
        print("    Both searches found the same route.")
    else:
        print(f"    The cleanest route has {c['exposure_reduction_pct']}% less traffic exposure for "
              f"{c['extra_distance_pct']}% more walking ({c['extra_minutes']} extra minutes).")
    print("    The exposure score only compares the two routes; it is not a measured dose.")
    sub("WHY A*")
    print("    Route finding is a search over the street graph; an admissible, consistent heuristic lets A*")
    print("    return the same optimal route as Dijkstra while expanding far fewer nodes.")

    heading("ASSUMPTIONS")
    for text in ASSUMPTIONS:
        print(f"  - {text}")


def main():
    parser = argparse.ArgumentParser(description="Tynys console demo")
    parser.add_argument("--city", default="almaty", choices=sorted(CITY_BY_ID))
    parser.add_argument("--activity", default="walk")
    parser.add_argument("--offline", action="store_true", help="use the bundled snapshot")
    parser.add_argument("--no-save", action="store_true", help="do not write docs/demo_output_<city>.txt")
    args = parser.parse_args()
    if args.offline:
        data.FORCE_SNAPSHOT = True
    buffer = io.StringIO()
    stdout = sys.stdout
    sys.stdout = buffer
    try:
        run(args.city, args.activity)
    finally:
        sys.stdout = stdout
    text = buffer.getvalue()
    print(text, end="")
    if not args.no_save:
        path = os.path.join(ROOT, "docs", f"demo_output_{args.city}.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"$ python -m tynys.demo --city {args.city}" + (" --offline" if args.offline else "") + "\n")
            f.write(text)


if __name__ == "__main__":
    main()
