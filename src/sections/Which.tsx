import type { ReactNode } from 'react';
import type { CityMeta, KindMeta, RouteResponse } from '../api/types';
import type { ApiError } from '../api/client';
import { Assumption, QuestionHead, Skeleton } from '../components/common';
import { PlaceField, type RoutePoint } from '../components/PlaceField';
import { RouteCard } from '../components/RouteFacts';
import { routeSentence } from '../lib/copy';
import { km, num } from '../lib/format';
import type { RequestState } from '../lib/hooks';

interface Props {
  city: CityMeta;
  kinds: KindMeta[];
  from: RoutePoint | null;
  to: RoutePoint | null;
  setPoint: (which: 'from' | 'to', p: RoutePoint | null) => void;
  swap: () => void;
  pickTarget: 'from' | 'to';
  setPickTarget: (w: 'from' | 'to') => void;
  req: RequestState<RouteResponse>;
  route: RouteResponse | null;
  atText: string;
  verb: 'walking' | 'running';
  onReplay: () => void;
  onClear: () => void;
  /** sample points of the search currently drawn on the map, null when none */
  shown: number | null;
  example: boolean;
  replaying: boolean;
  pointMsg: string | null;
  onUseExample: () => void;
  onClearPoints: () => void;
  mapSlot: ReactNode;
  mapFailed: string | null;
}

export function Which(p: Props) {
  const { city, route, req } = p;
  const updating = req.loading && route !== null;
  const usePreset = (pl: { lat: number; lon: number; name: string }) => {
    const target = !p.from ? 'from' : !p.to ? 'to' : p.pickTarget;
    p.setPoint(target, { lat: pl.lat, lon: pl.lon, label: pl.name });
  };

  return (
    <section className="q" aria-labelledby="q-which" id="which">
      <QuestionHead n={3} id="q-which" kicker="A* search" title="Which way should I walk?" />

      <div className="route-form">
        <PlaceField
          label="From"
          marker="A"
          city={city.id}
          value={p.from}
          onSelect={(v) => p.setPoint('from', v)}
          onFocus={() => p.setPickTarget('from')}
          picking={p.pickTarget === 'from'}
        />
        <button type="button" className="swap" onClick={p.swap} aria-label="Swap start and destination" disabled={!p.from && !p.to}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M6 3 V15 M6 15 L3 12 M6 15 L9 12 M12 15 V3 M12 3 L9 6 M12 3 L15 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <PlaceField
          label="To"
          marker="B"
          city={city.id}
          value={p.to}
          onSelect={(v) => p.setPoint('to', v)}
          onFocus={() => p.setPickTarget('to')}
          picking={p.pickTarget === 'to'}
        />
      </div>

      <div className="pick-row">
        <span className="pick-row__label" id="pick-label">
          A map click sets
        </span>
        <div className="pick-toggle" role="group" aria-labelledby="pick-label">
          {(['from', 'to'] as const).map((w) => (
            <button key={w} type="button" aria-pressed={p.pickTarget === w} onClick={() => p.setPickTarget(w)}>
              {w === 'from' ? 'A · From' : 'B · To'}
            </button>
          ))}
        </div>
      </div>

      {p.example && (
        <p className="example-note">
          <span className="example-note__tag">Example route</span> pick your own: search, click the map or choose a place
          below.
        </p>
      )}

      {city.places.length > 0 && (
        <div className="presets">
          <span className="presets__label">Places in {city.name}</span>
          <ul>
            {city.places.map((pl) => (
              <li key={pl.id}>
                <button type="button" className="preset" onClick={() => usePreset(pl)}>
                  {pl.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.from && p.to && req.error && !req.loading && (
        <RouteError error={req.error} onRetry={req.retry} onUseExample={p.onUseExample} onClearPoints={p.onClearPoints} />
      )}

      {p.pointMsg && (
        <p className="inline-error" role="alert">
          {p.pointMsg}
        </p>
      )}

      {p.mapSlot}
      {p.mapFailed && <p className="inline-error">{p.mapFailed}</p>}

      {(!p.from || !p.to) && !route && (
        <p className="empty-note">
          Pick a start and a destination inside the dashed outline on the map ({city.name} centre, street graph of{' '}
          <span className="num">{city.graph.nodes.toLocaleString('en-US')}</span> nodes). Tynys finds the shortest walk
          and the one with the least traffic exposure.
        </p>
      )}

      {p.from && p.to && !route && req.loading && <Skeleton lines={3} />}

      {route && p.from && p.to && (
        <div className={`q-body${updating ? ' is-updating' : ''}`} aria-busy={updating}>
          <p className="answer" aria-live="polite">
            {routeSentence(route, p.verb)}
          </p>
          <p className="answer-sub">
            Scored for {route.at_clamped ? 'now' : p.atText} · about <span className="num">{num(route.pm25_at, 1)}</span> µg/m³ expected
          </p>

          <div className={`route-cards${route.comparison.same_route ? ' is-single' : ''}`}>
            <RouteCard kind="cleanest" r={route.cleanest} kinds={p.kinds} highlight />
            {!route.comparison.same_route && <RouteCard kind="shortest" r={route.shortest} kinds={p.kinds} highlight={false} />}
          </div>
          <p className="fineprint">
            <sup>*</sup> PM2.5 × mean exposure index × breathing rate (<span className="num">{num(route.ventilation_m3h, 1)}</span>{' '}
            m³/h) × hours. Only for comparing the two routes, not a dose.
          </p>
          <ReplayControls route={route} shown={p.shown} replaying={p.replaying} onReplay={p.onReplay} onClear={p.onClear} />
          <p className="fineprint">
            Snapped to streets {km(route.from.snap_m)} and {km(route.to.snap_m)} from your points.{' '}
            <Assumption>Street index major road ×2.0 … park path ×0.6 is a traffic proxy, not a measurement.</Assumption>
          </p>
        </div>
      )}
    </section>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US');

function ReplayControls({
  route,
  shown,
  replaying,
  onReplay,
  onClear,
}: {
  route: RouteResponse;
  shown: number | null;
  replaying: boolean;
  onReplay: () => void;
  onClear: () => void;
}) {
  const c = route.cleanest;
  const N = c.explored.length;
  const sampled = N > 0 && N < c.expanded;
  const saved = c.expanded_dijkstra > 0 ? 1 - c.expanded / c.expanded_dijkstra : 0;
  let counter: string | null = null;
  if (shown !== null && N > 0) {
    const done = shown >= N;
    const nodes = done ? c.expanded : sampled ? Math.round((shown / N) * c.expanded) : shown;
    counter = `${done || !sampled ? '' : 'about '}${fmt(nodes)} of ${fmt(c.expanded)} expanded nodes shown`;
  }
  return (
    <div className="replay">
      <div className="replay__row">
        <button type="button" className="btn" onClick={onReplay} disabled={replaying || N === 0}>
          {replaying ? 'Replaying…' : shown !== null ? 'Replay again' : 'Replay search'}
        </button>
        {shown !== null && !replaying && (
          <button type="button" className="btn btn--quiet" onClick={onClear}>
            Clear
          </button>
        )}
        {counter && (
          <span className="replay__counter num" aria-live={replaying ? 'off' : 'polite'}>
            {counter}
          </span>
        )}
      </div>
      <div className="replay__stats">
        <span>
          <b className="num">{fmt(c.expanded)}</b> A* nodes
        </span>
        <span>
          <b className="num">{fmt(c.expanded_dijkstra)}</b> Dijkstra
        </span>
        {saved > 0 && (
          <span>
            <b className="num">−{Math.round(saved * 100)}%</b> work, same answer
          </span>
        )}
      </div>
      {sampled && (
        <p className="replay__note">
          The map replays <span className="num">{fmt(N)}</span> of them in expansion order; darker dots are the frontier.
        </p>
      )}
    </div>
  );
}

/** Problems with the chosen points: the API's own message plus how to fix it. */
const FIXES: Record<string, string> = {
  outside_area: 'Move the point inside the dashed outline on the map, or choose a place below.',
  far_from_streets: 'Move the point onto or next to a street or path.',
  too_far: 'Pick two points closer together — at most 12 km apart in a straight line.',
  same_point: 'Pick two different places.',
  no_route: 'Move one of the points to a nearby street; this pair is not connected by walkable ways.',
  bad_point: 'Pick the point again: search, click the map or choose a place below.',
};

function RouteError({
  error,
  onRetry,
  onUseExample,
  onClearPoints,
}: {
  error: ApiError;
  onRetry: () => void;
  onUseExample: () => void;
  onClearPoints: () => void;
}) {
  const fix = FIXES[error.code];
  if (fix) {
    return (
      <div className="route-error" role="alert">
        <p className="route-error__msg">{error.message}</p>
        <p className="route-error__fix">{fix}</p>
        <div className="route-error__actions">
          <button type="button" className="btn btn--quiet" onClick={onClearPoints}>
            Clear both points
          </button>
          <button type="button" className="btn btn--quiet" onClick={onUseExample}>
            Show the example route
          </button>
        </div>
      </div>
    );
  }
  // not caused by the points: network, server, or a request the page built wrongly
  return (
    <div className="route-error" role="alert">
      <p className="route-error__msg">The route could not be computed this time.</p>
      <p className="route-error__fix">{error.message}</p>
      <div className="route-error__actions">
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="btn btn--quiet" onClick={onUseExample}>
          Show the example route
        </button>
      </div>
    </div>
  );
}
