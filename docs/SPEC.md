# Tynys — specification (v2, after review)

*Tynys* (тыныс, "breath" in Kazakh) is an air-quality planner for Astana and Almaty.
It is Tair Kaldybayev's final project for AIF1303 AI Fundamentals (QAIRU, trimester 1, 2026–27).

It answers three questions a resident has on a smoggy day:

1. **How is the air right now?** → hidden Markov model (Bayes filtering + Viterbi) over hourly PM2.5.
2. **When should I go out?** → finite-horizon MDP solved by backward induction (Bellman).
3. **Which way should I walk?** → A* on the real OpenStreetMap street graph with an exposure-weighted cost.

The parts feed each other: the HMM belief and its transition tables are the MDP's starting point and
dynamics; the hour the MDP picks sets the pollution level used to score the A* routes.

## 1. What the course requires (and how this meets it)

- At least three algorithms from different course topics serving one goal — search (A*),
  probabilistic reasoning (Bayes/HMM), sequential decisions (MDP).
- For each algorithm the grader wants **input → key calculation/steps → output → one-sentence
  explanation**, with labelled assumptions and at least one test case. The console demo prints exactly
  this and the app has a "Show the math" view per algorithm.
- "Evaluate the results and discuss possible improvements" → `tynys/evaluate.py` (§7).
- Deliverables: Python code, short README with real sample input/output, live demo, oral defense.
  The student must explain every algorithm, so **the three algorithms are hand-written in plain Python
  with no third-party libraries** (no numpy, networkx, hmmlearn), in small functions whose docstrings
  state the formula being implemented.
- **Order of delivery: algorithms + tests + console demo + evaluation → HTTP API → web UI.**
  In the UI the math panels are required; atmosphere effects and the search replay are optional polish.

## 2. Honesty rules (non-negotiable)

- Every number shown comes from real data or from code that ran. No invented values, no fake sensors.
- Every modelling assumption is labelled as an assumption in the UI and README (list in §4.6).
- The PM2.5 values are **model output, not measurements**: Open-Meteo serves the CAMS global
  atmospheric model (~40 km grid) for Kazakhstan, and its "past" hours are earlier model runs. Call them
  "model readings", never "sensor data" or "observations of your street". The model smooths peaks, so the
  app is about *timing and relative exposure*, not absolute health claims. It is not medical advice.
- If live data cannot be fetched, the API serves a bundled snapshot and says so (`source: "snapshot"`),
  and the UI shows that badge. Never silently present a snapshot as live.

## 3. Data sources (all keyless)

| What | Source | When |
|---|---|---|
| Hourly PM2.5 / PM10, 92 days back + 3 days forecast | Open-Meteo Air Quality API `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=..&longitude=..&hourly=pm2_5,pm10&past_days=92&forecast_days=3&timezone=Asia%2FAlmaty` | per request (server side), CDN-cached 15 min |
| Wind speed, temperature (context only, optional) | Open-Meteo Forecast API | per request |
| Street network, parks | OpenStreetMap via Overpass API (needs a `User-Agent` header, else 406; use `[out:json][timeout:180]`, tile the bbox on 429/504) | once, at build time → `data/` |
| Place search | Photon `https://photon.komoot.io/api/` (its `bbox` parameter is `minLon,minLat,maxLon,maxLat`) | per request, proxied |
| Map tiles | OpenFreeMap vector tiles (MapLibre) | browser |

User-Agent for all server-side calls: `tynys/0.1 (student project; github.com/tairqaldy/tynys)`.
Attribution in the UI footer: Open-Meteo (CC BY 4.0), CAMS, © OpenStreetMap contributors, OpenFreeMap.

Cities: `astana` (51.1282, 71.4304) and `almaty` (43.2389, 76.8897), timezone `Asia/Almaty` (UTC+5) for both.
Measured on 2026-11-10 over 92 days: Astana median PM2.5 6.5, p95 18.8; Almaty median 16.1, p95 37.3.

## 4. The model

### 4.1 Classes (hidden states and reading bands)

Four classes of hourly PM2.5 (µg/m³). `band(pm) = 0 if pm ≤ 5, 1 if pm ≤ 15, 2 if pm ≤ 25, else 3`.

| idx | id | label | PM2.5 |
|---|---|---|---|
| 0 | `low` | Low | ≤ 5 |
| 1 | `moderate` | Moderate | 5 – 15 |
| 2 | `elevated` | Elevated | 15 – 25 |
| 3 | `high` | High | > 25 |

The cut-points are borrowed from the WHO 2021 guidelines (annual guideline 5, 24-hour guideline 15,
24-hour interim target 4 = 25) and applied to hourly model values as a convenient scale. **Assumption:**
WHO defines no hourly PM2.5 guideline.

The *hidden state* is the true class where the person is; the *reading* is the band of the model value
for the city grid cell (it can be wrong for a particular street). Representative concentration
`rep[s]` = median PM2.5 of history hours in band `s`; if a band has fewer than 5 hours use `[2.5, 10, 20, 35][s]`.

### 4.2 HMM parameters

- **Prior** π: band frequencies over the 92-day history with add-one smoothing.
- **Transitions**: four matrices by time-of-day block of the *origin* hour — `night` 00–05,
  `morning` 06–11, `day` 12–17, `evening` 18–23. Count hour→next-hour band pairs, add-one smoothing:
  `A_b[i][j] = (N_b[i][j] + 1) / (Σ_j N_b[i][j] + 4)`. **Back-off:** if row `i` of a block has fewer than
  20 counted transitions, use row `i` of the pooled all-day count matrix instead (smoothed the same way)
  and report which rows backed off. Keep and expose the raw counts.
- **Emission** `B(r)[i][j] = P(reading band j | true class i)`: `r` on the diagonal, the remaining `1 − r`
  split equally between the adjacent bands (an edge class gives all of it to its single neighbour); zero
  elsewhere. `r` is *how much the grid value is trusted to represent your street*, default **0.8**,
  adjustable 0.55–0.95. **Assumption — a trust setting, not estimated from data** (the transitions are
  learned from the same readings, so `r` cannot be identified).
- **Forecast trust** for an hour `k` hours ahead: `r_f(k) = max(0.5, 0.75 − 0.005·k)`. **Assumption.**

### 4.3 Filtering, decoding, prediction (probabilistic reasoning)

- **Forward filter** over the last 24 model readings `o_1..o_24`:
  `α_1 ∝ π ⊙ B[:,o_1]`, `α_t ∝ B[:,o_t] ⊙ (A_{b(t−1)}ᵀ α_{t−1})` where `b(t−1)` is the block of the hour
  of reading `t−1`. `belief_now = α_24`. Expose the last step as a Bayes update: predicted prior,
  likelihood column, unnormalised product, evidence (the normaliser), posterior.
- **Viterbi** over the same 24 hours in log space, with `log0(x) = −inf if x == 0 else log(x)`
  (the emission has zeros) → most likely class sequence.
- **Prediction** for future hours `k = 1..48`, using the forecast as a weaker reading:
  `p_k = A_{b(hour of k−1)}ᵀ belief_{k−1}`, `belief_k ∝ B(r_f(k))[:, f_k] ⊙ p_k`, with `f_k` the band of the
  forecast PM2.5 and `belief_0 = belief_now`. Expected concentration `E[pm]_k = Σ_s belief_k[s]·rep[s]`.
- Report `agreement`: the share of history hours where the filter's most likely class equals the
  reading's band (it is high — say so; the filter mostly smooths isolated jumps).

### 4.4 MDP: go now, wait, or skip (sequential decision making)

Decision each hour `t = 0..H` (`H` = "within N hours", 1–12; hour 0 is now).

- **State** `(t, s)`: hour index and air class.
- **Actions**: `go` (terminal), `skip` (terminal, reward 0), `wait` (only for `t < H`).
  Activities flagged `must` have no `skip`.
- **Dynamics while waiting** (time-dependent, built from the HMM pieces by Bayes' rule):
  `T_t[s][s'] ∝ A_{b(t)}[s][s'] · B(r_f(t+1))[s'][f_{t+1}]`, each row normalised
  (= `P(s_{t+1} = s' | s_t = s, next forecast)`).
- **Rewards** (utility points; **assumptions**, shown and adjustable):
  - `R_go(s) = benefit − harm[s] · (duration_min / 60) · intensity · sensitivity`
  - `harm = [0, 1, 4, 10]` per hour for low / moderate / elevated / high
  - waiting costs `wait_cost` per hour, 0.1 ("flexible") … 1.0 ("in a hurry"), default 0.3
  - `sensitivity` = 2 with the "sensitive (child, asthma, elderly)" switch, else 1

  | activity id | label | default duration | intensity | benefit | must | notes |
  |---|---|---|---|---|---|---|
  | `walk` | Walk | 45 min | 1.0 | 5 | no | |
  | `run` | Run | 40 min | 2.5 | 8 | no | breathes ~2.5× more air (3.0 vs 1.2 m³/h) |
  | `kids` | Outside with a child | 60 min | 1.0 | 6 | no | sensitivity forced to 2 |
  | `errand` | Errand on foot | 30 min | 1.0 | 6 | yes | cannot be skipped; picks the best hour |

  `duration` may be 10–180 minutes.
- **Solution** by backward induction (finite-horizon value iteration):
  `Q_t(s, go) = R_go(s)`; `Q_t(s, skip) = 0`; for `t < H`: `Q_t(s, wait) = −wait_cost + Σ_{s'} T_t[s][s']·V_{t+1}(s')`;
  `V_t(s) = max` over the allowed actions; ties prefer `go`, then `wait`, then `skip`.
- **Acting under uncertainty**: the current class is not known exactly, so the action now maximises the
  belief-weighted value `Q(b, a) = Σ_s belief_now[s]·Q_0(s, a)` over `go`, `wait`, `skip` (the QMDP
  approximation). **Limitation to state:** it assumes the uncertainty disappears after one step.
- **When will I probably go?** Push the class distribution forward under the policy:
  - if the decision is `go`: `p_go[0] = 1`; if `skip`: `p_skip = 1`;
  - if `wait`: `p_go[0] = 0`, `d_1[s'] = Σ_s belief_now[s]·T_0[s][s']`, then for `t ≥ 1`:
    `p_go[t] = Σ_{s: π_t(s)=go} d_t[s]`, `p_skip += Σ_{s: π_t(s)=skip} d_t[s]`,
    `d_{t+1}[s'] = Σ_{s: π_t(s)=wait} d_t[s]·T_t[s][s']`.
  - `best_t` = the first hour where the cumulative `p_go` reaches 0.5 (the median go hour); `null` if it
    never does ("probably not today").
- **Note for the explainer:** `T_t` conditions only on the next forecast, so `d_t` is the class
  distribution under the MDP's model and differs a little from the §4.3 prediction (which uses all
  forecasts so far). Each forecast is used once per model; nothing is double-counted. Do not plot `d_t`
  beside the predicted belief.

### 4.5 A*: lower-exposure route (search)

- **Graph** per city from OSM walkable ways inside a "central city" bounding box, largest connected
  component only, undirected. Keep full way geometry (every OSM node is a graph node) so routes follow
  the streets. Store compactly as CSR arrays in JSON: `lat[]`, `lon[]` as integers in 1e-6°,
  `offsets[]`, `targets[]`, `length_dm[]` (decimetres, **rounded up**), `kind[]`. Each edge's length is
  the haversine distance of its two endpoints with the same Earth radius the heuristic uses.
  Budget ≤ ~6 MB per city (~100k nodes): first drop `service=parking_aisle|driveway`, `access=private|no`,
  `foot=no`, then shrink the bounding box. Record the final bbox; the UI states the coverage.
- **Traffic exposure index** per edge (**assumption**: a proxy for traffic-related pollutants — NO₂,
  soot, ultrafine particles — which are highest right next to busy roads; the CAMS grid value cannot see
  street-level differences, and PM2.5 mass itself varies much less between streets):

  | kind | OSM | index |
  |---|---|---|
  | `major` | trunk, primary (+links) | 2.0 |
  | `secondary` | secondary (+link) | 1.6 |
  | `tertiary` | tertiary (+link) | 1.3 |
  | `street` | residential, unclassified, living_street, service | 1.0 |
  | `path` | footway, pedestrian, path, cycleway, steps | 0.8 |
  | `park` | a `path`/`street` edge whose midpoint lies inside `leisure=park\|garden` or `landuse=forest` | 0.6 |
  | `roadside_major` | a `path`/`street` edge whose midpoint is within 25 m of a `major` road | 1.8 |
  | `roadside_secondary` | same, within 25 m of a `secondary` road | 1.4 |

  **Precedence, never multiplied:** roadside > park > base kind. `H_FACTOR = min(all indices) = 0.6`,
  asserted at build time and in a test. Tagging happens at build time (grid hash for proximity,
  point-in-polygon for parks).
- **Two searches** with the same A* function:
  - *shortest*: `cost(e) = length`, `h(n) = haversine(n, goal)`
  - *cleanest*: `cost(e) = length × index`, `h(n) = haversine(n, goal) × H_FACTOR`
  `h` is admissible (no edge costs less than 0.6 × its straight length) and consistent
  (`h(n) ≤ 0.6·d(n,m) + h(m) ≤ cost(n,m) + h(m)` by the triangle inequality), so A* returns an optimal path.
- For each of the two cost functions also run the search with `h = 0` (Dijkstra / uniform-cost) to
  report how many node expansions the heuristic saved, and check the costs agree (four searches per request).
- **Outputs** per route: polyline, `distance_m`, `weighted_cost = Σ length × index`,
  `mean_index = weighted_cost / distance_m`, minutes (walk 80 m/min, run 160 m/min), share of length by
  kind, and a **relative exposure score** `= E[pm](hour) × mean_index × ventilation × hours`, ventilation
  1.2 m³/h walking and 3.0 m³/h running (moderate / high intensity, US EPA Exposure Factors Handbook 2011,
  ch. 6). It has units of µg but is **for comparing the two routes only, not a measured dose**.
- Snap endpoints to the nearest graph node; reject points more than 400 m from the graph or outside the
  bounding box with a clear error. Cap straight-line distance at 12 km.
- Return a down-sampled list of the cleanest search's expanded nodes (≤ 1,500 points, expansion order)
  so the UI can replay the search.

### 4.6 Assumptions to label everywhere

Class cut-points applied to hourly values; reading trust `r` and forecast trust `r_f(k)`; transitions
learned from model readings (bands stand in for the hidden class); harm/benefit/wait numbers; the QMDP
action rule; the traffic exposure index and the 25 m roadside rule; ventilation rates and walking speeds.

## 5. Repository layout and ownership

```
tynys/            Python package: classes.py, data.py, hmm.py, mdp.py, astar.py, graph.py, service.py,
                  evaluate.py, demo.py, devserver.py
api/              Vercel Python functions, one thin file per endpoint (meta.py, air.py, plan.py, route.py, places.py)
scripts/          build_graph.py (Overpass → data/graph_<city>.json), snapshot_air.py, build_places.py
data/             graph_<city>.json, places_<city>.json, air_snapshot_<city>.json
tests/            unittest (stdlib) — see §7
fixtures/         real API responses saved by the backend for the frontend to develop against
src/, index.html, package.json, vite.config.ts, tsconfig*.json, public/   web app (Vite + React + TypeScript)
docs/             SPEC.md (this file), demo_output_<city>.txt, evaluation.md; later DEFENSE.md, AI-USAGE.md
README.md, vercel.json, .gitignore                                         owned by the lead, do not edit
```

Backend owns `tynys/ api/ scripts/ data/ tests/ fixtures/` and `docs/demo_output_*.txt`, `docs/evaluation.md`.
Frontend owns `src/ public/ index.html package.json vite.config.ts tsconfig*.json`. Nobody commits; the lead commits.

Python: 3.12, **standard library only** at runtime (`urllib`, `json`, `math`, `heapq`, `http.server`).
Any Python 3.12 interpreter works locally. No `requirements.txt` needed.

## 6. HTTP API (all `GET`, JSON, UTF-8)

Every `api/<name>.py` exposes `class handler(BaseHTTPRequestHandler)` and delegates to `tynys.service`,
which holds plain functions `meta()`, `air(...)`, `plan(...)`, `route(...)`, `places(...)` returning
dicts (the dev server, the tests and the console demo call the same code). Each `api` file first puts
the repo root on `sys.path` and locates `data/` relative to its own file. Errors: HTTP 4xx/5xx with
`{"error": {"code": "...", "message": "human readable"}}`. Success responses set
`Cache-Control: public, s-maxage=900, stale-while-revalidate=3600` (`meta`, `places`: `s-maxage=86400`).
Probabilities are arrays of 4 floats in class order, rounded to 4 decimals. Times are local ISO strings
`YYYY-MM-DDTHH:00` plus one top-level `timezone`. `bbox` is always `[south, west, north, east]`.

`python -m tynys.devserver` serves the same routes on `http://127.0.0.1:8787/api/*` for local
development. Check the port before starting (`lsof -nP -iTCP:8787 -sTCP:LISTEN`), stop it when done.

### `GET /api/meta`
```jsonc
{ "cities": [{ "id": "astana", "name": "Astana", "center": [51.1282, 71.4304], "bbox": [s, w, n, e],
               "graph": { "nodes": 98211, "edges": 104233 },
               "places": [{ "id": "baiterek", "name": "Baiterek", "lat": 51.1283, "lon": 71.4305 }] }],
  "classes": [{ "id": "low", "label": "Low", "min": 0, "max": 5 }, ..., { "id": "high", "label": "High", "min": 25, "max": null }],
  "activities": [{ "id": "walk", "label": "Walk", "duration_min": 45, "intensity": 1.0, "benefit": 5, "must": false }, ...],
  "defaults": { "reliability": 0.8, "wait_cost": 0.3, "deadline_hours": 8, "harm": [0, 1, 4, 10] },
  "kinds": [{ "id": "major", "label": "Major road", "index": 2.0 }, ...],
  "assumptions": ["..."] }
```

### `GET /api/air?city=astana&reliability=0.8`
```jsonc
{ "city": "astana", "timezone": "Asia/Almaty", "now": "2026-11-10T11:00",
  "source": "live",                       // or "snapshot" (+ "snapshot_taken": "...")
  "current": { "pm25": 6.1, "pm10": 9.8, "band": 1 },
  "readings": [{ "time": "...", "pm25": 6.1, "band": 1 }],          // last 48 model hours, oldest first, ends at "now"
  "forecast": [{ "time": "...", "pm25": 7.4, "band": 1 }],          // next 48 hours
  "hmm": {
    "history_hours": 2208, "reliability": 0.8, "agreement": 0.92,
    "prior": [..4], "rep_pm25": [..4],
    "emission": [[..4] x4],
    "transitions": { "night": [[..4] x4], "morning": ..., "day": ..., "evening": ... },
    "transition_counts": { "night": [[int x4] x4], ..., "all": [[int x4] x4] },
    "backed_off": [{ "block": "day", "row": 3, "count": 0 }],
    "filtered": [{ "time": "...", "obs": 1, "belief": [..4], "viterbi": 1 }],   // the last 24 model hours
    "belief_now": [..4], "state_now": 1,                                          // argmax of belief_now
    "bayes_step": { "time": "...", "obs": 1, "predicted": [..4], "likelihood": [..4],
                    "unnormalised": [..4], "evidence": 0.61, "posterior": [..4] },
    "predicted": [{ "time": "...", "lead_h": 1, "forecast_band": 1, "forecast_reliability": 0.745,
                    "belief": [..4], "expected_pm25": 7.1 }]                       // next 48 hours
  },
  "weather": { "wind_kmh": 12.3, "temp_c": -4.0 } }                               // or null
```

### `GET /api/plan?city=astana&activity=walk&duration=45&deadline=8&wait_cost=0.3&sensitive=0&reliability=0.8`
```jsonc
{ "city": "astana", "now": "...", "source": "live",
  "inputs": { "activity": "walk", "duration_min": 45, "deadline_hours": 8, "wait_cost": 0.3, "sensitive": false,
              "must": false, "intensity": 1.0, "benefit": 5, "sensitivity": 1, "harm": [0, 1, 4, 10] },
  "reward_go": [..4],                                   // R_go(s)
  "belief_now": [..4], "state_now": 1,
  "hours": [{ "t": 0, "time": "...", "forecast_band": 1, "expected_pm25": 6.4,
              "transition": [[..4] x4] | null,          // T_t, null at t = H
              "q_go": [..4], "q_wait": [..4] | null,    // q_wait null at t = H
              "value": [..4], "policy": ["go"|"wait"|"skip" x4],
              "p_go": 0.12, "p_go_cumulative": 0.12 }],
  "p_skip": 0.03,
  "decision": { "action": "wait",                       // "go" | "wait" | "skip"
                "q_go": 3.9, "q_wait": 4.3, "q_skip": 0, // belief-weighted at t = 0
                "best_t": 4, "best_time": "...",        // null when the cumulative never reaches 0.5
                "bellman": { "state": 1, "wait_cost": 0.3, "transition_row": [..4], "next_values": [..4],
                             "expected_next": 4.6, "q_wait": 4.3, "q_go": 3.9 } } }  // worked example for state_now at t = 0
```

### `GET /api/route?city=astana&from=51.1283,71.4305&to=51.1320,71.4040&activity=walk&at=2026-11-10T15:00`
`at` is optional (default: now) and must lie within now … now + 48 h (else 400); it selects `E[pm]` for the exposure score.
```jsonc
{ "city": "astana", "from": { "lat": .., "lon": .., "snapped": [lat, lon], "snap_m": 12 }, "to": { ... },
  "at": "...", "pm25_at": 7.1, "ventilation_m3h": 1.2,
  "shortest": { "coords": [[lat, lon], ...], "distance_m": 2140, "minutes": 26.8,
                "weighted_cost": 3039, "mean_index": 1.42, "exposure_score": 5.4,
                "by_kind": { "major": 0.31, "street": 0.4, ... },          // shares of length, sum to 1
                "expanded": 1840, "expanded_dijkstra": 9120 },             // this route's own cost function
  "cleanest": { ...same fields..., "explored": [[lat, lon], ...] },        // ≤ 1500 points, expansion order
  "comparison": { "extra_distance_pct": 6.2, "extra_minutes": 1.7,
                  "exposure_reduction_pct": 21.5,     // 100·(1 − cleanest.weighted_cost / shortest.weighted_cost)
                  "same_route": false } }             // identical node sequences
```

### `GET /api/places?city=astana&q=khan+shatyr`
```jsonc
{ "results": [{ "name": "Khan Shatyr", "detail": "Turan Avenue, Astana", "lat": .., "lon": .. }] }   // ≤ 6, inside bbox only
```

## 7. Tests, console demo, evaluation (backend)

`python -m unittest discover tests` must pass offline (snapshot data), including:
- HMM forward on the umbrella world (AIMA: `P(rain | u1) = 0.818`, `P(rain | u1, u2) = 0.883`) and Viterbi
  on `[u, u, ¬u, u, u]` → `[r, r, ¬r, r, r]`; beliefs sum to 1; emission and transition rows sum to 1;
  Viterbi survives zero-probability emissions; sparse rows back off.
- MDP on a hand-solved 2-state, 2-step case; a `must` activity's policy contains no `skip`; for every
  `(t, s)`, if the policy says `go` at some `wait_cost` it says `go` at any higher one; `p_go` and `p_skip`
  sum to 1; a decision of `wait` never reports `best_t = 0`.
- A* on a small grid with a wall (known optimal cost); A* cost equals Dijkstra cost (relative tolerance
  1e-6) on 30 random pairs of the real graph for both cost functions; `h` never exceeds the true remaining
  cost on those pairs; the cleanest route's weighted cost ≤ the shortest route's weighted cost;
  `min(index) == H_FACTOR`.
- Service functions return the shapes in §6 for both cities from snapshots.

`python -m tynys.demo --city almaty [--offline]` prints, for each of the three algorithms,
**Input → Steps → Output → Why this algorithm**, in small readable tables, and the run is saved to
`docs/demo_output_<city>.txt` (the README quotes it as real sample output).

`python -m tynys.evaluate` writes `docs/evaluation.md` (real numbers, both cities):
- HMM: 1-, 3- and 6-hour-ahead class accuracy using the transition matrices only, trained on the first
  78 days and tested on the last 14, against the "persistence" baseline (class stays the same).
- MDP: backtest over history hours — mean realised reward of the policy vs "always go now" vs the
  oracle best hour (state clearly that past model values stand in for the forecast).
- A*: over 30 random pairs — mean node expansions vs Dijkstra, mean extra distance and mean reduction
  in weighted cost of the cleanest route.

## 8. Web app (frontend)

Single page, English UI, works on a phone and on a projector. Sections in order:

1. **Now** — one plain sentence ("Particle pollution in Almaty is *elevated* right now"), the model
   reading, the belief as four bars with percentages, a 24 h strip of readings with the Viterbi class
   under it, and the next 24–48 h as predicted belief. "How much do you trust the grid value" slider.
2. **When** — activity chips, duration, "within N hours", "how much does waiting bother you", sensitive
   switch → the decision ("Wait — most likely around 15:00" / "Go now" / "Probably not today"),
   probability-of-going bars per hour, and the policy grid (hours × classes, go / wait / skip).
3. **Which way** — from/to by search, by clicking the map, or from preset places; both routes on the map
   (shortest and cleanest), the comparison in one sentence ("21% less traffic exposure for 6% more
   walking"), per-route cards, and a "Replay search" control that animates the explored nodes.
4. **Show the math** — an expandable panel per algorithm: matrices (with backed-off rows marked), the
   Bayes step, the Bellman example, the heuristic and why it is admissible, A* vs Dijkstra counts.
   This is what gets defended, so it must be legible and correct.
5. **About** — data sources and attribution, the assumption list, limits ("model output, not sensors",
   coverage area), "not medical advice", course and author line, link to the GitHub repo.

Design direction: the subject is air, so the page should feel like air — light, calm, lots of space,
and **the atmosphere of the page follows the data**: clear and crisp when the level is low, visibly
hazier and warmer as the class gets worse (background tint, a soft haze over the map, the accent
colour). One class scale used consistently for every chart, the map and the policy grid; it must stay
distinguishable for colour-blind viewers and in dark mode (pair colour with labels or patterns).
Typography with real Cyrillic support (place names come back in Russian/Kazakh): an editorial serif for
statements, a quiet grotesque for UI, a mono for numbers; self-hosted via `@fontsource`. No UI kit, no
generic dashboard cards, no emoji, no gradients-for-decoration. Numbers are tabular. Every chart is
hand-built SVG. Loading, empty, error and "snapshot data" states are designed, not default.
Map: MapLibre GL with an OpenFreeMap style. Light and dark themes.
