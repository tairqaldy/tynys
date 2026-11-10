"""Evaluation of the three algorithms on real data -> docs/evaluation.md

    python -m tynys.evaluate [--live]

By default it uses the bundled Open-Meteo snapshots (data/air_snapshot_<city>.json) so the numbers
are reproducible; --live fetches fresh data first.

HMM  - 1, 3 and 6 hour-ahead class accuracy using the transition matrices only (trained on the
       first 78 days, tested on the last 14), against persistence (the class stays the same).
MDP  - backtest over the 14 test days: mean realised reward of the policy vs "always go now" vs the
       oracle best hour. Past model values stand in for the forecast.
A*   - 30 random pairs per city: node expansions vs Dijkstra, extra distance and reduction in
       weighted cost of the cleanest route.
"""

import argparse
import os
import random
import statistics
import time

from tynys import astar, data, hmm, mdp
from tynys.classes import (ACTIVITIES, CITIES, DEFAULTS, H_FACTOR, HARM, KIND_INDEX, block_of_hour, band)
from tynys.graph import load_graph

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAIN_HOURS = 78 * 24
TEST_HOURS = 14 * 24
LEADS = (1, 3, 6)
N_PAIRS = 30


def history_of(city, live):
    bundle = data.get_air_bundle(city, offline=not live)
    series = data.split_series(bundle)
    times = [row[0] for row in series["history"]]
    bands = [None if row[1] is None else band(row[1]) for row in series["history"]]
    hours = [int(t[11:13]) for t in times]
    return bundle, times, bands, hours


# ---------------------------------------------------------------- HMM

def hmm_accuracy(bands, hours):
    """k-hour-ahead accuracy: predict argmax of e_{band(t)} A_{b(t)} A_{b(t+1)} ... A_{b(t+k-1)}."""
    split = len(bands) - TEST_HOURS
    train_bands = bands[split - TRAIN_HOURS:split]
    train_hours = hours[split - TRAIN_HOURS:split]
    model = hmm.fit(train_bands, train_hours)
    matrices = model["transitions"]
    result = {}
    for k in LEADS:
        hits = 0
        persistence = 0
        total = 0
        for t in range(split, len(bands) - k):
            if bands[t] is None or bands[t + k] is None:
                continue
            p = [0.0] * 4
            p[bands[t]] = 1.0
            for step in range(k):
                p = hmm.predict_step(p, matrices[block_of_hour(hours[t + step])])
            hits += hmm.argmax(p) == bands[t + k]
            persistence += bands[t] == bands[t + k]
            total += 1
        result[k] = {"model": hits / total, "persistence": persistence / total, "n": total}
    test = [b for b in bands[split:] if b is not None]
    majority = max(range(4), key=test.count)
    result["majority_share"] = test.count(majority) / len(test)
    result["majority_class"] = majority
    result["backed_off"] = model["backed_off"]
    train = [b for b in train_bands if b is not None]
    result["train_share"] = [train.count(s) / len(train) for s in range(4)]
    result["test_share"] = [test.count(s) / len(test) for s in range(4)]
    result["train_period"] = (split - TRAIN_HOURS, split - 1)
    result["diagonal_argmax"] = all(hmm.argmax(matrices[b][i]) == i for b in matrices for i in range(4))
    return result, model


# ---------------------------------------------------------------- MDP backtest

def backtest(bands, hours, model, activity, horizon=DEFAULTS["deadline_hours"], wait_cost=DEFAULTS["wait_cost"],
             reliability=DEFAULTS["reliability"]):
    """Replay every test hour as "now": decide with the policy, then score it on what actually happened.

    The realised band at an hour stands in for the true class. Realised reward of going at hour t:
    R_go(band at t) - wait_cost * t; of skipping at hour t: -wait_cost * t.
    """
    sensitivity = 2 if activity["id"] == "kids" else 1
    rewards = mdp.reward_go(activity["benefit"], HARM, activity["duration_min"], activity["intensity"], sensitivity)
    emission = hmm.emission_matrix(reliability)
    matrices = model["transitions"]
    split = len(bands) - TEST_HOURS
    policy_total = go_now_total = oracle_total = 0.0
    waited = 0
    count = 0
    for t0 in range(split, len(bands) - horizon):
        window = bands[t0 - 23:t0 + 1]
        future = bands[t0:t0 + horizon + 1]
        if None in window or None in future:
            continue
        # belief now from the last 24 readings
        trans24 = hmm.transitions_for_hours(matrices, hours[t0 - 23:t0])
        belief = hmm.forward(window, model["prior"], trans24, emission)[-1]
        # MDP with past model values standing in for the forecast
        transitions = [mdp.waiting_transition(matrices[block_of_hour(hours[t0 + t])], hmm.forecast_reliability(t + 1),
                                              future[t + 1]) for t in range(horizon)]
        stages = mdp.backward_induction(rewards, transitions, wait_cost, activity["must"])
        action, _, _, _ = mdp.qmdp_decision(belief, stages[0])
        # follow the policy on the realised bands
        if action == "go":
            realised = rewards[future[0]]
        elif action == "skip":
            realised = 0.0
        else:
            waited += 1
            realised = None
            for t in range(1, horizon + 1):
                choice = stages[t]["policy"][future[t]]
                if choice == "go":
                    realised = rewards[future[t]] - wait_cost * t
                    break
                if choice == "skip":
                    realised = -wait_cost * t
                    break
        oracle = max(rewards[future[t]] - wait_cost * t for t in range(horizon + 1))
        if not activity["must"]:
            oracle = max(oracle, 0.0)
        policy_total += realised
        go_now_total += rewards[future[0]]
        oracle_total += oracle
        count += 1
    return {"policy": policy_total / count, "go_now": go_now_total / count, "oracle": oracle_total / count,
            "waited_share": waited / count, "n": count}


# ---------------------------------------------------------------- A*

def astar_eval(city, seed):
    g = load_graph(city)
    rng = random.Random(seed)
    pairs = []
    while len(pairs) < N_PAIRS:
        a, b = rng.randrange(g.n_nodes), rng.randrange(g.n_nodes)
        d = astar.haversine_m(g.lat[a], g.lon[a], g.lat[b], g.lon[b])
        if 1000 <= d <= 6000:
            pairs.append((a, b))
    rows = []
    for a, b in pairs:
        row = {}
        started = time.perf_counter()
        for name, costs, factor in (("shortest", g.cost_shortest, 1.0), ("cleanest", g.cost_cleanest, H_FACTOR)):
            found = astar.astar(g.offsets, g.targets, costs, a, b, astar.make_heuristic(g.lat, g.lon, b, factor))
            plain = astar.astar(g.offsets, g.targets, costs, a, b, None)
            assert abs(found["cost"] - plain["cost"]) <= 1e-6 * plain["cost"]
            path = found["path"]
            edges = [g.edge_between(u, v, costs) for u, v in zip(path, path[1:])]
            row[name] = {"expanded": found["expanded"], "dijkstra": plain["expanded"],
                         "distance": sum(g.length_m[k] for k in edges),
                         "weighted": sum(g.length_m[k] * KIND_INDEX[g.kind[k]] for k in edges), "path": path}
        row["seconds"] = time.perf_counter() - started
        rows.append(row)
    return g, rows


def pct(x):
    return f"{100 * x:.1f}%"


def main():
    parser = argparse.ArgumentParser(description="Evaluate Tynys")
    parser.add_argument("--live", action="store_true", help="fetch fresh data instead of the bundled snapshot")
    args = parser.parse_args()

    out = []
    w = out.append
    w("# Tynys - evaluation")
    w("")
    w("Generated by `python -m tynys.evaluate` on " + time.strftime("%Y-%m-%d %H:%M") + ". All numbers below were "
      "computed by that run; PM2.5 values are CAMS model readings served by Open-Meteo, not sensor measurements.")
    w("")
    summaries = {}
    for city in CITIES:
        cid = city["id"]
        bundle, times, bands, hours = history_of(cid, args.live)
        split = len(bands) - TEST_HOURS
        summaries[cid] = {"bundle": bundle, "times": times, "bands": bands, "hours": hours, "split": split}

    # ---------------- HMM
    w("## 1. HMM: how well do the transition matrices predict the class?")
    w("")
    w(f"Training: the {TRAIN_HOURS // 24} days before the test period; test: the last {TEST_HOURS // 24} days "
      f"({TEST_HOURS} hours). From the observed band at hour t the model predicts the most likely band at t + k by "
      "multiplying the time-of-day transition matrices (`p = e_band(t) A_b(t) ... A_b(t+k-1)`, then argmax). "
      "Persistence predicts that the band stays the same.")
    w("")
    w("| city | data | lead | model accuracy | persistence | test cases |")
    w("|---|---|---|---|---|---|")
    models = {}
    for city in CITIES:
        cid = city["id"]
        s = summaries[cid]
        acc, model = hmm_accuracy(s["bands"], s["hours"])
        models[cid] = model
        s["acc"] = acc
        src = s["bundle"]["source"] + " " + s["bundle"]["fetched_at"]
        for k in LEADS:
            w(f"| {city['name']} | {src} | {k} h | {pct(acc[k]['model'])} | {pct(acc[k]['persistence'])} | {acc[k]['n']} |")
    w("")
    names = ["low", "moderate", "elevated", "high"]
    w("Share of hours per band, training period vs test period:")
    w("")
    w("| city | period | low | moderate | elevated | high |")
    w("|---|---|---|---|---|---|")
    for city in CITIES:
        s = summaries[city["id"]]
        acc = s["acc"]
        a, b = acc["train_period"]
        w(f"| {city['name']} | train {s['times'][a][:10]} .. {s['times'][b][:10]} | "
          + " | ".join(pct(x) for x in acc["train_share"]) + " |")
        w(f"| {city['name']} | test {s['times'][s['split']][:10]} .. {s['times'][-1][:10]} | "
          + " | ".join(pct(x) for x in acc["test_share"]) + " |")
    w("")
    for city in CITIES:
        acc = summaries[city["id"]]["acc"]
        w(f"- {city['name']}: rows that backed off to the pooled matrix in training: "
          + (", ".join(f"{b['block']}/{names[b['row']]} (count {b['count']})" for b in acc["backed_off"]) or "none")
          + ". Every row's largest entry is on the diagonal: "
          + ("yes" if acc["diagonal_argmax"] else "no") + ".")
    w("")
    w("Reading: when every row's largest entry is on the diagonal, the 1-hour prediction is exactly persistence, "
      "which is why the two 1 h columns are identical. Over several hours the product of matrices drifts toward the "
      "bands that were common in the training period, so the multi-hour result depends on whether the test period "
      "looks like the training period:")
    for city in CITIES:
        acc = summaries[city["id"]]["acc"]
        better = [k for k in LEADS if acc[k]["model"] > acc[k]["persistence"]]
        worse = [k for k in LEADS if acc[k]["model"] < acc[k]["persistence"]]
        beats = ("beats persistence at " + ", ".join(f"{k} h" for k in better)) if better \
            else "does not beat persistence at any lead"
        loses = ("loses at " + ", ".join(f"{k} h" for k in worse)) if worse else "never loses"
        w(f"- {city['name']}: the model {beats} and {loses}"
          + f"; the high band covers {pct(acc['train_share'][3])} of training hours and "
          f"{pct(acc['test_share'][3])} of test hours.")
    w("")
    w("So the transition matrices are a weak point forecaster when the season changes. In Tynys they are only one "
      "ingredient: the app's prediction also uses the CAMS forecast as a reading, and the MDP needs the matrices' "
      "full probability distribution rather than an argmax.")
    w("")

    # ---------------- MDP
    w("## 2. MDP: backtest of the go / wait / skip policy")
    w("")
    w(f"Every hour of the {TEST_HOURS // 24}-day test period is replayed as \"now\" with the defaults (deadline "
      f"{DEFAULTS['deadline_hours']} h, waiting cost {DEFAULTS['wait_cost']}, reading trust {DEFAULTS['reliability']}). "
      "The belief comes from filtering the previous 24 readings with matrices trained on the 78 training days. "
      "**Past model values stand in for the forecast**: the MDP sees the model values of the next hours "
      "(with the usual forecast trust r_f(k)), so this is optimistic compared with a real forecast. "
      "The realised reward uses the band that actually came: going at hour t earns `R_go(band_t) - wait_cost * t`. "
      "The oracle knows the future and picks the best hour (or skips).")
    w("")
    w("| city | activity | policy | always go now | oracle best hour | policy waited | start hours |")
    w("|---|---|---|---|---|---|---|")
    for city in CITIES:
        s = summaries[city["id"]]
        s["bt"] = {}
        for activity in ACTIVITIES:
            r = backtest(s["bands"], s["hours"], models[city["id"]], activity)
            s["bt"][activity["id"]] = r
            w(f"| {city['name']} | {activity['id']} | {r['policy']:.3f} | {r['go_now']:.3f} | {r['oracle']:.3f} | "
              f"{pct(r['waited_share'])} | {r['n']} |")
    w("")
    w("Units are the utility points of SPEC 4.4 (assumptions). The gap between the policy and the oracle is the "
      "price of not knowing the future; the gap between the policy and \"always go now\" is what planning adds.")
    w("")

    # ---------------- A*
    w("## 3. A*: heuristic savings and the cleanest route")
    w("")
    w(f"{N_PAIRS} random node pairs per city, 1-6 km apart in a straight line (fixed random seed). Each pair runs "
      "the four searches of a /api/route request (A* and Dijkstra for both cost functions); A* and Dijkstra "
      "costs agreed on every pair (asserted).")
    w("")
    w("| city | graph | search | mean expanded A* | mean expanded Dijkstra | saved |")
    w("|---|---|---|---|---|---|")
    astar_rows = {}
    for i, city in enumerate(CITIES):
        g, rows = astar_eval(city["id"], 100 + i)
        astar_rows[city["id"]] = (g, rows)
        for name in ("shortest", "cleanest"):
            a = statistics.mean(r[name]["expanded"] for r in rows)
            d = statistics.mean(r[name]["dijkstra"] for r in rows)
            w(f"| {city['name']} | {g.n_nodes} nodes, {g.n_edges} edges | {name} | {a:.0f} | {d:.0f} | {pct(1 - a / d)} |")
    w("")
    w("| city | mean extra distance | median extra distance | mean weighted-cost reduction | median reduction | "
      "same route | mean time for 4 searches |")
    w("|---|---|---|---|---|---|---|")
    for city in CITIES:
        g, rows = astar_rows[city["id"]]
        extra = [r["cleanest"]["distance"] / r["shortest"]["distance"] - 1 for r in rows]
        reduction = [1 - r["cleanest"]["weighted"] / r["shortest"]["weighted"] for r in rows]
        same = sum(r["cleanest"]["path"] == r["shortest"]["path"] for r in rows)
        secs = statistics.mean(r["seconds"] for r in rows)
        w(f"| {city['name']} | {pct(statistics.mean(extra))} | {pct(statistics.median(extra))} | "
          f"{pct(statistics.mean(reduction))} | {pct(statistics.median(reduction))} | {same}/{len(rows)} | {secs:.3f} s |")
    w("")
    w("The heuristic of the cleanest search is scaled by H_FACTOR = 0.6 to stay admissible, so it is weaker and "
      "saves fewer expansions than the shortest search. The weighted-cost reduction is measured in the traffic "
      "exposure index (an assumption), not in measured pollution.")
    w("")

    # ---------------- discussion
    w("## 4. Limits and possible improvements")
    w("")
    w("- **Ground truth.** The hidden class is never observed: the HMM is trained and scored on CAMS model bands. "
      "Calibrating the reading trust `r` against street-level sensors (where public ones exist) would replace an "
      "assumption with an estimate.")
    w("- **Forecast archive.** The MDP backtest feeds past model values in as the forecast. Archiving the real "
      "3-day forecasts each day would give an honest backtest of decisions made with forecast error.")
    w("- **Richer state.** Persistence is hard to beat with first-order transitions on a slowly changing series; "
      "adding wind speed or the trend of the last hours to the state could help multi-hour predictions.")
    w("- **QMDP.** The action rule assumes the class becomes known after one step; a small POMDP solved over a "
      "discretised belief would value waiting for information properly.")
    w("- **Exposure index.** Kinds come from OSM road classes and a 25 m rule; traffic counts or measured NO2 "
      "along streets would make the cleanest route evidence-based rather than a proxy.")
    w("")

    path = os.path.join(ROOT, "docs", "evaluation.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("\n".join(out))
    print(f"\nwritten to {path}")


if __name__ == "__main__":
    main()
