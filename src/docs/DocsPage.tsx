import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { ActivityId, CityId } from '../api/types';
import { ClassPatterns } from '../components/common';
import { Header } from '../components/Header';
import { useDebounced, useRequest } from '../lib/hooks';
import { useInView } from '../lib/motion';
import type { Navigate } from '../lib/route';
import { load, save } from '../lib/storage';
import { useTheme } from '../lib/theme';
import { AstarLab } from './AstarLab';
import { Flow } from './Flow';
import { HmmLab } from './HmmLab';
import { MdpLab } from './MdpLab';
import { Results } from './Results';
import '../styles/docs.css';

const CITIES: { id: CityId; name: string }[] = [
  { id: 'astana', name: 'Astana' },
  { id: 'almaty', name: 'Almaty' },
];

const DURATION: Record<ActivityId, number> = { walk: 45, run: 40, kids: 60, errand: 30 };

export interface DocPlanParams {
  activity: ActivityId;
  waitCost: number;
  deadline: number;
}

const TOC = [
  { id: 'overview', label: 'Overview' },
  { id: 'hmm', label: 'HMM' },
  { id: 'mdp', label: 'MDP' },
  { id: 'astar', label: 'A*' },
  { id: 'results', label: 'Results' },
  { id: 'limits', label: 'Limits' },
  { id: 'team', label: 'Team' },
];

const REPO = 'https://github.com/tairqaldy/tynys';

export default function DocsPage({ navigate }: { navigate: Navigate }) {
  const [theme, toggleTheme] = useTheme();
  const [city, setCityState] = useState<CityId>(() => (load('tynys.city') === 'almaty' ? 'almaty' : 'astana'));
  const setCity = (c: CityId) => {
    setCityState(c);
    save('tynys.city', c);
  };

  useEffect(() => {
    document.title = 'How Tynys works — HMM, MDP and A* on live air data';
    delete document.documentElement.dataset.air;
  }, []);

  const airReq = useRequest(`docs|${city}`, (s) => api.air(city, 0.8, s));
  const air = airReq.data && airReq.data.city === city ? airReq.data : null;

  const [params, setParamsState] = useState<DocPlanParams>({ activity: 'walk', waitCost: 0.3, deadline: 8 });
  const setParams = (p: Partial<DocPlanParams>) => setParamsState((old) => ({ ...old, ...p }));
  const planKey = useDebounced(JSON.stringify({ city, ...params }), 300);
  const planReq = useRequest(planKey, (s) => {
    const k = JSON.parse(planKey) as { city: CityId } & DocPlanParams;
    return api.plan(
      {
        city: k.city,
        activity: k.activity,
        duration: DURATION[k.activity],
        deadline: k.deadline,
        wait_cost: k.waitCost,
        sensitive: k.activity === 'kids',
        reliability: 0.8,
      },
      s,
    );
  });
  const plan = planReq.data && planReq.data.city === city ? planReq.data : null;
  const active = useScrollSpy(TOC.map((t) => t.id));

  return (
    <>
      <ClassPatterns />
      <Header page="docs" navigate={navigate} city={city} setCity={setCity} cities={CITIES} theme={theme} toggleTheme={toggleTheme} />
      <nav className="subnav" aria-label="On this page">
        <ul>
          {TOC.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} aria-current={active === t.id ? 'true' : undefined}>
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main id="main" className="docs" tabIndex={-1}>
        <header className="dhero" id="overview">
          <p className="eyebrow">How it works</p>
          <h1 className="dhero__title">
            How Tynys reads the air, picks the hour and finds a <em>quieter</em> street.
          </h1>
          <p className="dhero__lede">
            Three course algorithms, written by hand in Python and run on live data for Astana and Almaty. Each hands its
            answer to the next, and each has a lab below that you can play with.
          </p>
          <Flow air={air} plan={plan} />
          <dl className="facts-row">
            <Fact v="92" unit="days" k="of hourly PM2.5 per city teach the transition tables" />
            <Fact v="139k" unit="nodes" k="in the walkable street graphs of Astana and Almaty" />
            <Fact v="50" unit="tests" k="run offline: textbook HMM, hand-solved MDP, A* = Dijkstra" />
            <Fact v="0" unit="ML libraries" k="the three algorithms are written by hand in plain Python" />
          </dl>
        </header>

        <DocSection
          id="hmm"
          n={1}
          topic="Probabilistic reasoning"
          title="Hidden Markov model"
          question="How is the air right now?"
          why="The true air class on your street is never observed: only a 40 km model value that is often off. A hidden state seen through noisy readings is exactly what an HMM describes."
          steps={[
            { k: 'Hidden state', v: <>the class where you stand: <b>low · moderate · elevated · high</b></> },
            { k: 'Reading', v: <>the class of the city-wide value, right with probability <span className="f">r</span> = 0.8</> },
            { k: 'Predict', v: <span className="f">b̄ = b · A<sub>block</sub></span> },
            { k: 'Update', v: <span className="f">b′ ∝ b̄ ⊙ B[·, o]</span> },
            { k: 'Viterbi', v: 'the single most likely sequence of classes over the last 24 h' },
          ]}
          io={['24 readings · 4 time-of-day tables · emission matrix', 'belief now · belief for the next 48 h']}
        >
          <HmmLab air={air} />
        </DocSection>

        <DocSection
          id="mdp"
          n={2}
          topic="Sequential decision making"
          title="Markov decision process"
          question="When should I go out?"
          why="Waiting has a cost and the future air is uncertain, so the best choice now depends on every choice after it. Backward induction solves that exactly for a finite horizon."
          steps={[
            { k: 'State', v: <>(hour <span className="f">t</span>, class <span className="f">s</span>)</> },
            { k: 'Actions', v: 'go · wait an hour · skip' },
            { k: 'Go', v: <span className="f">R(s) = benefit − harm[s] · hours · intensity</span> },
            { k: 'Wait', v: <span className="f">Q = −c + Σ T(s, s′) · V<sub>t+1</sub>(s′)</span> },
            { k: 'Now', v: <>weight each action's Q by the HMM belief and take the largest</> },
          ]}
          io={['HMM belief and tables · activity · deadline · waiting cost', 'go now, wait until a given hour, or skip']}
        >
          <MdpLab plan={plan} loading={planReq.loading} params={params} setParams={setParams} />
        </DocSection>

        <DocSection
          id="astar"
          n={3}
          topic="Search"
          title="A* search"
          question="Which way should I walk?"
          why="Tens of thousands of street nodes per city: A* finds the same optimal route as Dijkstra while opening far fewer of them, because the heuristic points it at the goal."
          steps={[
            { k: 'Graph', v: 'every walkable OpenStreetMap way in the city centre' },
            { k: 'Shortest', v: <span className="f">cost = length</span> },
            { k: 'Lower exposure', v: <span className="f">cost = length × index</span> },
            { k: 'Index', v: 'major road 2.0 · residential 1.0 · park path 0.6' },
            { k: 'Heuristic', v: <><span className="f">h = 0.6 × straight-line distance</span>, never too high</> },
          ]}
          io={['two points · street graph · PM2.5 at the planned hour', 'shortest route and lower-exposure route']}
        >
          <AstarLab />
        </DocSection>

        <section className="doc-block" id="results" aria-labelledby="results-h">
          <BlockHead kicker="Evaluation" title="Does it work?" id="results-h" />
          <Results city={city} />
          <p className="doc-note">
            Full method and tables: <a href={`${REPO}/blob/main/docs/evaluation.md`}>docs/evaluation.md</a>, regenerated by{' '}
            <code>python -m tynys.evaluate</code>.
          </p>
        </section>

        <section className="doc-block" id="limits" aria-labelledby="limits-h">
          <BlockHead kicker="Honest about it" title="Assumptions and limits" id="limits-h" />
          <ul className="limits">
            <Limit t="Model, not sensors" d="PM2.5 comes from the CAMS model on a ~40 km grid. It smooths street-level peaks." />
            <Limit t="Hand-set trust" d="The reading trust r = 0.8 and the forecast trust are settings, not fitted." />
            <Limit t="Utility points" d="Benefit, harm 0 / 1 / 4 / 10 per hour and the waiting cost are chosen by hand." />
            <Limit t="QMDP shortcut" d="The action now assumes the class becomes known after one step." />
            <Limit t="Exposure is a proxy" d="Street kind and a 25 m roadside rule stand in for traffic pollution." />
            <Limit t="WHO bands, hourly" d="Cut-points 5 / 15 / 25 µg/m³ come from daily and annual WHO guidance." />
          </ul>
          <p className="doc-note">Not medical advice. With a health condition, follow your doctor and official alerts.</p>
        </section>

        <section className="doc-block" id="team" aria-labelledby="team-h">
          <BlockHead kicker="AIF1303 AI Fundamentals · final project · QAIRU 2026" title="Team" id="team-h" />
          <ul className="team">
            <Person name="Tair Kaldybayev" handle="tairqaldy" initials="TK" />
            <Person name="Dameli Kalikhanova" handle="dameo111" initials="DK" />
          </ul>
          <div className="colophon-grid">
            <div>
              <h3>Source</h3>
              <p>
                <a href={REPO}>github.com/tairqaldy/tynys</a> · Python 3.12 standard library for the algorithms, React and
                MapLibre for this site.
              </p>
            </div>
            <div>
              <h3>Data</h3>
              <p>
                <a href="https://open-meteo.com/">Open-Meteo</a> (CAMS, CC BY 4.0) · ©{' '}
                <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ·{' '}
                <a href="https://photon.komoot.io/">Photon</a> · <a href="https://openfreemap.org/">OpenFreeMap</a>
              </p>
            </div>
            <div>
              <h3>AI assistance</h3>
              <p>
                Built with substantial help from Claude (Anthropic). What it did and how the result was checked:{' '}
                <a href={`${REPO}/blob/main/docs/AI-USAGE.md`}>docs/AI-USAGE.md</a>.
              </p>
            </div>
          </div>
          <a
            className="cta"
            href="/"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              navigate('planner');
            }}
          >
            Open the planner <span aria-hidden="true">→</span>
          </a>
        </section>
      </main>
    </>
  );
}

function Fact({ v, unit, k }: { v: string; unit: string; k: string }) {
  return (
    <div className="fact">
      <dt>
        <span className="fact__v">{v}</span> <span className="fact__unit">{unit}</span>
      </dt>
      <dd>{k}</dd>
    </div>
  );
}

function BlockHead({ kicker, title, id }: { kicker: string; title: string; id: string }) {
  return (
    <header className="block-head">
      <p className="eyebrow">{kicker}</p>
      <h2 id={id}>{title}</h2>
    </header>
  );
}

function DocSection({
  id,
  n,
  topic,
  title,
  question,
  why,
  steps,
  io,
  children,
}: {
  id: string;
  n: number;
  topic: string;
  title: string;
  question: string;
  why: string;
  steps: { k: string; v: ReactNode }[];
  io: [string, string];
  children: ReactNode;
}) {
  const [ref, seen] = useInView<HTMLElement>();
  return (
    <section ref={ref} className={`algo${seen ? ' is-in' : ''}`} id={id} aria-labelledby={`${id}-h`}>
      <div className="algo__text">
        <p className="algo__topic">
          <span className="algo__n">{n}</span> {topic}
        </p>
        <h2 className="algo__title" id={`${id}-h`}>
          {title}
        </h2>
        <p className="algo__q">{question}</p>
        <dl className="algo__steps">
          {steps.map((s) => (
            <div key={s.k}>
              <dt>{s.k}</dt>
              <dd>{s.v}</dd>
            </div>
          ))}
        </dl>
        <div className="algo__io">
          <p>
            <span className="algo__io-k">in</span> {io[0]}
          </p>
          <p>
            <span className="algo__io-k">out</span> {io[1]}
          </p>
        </div>
        <p className="algo__why">
          <span className="algo__why-k">Why this algorithm</span> {why}
        </p>
      </div>
      <div className="algo__lab">{children}</div>
    </section>
  );
}

function Limit({ t, d }: { t: string; d: string }) {
  return (
    <li className="limit">
      <p className="limit__t">{t}</p>
      <p className="limit__d">{d}</p>
    </li>
  );
}

function Person({ name, handle, initials }: { name: string; handle: string; initials: string }) {
  return (
    <li className="person">
      <span className="person__av" aria-hidden="true">
        {initials}
      </span>
      <span className="person__name">{name}</span>
      <a className="person__gh" href={`https://github.com/${handle}`}>
        @{handle}
      </a>
    </li>
  );
}

/** The id of the section nearest the top of the viewport. */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join('|');
  useEffect(() => {
    const list = key.split('|');
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = 140;
        let cur = list[0];
        for (const id of list) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= line) cur = id;
        }
        setActive(cur);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [key]);
  return active;
}
