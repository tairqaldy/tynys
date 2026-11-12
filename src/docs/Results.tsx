import { useState } from 'react';
import type { CityId } from '../api/types';
import { SrTable } from '../components/common';
import { useInView } from '../lib/motion';

// Numbers from docs/evaluation.md (python -m tynys.evaluate, run of 10 Nov 2026, last 14 days as the test period).

const ASTAR = [
  { city: 'Astana', search: 'Shortest', astar: 5377, dijkstra: 30585 },
  { city: 'Astana', search: 'Lower exposure', astar: 12415, dijkstra: 31442 },
  { city: 'Almaty', search: 'Shortest', astar: 4958, dijkstra: 26248 },
  { city: 'Almaty', search: 'Lower exposure', astar: 9615, dijkstra: 25339 },
];

type Backtest = { activity: string; always: number; policy: number; perfect: number; oracle: number };
const MDP: Record<CityId, Backtest[]> = {
  astana: [
    { activity: 'Walk', always: 3.367, policy: 3.569, perfect: 3.82, oracle: 3.857 },
    { activity: 'Run', always: 4.372, policy: 5.14, perfect: 5.84, oracle: 5.885 },
    { activity: 'With a child', always: 1.646, policy: 3.164, perfect: 3.716, oracle: 3.785 },
    { activity: 'Errand', always: 4.912, policy: 4.905, perfect: 5.106, oracle: 5.129 },
  ],
  almaty: [
    { activity: 'Walk', always: -0.017, policy: 1.247, perfect: 1.797, oracle: 1.846 },
    { activity: 'Run', always: -3.148, policy: 1.12, perfect: 2.114, oracle: 2.177 },
    { activity: 'With a child', always: -7.378, policy: 0.378, perfect: 0.882, oracle: 0.961 },
    { activity: 'Errand', always: 2.655, policy: 2.744, perfect: 3.368, oracle: 3.458 },
  ],
};

const HMM: Record<CityId, { lead: number; model: number; persistence: number }[]> = {
  astana: [
    { lead: 1, model: 88.4, persistence: 88.4 },
    { lead: 3, model: 67.3, persistence: 69.1 },
    { lead: 6, model: 62.1, persistence: 54.5 },
  ],
  almaty: [
    { lead: 1, model: 81.8, persistence: 81.8 },
    { lead: 3, model: 51.1, persistence: 55.6 },
    { lead: 6, model: 19.4, persistence: 37.0 },
  ],
};

const fmt = (n: number) => n.toLocaleString('en-US');
const sign = (x: number, d = 2) => (x < 0 ? `−${Math.abs(x).toFixed(d)}` : x.toFixed(d));

export function Results({ city }: { city: CityId }) {
  return (
    <div className="results">
      <AstarChart />
      <MdpChart city={city} />
      <HmmChart city={city} />
    </div>
  );
}

function Card({ n, title, take, children }: { n: string; title: string; take: string; children: React.ReactNode }) {
  const [ref, seen] = useInView<HTMLElement>();
  return (
    <article ref={ref} className={`rcard${seen ? ' is-in' : ''}`}>
      <p className="rcard__n">{n}</p>
      <h3 className="rcard__title">{title}</h3>
      <p className="rcard__take">{take}</p>
      {children}
    </article>
  );
}

function AstarChart() {
  const max = Math.max(...ASTAR.map((r) => r.dijkstra));
  return (
    <Card n="A*" title="Nodes expanded per search" take="A* opens 60–82% fewer nodes than Dijkstra and finds the same cost every time.">
      <div className="legend" aria-hidden="true">
        <span className="legend__i">
          <span className="legend__sw legend__sw--a" /> A*
        </span>
        <span className="legend__i">
          <span className="legend__sw legend__sw--b" /> Dijkstra
        </span>
      </div>
      <div className="hbars" aria-hidden="true">
        {ASTAR.map((r, k) => {
          const saved = Math.round((1 - r.astar / r.dijkstra) * 100);
          return (
            <div className="hbars__group" key={k} title={`${r.city}, ${r.search}: A* ${fmt(r.astar)}, Dijkstra ${fmt(r.dijkstra)}`}>
              <p className="hbars__label">
                {r.city} <span>· {r.search.toLowerCase()}</span>
                <b className="hbars__saved">−{saved}%</b>
              </p>
              <div className="hbars__row">
                <span className="hbars__bar hbars__bar--a" style={{ ['--w' as string]: `${(r.astar / max) * 100}%`, ['--d' as string]: `${k * 90}ms` }} />
                <span className="hbars__v num">{fmt(r.astar)}</span>
              </div>
              <div className="hbars__row">
                <span className="hbars__bar hbars__bar--b" style={{ ['--w' as string]: `${(r.dijkstra / max) * 100}%`, ['--d' as string]: `${k * 90 + 45}ms` }} />
                <span className="hbars__v num">{fmt(r.dijkstra)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="rcard__foot">Mean of 30 random trips per city, 1–6 km apart.</p>
      <SrTable
        caption="Mean nodes expanded, A* against Dijkstra"
        head={['Search', 'A*', 'Dijkstra', 'Saved']}
        rows={ASTAR.map((r) => [`${r.city}, ${r.search}`, r.astar, r.dijkstra, `${Math.round((1 - r.astar / r.dijkstra) * 100)}%`])}
      />
    </Card>
  );
}

const SERIES = [
  { key: 'always', label: 'Always go now' },
  { key: 'policy', label: 'Policy, no forecast' },
  { key: 'perfect', label: 'Policy, perfect forecast' },
  { key: 'oracle', label: 'Oracle' },
] as const;

function MdpChart({ city }: { city: CityId }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = MDP[city];
  const all = rows.flatMap((r) => [r.always, r.policy, r.perfect, r.oracle]);
  const lo = Math.floor(Math.min(...all, 0));
  const hi = Math.ceil(Math.max(...all));
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((t) => (hi - lo > 8 ? t % 2 === 0 : true));
  const cityName = city === 'almaty' ? 'Almaty' : 'Astana';
  return (
    <Card
      n="MDP"
      title={`Points earned per outing · ${cityName}`}
      take={
        city === 'almaty'
          ? 'Following the policy beats “always go now” for every activity, even without any forecast.'
          : 'In cleaner Astana there is less to gain; for an errand that cannot be skipped the plain policy ties “go now”.'
      }
    >
      <div className="legend" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className={`legend__i${hover && hover !== s.key ? ' is-dim' : ''}`} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
            <span className={`dot dot--${s.key}`} /> {s.label}
          </span>
        ))}
      </div>
      <div className="dots" aria-hidden="true">
        {rows.map((r, k) => (
          <div className="dots__row" key={r.activity}>
            <span className="dots__label">{r.activity}</span>
            <span className="dots__track">
              <span className="dots__zero" style={{ left: `${x(0)}%` }} />
              <span className="dots__span" style={{ left: `${x(Math.min(r.always, r.policy))}%`, width: `${Math.abs(x(r.policy) - x(r.always))}%`, ['--d' as string]: `${k * 80}ms` }} />
              {SERIES.map((s) => (
                <span
                  key={s.key}
                  className={`dot dot--${s.key}${hover && hover !== s.key ? ' is-dim' : ''}`}
                  style={{ left: `${x(r[s.key])}%`, ['--d' as string]: `${k * 80}ms` }}
                  title={`${r.activity}: ${s.label} ${sign(r[s.key], 3)}`}
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </span>
          </div>
        ))}
        <div className="dots__axis">
          <span className="dots__label" />
          <span className="dots__track dots__track--axis">
            {ticks.map((t) => (
              <span key={t} className="dots__tick num" style={{ left: `${x(t)}%` }}>
                {sign(t, 0)}
              </span>
            ))}
          </span>
        </div>
      </div>
      <p className="rcard__foot">Every hour of a 14-day test period replayed as “now”; realised utility points, higher is better.</p>
      <SrTable
        caption={`MDP backtest, ${cityName}`}
        head={['Activity', ...SERIES.map((s) => s.label)]}
        rows={rows.map((r) => [r.activity, r.always, r.policy, r.perfect, r.oracle])}
      />
    </Card>
  );
}

function HmmChart({ city }: { city: CityId }) {
  const rows = HMM[city];
  const cityName = city === 'almaty' ? 'Almaty' : 'Astana';
  return (
    <Card
      n="HMM"
      title={`Predicting the class k hours ahead · ${cityName}`}
      take={
        city === 'almaty'
          ? 'An honest negative result: the heating season started inside the test period, so the tables alone lose to “nothing changes”. The app also uses the forecast.'
          : 'The tables alone tie “nothing changes” one hour ahead, lose slightly at three hours and win at six (62% against 55%).'
      }
    >
      <div className="legend" aria-hidden="true">
        <span className="legend__i">
          <span className="legend__sw legend__sw--a" /> Transition tables
        </span>
        <span className="legend__i">
          <span className="legend__sw legend__sw--b" /> “Nothing changes”
        </span>
      </div>
      <div className="vbars" aria-hidden="true">
        {rows.map((r, k) => (
          <div className="vbars__group" key={r.lead} title={`${r.lead} h ahead: tables ${r.model}%, persistence ${r.persistence}%`}>
            <div className="vbars__pair">
              <span className="vbars__col">
                <span className="vbars__v num">{Math.round(r.model)}</span>
                <span className="vbars__bar vbars__bar--a" style={{ ['--h' as string]: `${r.model}%`, ['--d' as string]: `${k * 90}ms` }} />
              </span>
              <span className="vbars__col">
                <span className="vbars__v num">{Math.round(r.persistence)}</span>
                <span className="vbars__bar vbars__bar--b" style={{ ['--h' as string]: `${r.persistence}%`, ['--d' as string]: `${k * 90 + 45}ms` }} />
              </span>
            </div>
            <span className="vbars__x">{r.lead} h</span>
          </div>
        ))}
      </div>
      <p className="rcard__foot">Accuracy in %, 330–335 test hours per lead.</p>
      <SrTable
        caption={`HMM accuracy, ${cityName}`}
        head={['Lead', 'Transition tables', 'Persistence']}
        rows={rows.map((r) => [`${r.lead} h`, `${r.model}%`, `${r.persistence}%`])}
      />
    </Card>
  );
}
