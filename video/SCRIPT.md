# Tynys demo video: script

Narration of [`public/demo/tynys-demo.mp4`](../public/demo/tynys-demo.mp4) (4:08), scene by scene.
Times are when each scene starts. The voices are two synthetic ElevenLabs voices; the parts follow
the "Who presents what" table in [`docs/DEFENSE.md`](../docs/DEFENSE.md), so the text can also be read live.

- Video: <https://tynys-blond.vercel.app/demo/tynys-demo.mp4>
- Site: <https://tynys-blond.vercel.app> · How it works: <https://tynys-blond.vercel.app/docs>
- Code: <https://github.com/tairqaldy/tynys>

## 0:00 · Male voice (Tair's part)

This is Tynys, which means breath in Kazakh. It's our final project for AI Fundamentals: a planner that tells you how clean the air is, when to go outside, and which way to walk, in Almaty and Astana.

*On screen:* Title page: Tynys, the four air classes, the course, the three questions, the team.

## 0:14 · Male voice (Tair's part)

The first screen answers all three questions at once. The number in the middle is the model's PM2.5. The coloured ring around it shows how sure we are about each air class, and the strip below covers the last day and the next two, hour by hour.

*On screen:* Planner, Almaty: the PM2.5 gauge with the belief ring, the 24 + 48 hour strip.

## 0:30 · Female voice (Dameli's part)

Each answer comes from a different algorithm we studied in the course. A hidden Markov model reads the air. A Markov decision process picks the hour. And A* search picks the street. Each one hands its result to the next.

*On screen:* The three answer tiles: HMM, MDP, A*.

## 0:47 · Female voice (Dameli's part)

Why a hidden Markov model? Our PM2.5 comes from an atmospheric model on a 40 km grid, not from a sensor on your street. So the real air class is hidden, and each hourly value is only evidence about it. That's lecture 7.

*On screen:* Belief bars, then the last 24 hours: readings and the Viterbi path.

## 1:05 · Female voice (Dameli's part)

This slider is the sensor model: how often the city value matches your street. When we trust it less, the belief spreads out, because the filter leans more on what usually happens at this hour of the day.

*On screen:* The trust slider r moves from 0.80 to 0.60; the 48-hour belief below it.

## 1:19 · Female voice (Dameli's part)

On the How it works page, the same filter runs one step at a time. Feed it a reading and watch it predict with this hour's transition matrix, weigh by the emission probability, then normalise. That's Bayes' rule from lecture 6, every hour.

*On screen:* How it works, Bayes filter lab: an Elevated and a High reading go through predict, weigh, normalise.

## 1:36 · Male voice (Tair's part)

Knowing the air isn't enough: you still have to decide. Go now, wait, or skip. That's a Markov decision process, from lecture 5. The state is the hour and the air class, and the reward is the benefit of going out minus the harm of what you breathe.

*On screen:* When should I go out: the values of go now, wait an hour, skip; when you would probably go.

## 1:54 · Male voice (Tair's part)

Choose outside with a child, and the harm counts double, so the plan gets more careful. These bars are the expected value of each action right now. The biggest one wins.

*On screen:* "Outside with a child" is chosen; the bars change.

## 2:05 · Male voice (Tair's part)

In the lab, press play, and backward induction fills the policy from the deadline back to now. Every cell is one Bellman backup: the reward for going now against the expected value of waiting another hour. The planner then weights this table by the belief from the hidden Markov model.

*On screen:* Backward induction lab: Play fills the policy grid; one cell shows its Bellman backup.

## 2:23 · Female voice (Dameli's part)

Then the route. A* searches the real OpenStreetMap graph of the city centre. A street's cost is its length times an exposure index: a main road counts double, a path through a park counts 0.6.

*On screen:* Which way: the two routes on the map and the share of each street kind.

## 2:39 · Female voice (Dameli's part)

Our heuristic is straight-line distance times 0.6, the smallest index any street has. So it never overestimates, and A* still finds the cheapest route. Replay shows the order it opened the nodes in.

*On screen:* Replay search: A* expansion order on the map, A* against Dijkstra node counts.

## 2:54 · Female voice (Dameli's part)

In the lab, A* races Dijkstra, the uniform cost search from lecture 2, on a toy city. Paint a park or a road, and both still agree on the cost. A* simply wastes less time looking the wrong way.

*On screen:* A* against Dijkstra lab: Least exposure, a major road painted across the route, same cost on both sides.

## 3:10 · Male voice (Tair's part)

We measured all three. On the real street graphs, A* opened 60–82% fewer nodes than Dijkstra, for the same route cost. In Almaty, following the policy beat always going now, for every activity, even without any forecast.

*On screen:* Does it work: nodes expanded per search; points earned per outing in Almaty.

## 3:26 · Female voice (Dameli's part)

And one honest negative result. Over the Almaty test period, the transition tables alone lost to simply assuming nothing changes, because the heating season started in the middle of it. The live app also uses the forecast.

*On screen:* HMM accuracy in Almaty: transition tables against "nothing changes".

## 3:42 · Male voice (Tair's part)

We label every assumption. The values are model estimates, not street sensors, and the exposure index is a traffic proxy, not a measurement. The app compares options; it isn't medical advice.

*On screen:* Assumptions and limits.

## 3:56 · Male voice (Tair's part)

Everything runs on hand-written Python, with no machine learning libraries and 50 tests, and it's live right now. Tynys was built by Tair Kaldybayev and Dameli Kalikhanova. Thanks for watching.

*On screen:* End card: 0 ML libraries, 50 Python tests, 3 algorithms; the site; the team.

Male voice: 8 scenes, female voice: 8 scenes, about two minutes each. Total: 4:08.
