# Defense notes

Preparation for the live demonstration and the oral defense of Tynys (AIF1303 final project).
The worked numbers are from the Almaty run of 10 November 2026, 12:00, saved in
[`demo_output_almaty.txt`](demo_output_almaty.txt). On the day, the numbers on screen will be different;
the structure is the same.

## The pitch (about one minute)

> On a smoggy day in Almaty or Astana I have three questions: how bad is the air right now, when
> should I go out, and which way should I walk. Tynys answers each with a different algorithm from the
> course. A hidden Markov model turns noisy hourly PM2.5 values into a belief about the air class. A
> Markov decision process uses that belief and the forecast to decide whether to go now, wait or skip.
> A* then finds the shortest walking route and a route with less traffic exposure on the real street
> map. The three are connected: the HMM's belief and transition tables are the MDP's input, and the
> hour the MDP picks sets the pollution level used to score the routes. The data is live, the
> algorithms are written by hand in plain Python, and every assumption is labelled.

## Demo script (about five minutes)

1. **Open the site, Almaty.** Read the sentence at the top. Point at the belief bars: "these four
   numbers are the HMM's output, a probability for each class, not just one label."
2. **The 24-hour strip.** "Top row is what the model reported each hour, bottom row is the Viterbi
   path: the most likely true sequence."
3. **Trust slider.** Drag `r` down to 0.6. "I am telling the model the city-wide value is less
   reliable for my street. The belief spreads out, because the model now leans more on what usually
   happens at this hour."
4. **When.** Choose "Outside with a child". Read the decision. Show the three numbers (go, wait,
   skip) and say which is largest. Move "how much does waiting bother you" to the right: "waiting
   becomes more expensive, so the plan goes earlier."
5. **Policy grid.** "This is the whole policy from backward induction: for every hour and every class,
   the best action. The decision above is this table weighted by the belief."
6. **Which way.** The example route is already drawn. "Solid is the lower-exposure route, dotted is the
   shortest." Read the comparison sentence. Press **Replay search**: "these are the nodes A* expanded,
   in order. It grows toward the goal, not in all directions."
7. **Show the math → A\*.** Point at the two counts: A* against Dijkstra, same cost.
8. **About.** "The values are from an atmospheric model with a 40 km grid, not street sensors. The
   road index and the utility numbers are assumptions. It compares options; it is not medical advice."

**If the internet fails:** run `python -m tynys.demo --city almaty --offline` in a terminal. It prints
the same three algorithms from the bundled snapshot. If only Open-Meteo fails, the site switches to the
snapshot by itself and shows a "Snapshot data" badge.

## 1. Hidden Markov model — `tynys/hmm.py`

**Question it answers:** which air class am I probably in right now?

- **Hidden state:** the true class on my street: low (≤ 5 µg/m³), moderate (5–15), elevated (15–25), high (> 25).
- **Observation:** the band of the model's value for the whole city grid cell. It can be wrong for my street.
- **Transition matrices** `A`: counted from 92 days of hourly values, one matrix per time of day
  (night, morning, day, evening), with add-one smoothing so no probability is zero. A row with fewer
  than 20 counts uses the all-day row instead.
- **Emission matrix** `B`: probability `r = 0.8` that the reading's band equals the true class, the
  other 0.2 goes to the neighbouring bands. `r` is an assumption, set by the slider.

**The update, each hour** (`predict_step`, `bayes_update`, repeated by `forward`):

```
predict:  prior(s')     = Σ_s  A[s][s'] · belief(s)
update:   posterior(s') ∝ B[s'][reading] · prior(s')        then divide by the sum
```

**Worked example** (reading "moderate" at 12:00):

```
prior       [0.017 0.659 0.300 0.024]
likelihood  [0.200 0.800 0.100 0.000]     column "moderate" of B
product     [0.003 0.527 0.030 0.000]     sum = 0.561
posterior   [0.006 0.941 0.053 0.000]
```

The likelihood for "high" is 0: with this emission table a reading can be off by at most one class, so
a "moderate" reading rules out "high".

**Viterbi** (`viterbi`) answers a different question: not "which class now" but "which whole sequence
of 24 classes is most likely". It keeps, for every class, the best path that ends there, and uses logs
so the product of many small probabilities does not underflow.

**Prediction** (`predict_ahead`): the same two steps continue into the future, with the forecast as the
reading and a lower trust (0.745 for the next hour, falling to 0.51 after 48 hours).

**Why an HMM:** the thing I care about cannot be observed directly, the readings are noisy, and the
air changes from hour to hour in a way that depends mostly on the hour before. That is exactly the HMM
setting from the lecture.

**Questions to expect**

- *Why is the belief almost the same as the reading?* Because `r = 0.8` is high and the air changes
  slowly. Over the history the filter agrees with the reading's band in about 92% (Astana) to 97%
  (Almaty) of hours. It differs after a sudden jump: one odd reading does not move the belief all the way.
- *Where do the numbers in A come from?* Counting. `N[i][j]` = how many times band `i` was followed by
  band `j` one hour later in that time block; `A[i][j] = (N[i][j] + 1) / (row total + 4)`.
- *Why add one?* Without smoothing, a transition never seen in 92 days would get probability 0 and
  could never happen in the model.
- *Is the hidden state really hidden if you train on the readings?* Fair point, and it is listed as an
  assumption: there are no street sensors to learn from, so the reading's band stands in for the
  class when counting transitions, and `r` is a setting rather than something estimated.
- *How good is it?* Honest answer from the evaluation: one hour ahead the transition tables predict
  the same as "nothing changes". Six hours ahead they beat that in Astana (62% against 55%) and lose in
  Almaty (19% against 37%), because the heating season started inside the test weeks. That is why the
  app also feeds the forecast into the prediction.

## 2. Markov decision process — `tynys/mdp.py`

**Question it answers:** go now, wait an hour, or skip?

- **State:** (hour `t`, air class `s`), for `t = 0 … H` where `H` is "within N hours".
- **Actions:** go (ends), skip (ends, reward 0), wait (costs something, moves to the next hour).
- **Reward for going:** `R_go(s) = benefit − harm[s] × hours × intensity × sensitivity`.
  For a 45-minute walk: `5 − [0, 1, 4, 10] × 0.75 = [5.00, 4.25, 2.00, −2.50]`.
- **Transition while waiting:** `T_t[s][s'] ∝ A[s][s'] × B_forecast[s'][next forecast band]`: what
  usually happens next, corrected by what the forecast says (Bayes' rule again).

**Backward induction** (`backward_induction`), from the deadline back to now:

```
at the deadline:   V_H(s) = max( R_go(s), 0 )
before it:         Q_t(s, wait) = −wait_cost + Σ_s' T_t[s][s'] · V_{t+1}(s')
                   V_t(s) = max( R_go(s), Q_t(s, wait), 0 )
```

**Worked example**, class "moderate" at `t = 0`:

```
Q_wait = −0.3 + [0.005 0.970 0.025 0.000] · [5.00 4.25 3.09 3.65] = −0.3 + 4.22 = 3.92
Q_go   = 4.25                                       →  go is better in this class
```

**Because the class is uncertain**, the action now uses the belief (`qmdp_decision`):
`Q(go) = Σ_s belief(s) · Q_0(s, go) = 4.13`, `Q(wait) = 3.89`, `Q(skip) = 0` → **go now**.

An hour earlier the belief was 67% moderate and 32% elevated, and the result was the opposite:
`Q(go) = 3.54`, `Q(wait) = 3.83` → wait. Good example of why the belief matters: for the most likely
class going was already better, but the one-in-three chance of "elevated" tipped it.

**Why an MDP:** it is a sequence of decisions under uncertainty with a deadline. Going now gives a
known reward; waiting gives an uncertain future. Value iteration from the end is the standard way to
compare them.

**Questions to expect**

- *Why not just pick the hour with the best forecast?* The forecast can be wrong and waiting has a
  cost. The MDP weighs the chance of improvement against that cost, and it re-decides every hour.
- *What is the discount factor?* None is needed: the horizon is finite (at most 12 hours) and the cost
  of time is explicit as the waiting cost.
- *Where do benefit and harm come from?* I chose them. They are utility points, not health data, and
  the page says so. Their job is to make the trade-off explicit and adjustable.
- *What does "QMDP" assume?* It solves the problem as if the class were known and then averages over
  the belief. That treats the uncertainty as if it disappeared after one step, so it undervalues
  waiting to learn more. A full POMDP would fix that; it is listed as an improvement.
- *Does the policy actually help?* In the backtest for a walk in Almaty: always going now earns −0.02
  points on average, the policy 1.25 with no knowledge of the future and 1.80 with a perfect forecast;
  an oracle gets 1.85. The real app is somewhere between 1.25 and 1.80. For an errand in Astana the
  no-knowledge policy does not beat "go now" (4.905 against 4.912): when the air is usually fine
  there is nothing to gain from waiting.
- *The "probably by 13:00" hour: how is it computed?* Push the belief forward hour by hour under the
  policy (`go_probabilities`); the reported hour is the first one where the chance of having gone
  reaches 50%.

## 3. A* search — `tynys/astar.py`

**Question it answers:** which way should I walk?

- **Graph:** every walkable OpenStreetMap way in the city centre. Astana 75,986 nodes and 91,869
  edges; Almaty 63,379 and 76,003. Stored as flat arrays: the neighbours of node `n` are
  `targets[offsets[n] : offsets[n+1]]`.
- **Two cost functions, one algorithm:**
  - shortest: `cost = length`, `h(n) = straight-line distance to the goal`
  - lower exposure: `cost = length × index`, `h(n) = straight-line distance × 0.6`
- **Index** (assumption): 2.0 along a major road, 1.6 secondary, 1.3 tertiary, 1.0 residential, 0.8
  footpath, 0.6 inside a park; a path within 25 m of a major or secondary road counts as roadside
  (1.8 or 1.4).

**A\*** keeps a priority queue ordered by `f(n) = g(n) + h(n)`: cost so far plus an estimate of the
rest. It always expands the node with the smallest `f`.

**Why the answer is optimal:** `h` never overestimates. No edge costs less than 0.6 times its own
straight length, and a straight line is never longer than any path, so `0.6 × straight-line distance`
is a lower bound on the remaining cost (**admissible**). It also satisfies
`h(n) ≤ cost(n, m) + h(m)` for every edge (**consistent**, by the triangle inequality), which is why
the code never has to reopen a node it has already closed.

**Worked example**, Republic Square → Green Bazaar:

```
search          A* expanded   Dijkstra expanded   saved   same cost
shortest        6,007         34,680              83%     yes
lower-exposure  9,530         30,269              69%     yes

shortest        3,633 m   45 min   mean index 0.90
lower-exposure  3,898 m   49 min   mean index 0.78      → 7.6% less exposure for 7.3% more walking
```

**Why A\*:** route finding is search on a graph with a natural heuristic, the straight-line distance.
Dijkstra finds the same route but explores in every direction.

**Questions to expect**

- *Why does the heuristic save less on the exposure route (69% against 83%)?* It is multiplied by 0.6
  to stay admissible, so it is a weaker estimate and guides the search less.
- *What happens with a heuristic that overestimates?* The search gets faster but can return a route
  that is not the cheapest. With `h = 0` it becomes Dijkstra.
- *Is the route really cleaner?* The claim is narrower than that: it has less *traffic exposure* by an
  index I defined from road types. The air data cannot see street-level differences, and PM2.5 itself
  differs little between neighbouring streets. The index stands for traffic pollutants such as NO₂ and
  soot, which are highest right beside busy roads. It is labelled as an assumption on the page.
- *How do you know it is correct?* The tests compare A* with Dijkstra on 30 random pairs per city for
  both cost functions, and a separate check confirmed on every edge of both graphs that the heuristic
  is admissible and consistent.

## How the three connect (the "not three unrelated demos" question)

1. The HMM gives `belief_now` and the matrices `A` and `B`.
2. The MDP's transitions `T_t` are built from `A` and `B`; its decision is weighted by `belief_now`.
3. The hour the MDP recommends selects the expected PM2.5 from the HMM's prediction, and that value
   scales the exposure score of the two A* routes.

## Limits I should state before being asked

- Model output, not sensors: about 40 km per grid cell, peaks are smoothed.
- WHO has no hourly PM2.5 guideline; the cut-points 5 / 15 / 25 are borrowed from the annual and
  24-hour values.
- `r`, the utility numbers and the road index are assumptions.
- QMDP is an approximation.
- Routes cover the city centre only.

## Improvements to mention

Calibrate `r` against street sensors; archive real forecasts for an honest backtest; add wind or the
recent trend to the state; replace QMDP with a small POMDP; use traffic counts or measured NO₂ for the
road index.

## If asked about AI assistance

Answer directly: the code and documents were written with Claude under my direction, and
[`AI-USAGE.md`](AI-USAGE.md) lists what it did and how the result was checked. Then show that I can
explain any part: open `tynys/hmm.py`, `tynys/mdp.py` or `tynys/astar.py` and walk through a function.

## Before the defense

- [ ] Run `python -m tynys.demo --city almaty` and read the whole output once, slowly.
- [ ] Run `python -m unittest discover tests`.
- [ ] Read `tynys/hmm.py` (`bayes_update`, `forward`, `viterbi`), `tynys/mdp.py`
      (`backward_induction`, `qmdp_decision`) and `tynys/astar.py` (`astar`) until I can explain every line.
- [ ] Recompute one Bayes update and one Bellman line by hand from the numbers on the screen.
- [ ] Open the live site on the presentation computer beforehand and keep the offline demo ready.
