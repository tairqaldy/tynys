import type { AirResponse, PlanResponse, RouteResponse } from '../api/types';
import { CLASS_IDS, CLASS_LABEL, argmax, classFill, classPattern } from '../lib/classes';
import { nowSentence } from '../lib/copy';
import { hhmm, hourOf, num, pct, relTime } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';
import { useTween, useTweenVec } from '../lib/motion';
import { Skeleton } from '../components/common';

interface Props {
  air: AirResponse | null;
  plan: PlanResponse | null;
  route: RouteResponse | null;
  cityName: string;
  airError: boolean;
}

/** The first screen: the air now as a breathing gauge, and the three answers in one row. */
export function Overview({ air, plan, route, cityName, airError }: Props) {
  if (!air) {
    return (
      <section className="overview" aria-label="Summary" id="top">
        {airError ? null : <Skeleton hero lines={2} chart={90} />}
      </section>
    );
  }
  const s = nowSentence(cityName, air.hmm.belief_now);
  const k = air.hmm.state_now;
  const c = air.current;
  return (
    <section className="overview" aria-label="Summary" id="top" data-c={CLASS_IDS[k]}>
      <div className="ov-head">
        <AirOrb pm={c.pm25} belief={air.hmm.belief_now} k={k} />
        <div className="ov-head__text">
          <p className="ov-meta">
            <span className="ov-live" aria-hidden="true" />
            {cityName} · model reading at {hhmm(air.now)}
          </p>
          <h1 className="ov-sentence">
            {s.lead}
            <em>{s.word}</em>
            {s.tail}
          </h1>
          <p className="ov-sub">
            {s.hedge ?? `${pct(air.hmm.belief_now[k])} sure`}
            {c.pm10 !== null && Number.isFinite(c.pm10) && (
              <>
                {' · '}PM10 <span className="num">{num(c.pm10, 0)}</span>
              </>
            )}
            {air.weather && (
              <>
                {' · '}wind <span className="num">{num(air.weather.wind_kmh, 0)}</span> km/h · <span className="num">{num(air.weather.temp_c, 0)}</span> °C
              </>
            )}
          </p>
        </div>
      </div>

      <Ribbon air={air} />

      <ol className="answers">
        <Answer n={1} href="#now" algo="HMM" k="Air now" v={CLASS_LABEL[k]} sub={`${pct(air.hmm.belief_now[k])} likely`} c={CLASS_IDS[k]} />
        <Answer n={2} href="#when" algo="MDP" k="When to go" {...planAnswer(plan)} />
        <Answer n={3} href="#which" algo="A*" k="Which way" {...routeAnswer(route)} />
      </ol>
    </section>
  );
}

function planAnswer(plan: PlanResponse | null): { v: string; sub: string } {
  if (!plan) return { v: '…', sub: 'planning' };
  const d = plan.decision;
  const margin = `+${num(Math.abs(d.q_go - d.q_wait), 2)} points`;
  if (d.action === 'go') return { v: 'Go now', sub: `${margin} over waiting` };
  if (d.action === 'skip') return { v: 'Skip today', sub: `harm outweighs the benefit` };
  if (d.best_time) return { v: `Wait · ${relTime(d.best_time, plan.now)}`, sub: `${margin} over going now` };
  return { v: 'Wait', sub: `${margin} over going now` };
}

function routeAnswer(route: RouteResponse | null): { v: string; sub: string } {
  if (!route) return { v: '…', sub: 'pick two points' };
  const c = route.comparison;
  if (c.same_route) return { v: 'Shortest is cleanest', sub: `${num(route.cleanest.distance_m / 1000, 1)} km · ${Math.round(route.cleanest.minutes)} min` };
  return {
    v: `−${Math.round(c.exposure_reduction_pct)}% exposure`,
    sub: c.extra_minutes >= 0.5 ? `+${Math.round(c.extra_minutes)} min on foot` : 'about the same distance',
  };
}

function Answer({ n, href, algo, k, v, sub, c }: { n: number; href: string; algo: string; k: string; v: string; sub: string; c?: string }) {
  return (
    <li className="answer-tile" data-c={c}>
      <a href={href}>
        <span className="answer-tile__top">
          <span className="answer-tile__n">{n}</span>
          <span className="answer-tile__algo">{algo}</span>
        </span>
        <span className="answer-tile__k">{k}</span>
        <span className="answer-tile__v">{v}</span>
        <span className="answer-tile__sub">{sub}</span>
      </a>
    </li>
  );
}

/**
 * A ring of four arcs (the belief) around a softly breathing disc in the colour of the
 * most likely class, with the model PM2.5 in the middle.
 */
function AirOrb({ pm, belief, k }: { pm: number; belief: readonly number[]; k: number }) {
  const reduced = useReducedMotion();
  const pmT = useTween(pm, 900);
  const b = useTweenVec(belief, 900);
  const R = 92;
  const C = 2 * Math.PI * R;
  const gap = 3;
  let acc = 0;
  const arcs = b.map((p, i) => {
    const len = Math.max(0, p * C - (p > 0.01 ? gap : 0));
    const a = { i, len, off: acc };
    acc += p * C;
    return a;
  });
  return (
    <div className={`orb${reduced ? '' : ' orb--live'}`} role="img" aria-label={`Model PM2.5 ${num(pm, 1)} micrograms per cubic metre; most likely class ${CLASS_LABEL[k]} at ${pct(belief[k])}.`}>
      <svg viewBox="0 0 220 220" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="orb-fill" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor={classFill(k)} stopOpacity="0.55" />
            <stop offset="70%" stopColor={classFill(k)} stopOpacity="0.18" />
            <stop offset="100%" stopColor={classFill(k)} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="orb__halo" cx="110" cy="110" r="104" fill="url(#orb-fill)" />
        <circle className="orb__disc" cx="110" cy="110" r="76" fill={classFill(k)} />
        <circle className="orb__disc" cx="110" cy="110" r="76" fill={classPattern(k)} opacity="0.5" />
        <circle cx="110" cy="110" r={R} fill="none" className="orb__track" strokeWidth="6" />
        <g transform="rotate(-90 110 110)">
          {arcs.map((a) =>
            a.len > 0.5 ? (
              <circle
                key={a.i}
                cx="110"
                cy="110"
                r={R}
                fill="none"
                stroke={classFill(a.i)}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${a.len} ${C}`}
                strokeDashoffset={-a.off}
              />
            ) : null,
          )}
        </g>
      </svg>
      <div className="orb__center" data-c={CLASS_IDS[k]}>
        <span className="orb__pm num">{num(pmT, 1)}</span>
        <span className="orb__unit">µg/m³ PM2.5</span>
      </div>
    </div>
  );
}

/** 24 past hours (the reading's class) and the predicted hours (most likely class), one cell per hour. */
function Ribbon({ air }: { air: AirResponse }) {
  const past = air.readings.slice(-24);
  const future = air.hmm.predicted;
  const cells = [
    ...past.map((r) => ({ t: r.time, c: r.band, p: 1, past: true, pm: r.pm25 })),
    ...future.map((h) => {
      const c = argmax(h.belief);
      return { t: h.time, c, p: h.belief[c], past: false, pm: h.expected_pm25 };
    }),
  ];
  const nowIdx = past.length - 1;
  return (
    <figure className="ribbon">
      <div className="ribbon__labels" aria-hidden="true">
        <span>last 24 h</span>
        <span className="ribbon__now-l" style={{ left: `${((nowIdx + 0.5) / cells.length) * 100}%` }}>
          now
        </span>
        <span>next {future.length} h</span>
      </div>
      <div className="ribbon__cells" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((x, i) => (
          <span
            key={x.t}
            className={`ribbon__cell${x.past ? '' : ' is-future'}${i === nowIdx ? ' is-now' : ''}`}
            data-c={CLASS_IDS[x.c]}
            style={{ ['--p' as string]: x.past ? 1 : 0.35 + 0.65 * x.p, ['--i' as string]: i }}
            title={`${hhmm(x.t)} · ${CLASS_LABEL[x.c]}${x.past ? '' : ` (${pct(x.p)})`} · ${num(x.pm, 1)} µg/m³`}
          />
        ))}
      </div>
      <div className="ribbon__ticks" aria-hidden="true">
        {cells.map((x, i) =>
          hourOf(x.t) % 6 === 0 ? (
            <span key={x.t} style={{ left: `${((i + 0.5) / cells.length) * 100}%` }}>
              {hhmm(x.t)}
            </span>
          ) : null,
        )}
      </div>
      <figcaption className="sr-only">
        Air class for the last {past.length} hours and the most likely class for the next {future.length} hours.
      </figcaption>
    </figure>
  );
}
