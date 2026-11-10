// Development-only mock responses. Loaded lazily by the API client when ?mock=1 is set or the dev
// API is unreachable. The page shows a "Mock data" badge whenever these are on screen.
// The JSON files are copies of the backend's fixtures/ (real responses saved on 2026-11-10). They are
// static: air ignores the trust setting and plan only varies by city and activity. A route request
// returns the saved route when the points are near its endpoints; for other points a clearly fake
// route is drawn between the two points so the interface stays usable offline.

import type { LatLon, MetaResponse, PlacesResponse, RouteResponse } from '../api/types';
import metaJson from './meta.json';

const meta = metaJson as unknown as MetaResponse;

type Query = Record<string, string | number | boolean | undefined>;

const files = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const file = (name: string): unknown => files[`./${name}.json`];

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

class MockError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function mockResponse(name: string, q: Query, signal?: AbortSignal): Promise<unknown> {
  await delay(name === 'places' ? 120 : 350, signal);
  const city = String(q.city ?? 'astana');
  switch (name) {
    case 'meta':
      return meta;
    case 'air':
      return file(`air_${city}`);
    case 'plan':
      return file(`plan_${city}_${String(q.activity ?? 'walk')}`) ?? file(`plan_${city}_walk`);
    case 'places':
      return places(city, String(q.q ?? ''));
    case 'route':
      return route(city, String(q.from), String(q.to), String(q.activity ?? 'walk'), q.at as string | undefined);
    default:
      throw new MockError('not_found', `Unknown endpoint ${name}`, 404);
  }
}

function places(city: string, q: string): PlacesResponse {
  const c = meta.cities.find((x) => x.id === city);
  const needle = q.trim().toLowerCase();
  const saved = file(`places_${city}`) as PlacesResponse | undefined;
  const fromSaved = (saved?.results ?? []).filter((r) => `${r.name} ${r.detail}`.toLowerCase().includes(needle));
  if (fromSaved.length) return { results: fromSaved };
  const results = (c?.places ?? [])
    .filter((p) => p.name.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((p) => ({ name: p.name, detail: `${c?.name ?? ''} (mock)`, lat: p.lat, lon: p.lon }));
  return { results };
}

const R = 6371008.8;
function hav(a: LatLon, b: LatLon): number {
  const toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR;
  const dLon = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function lerp(a: LatLon, b: LatLon, t: number): LatLon {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function polyLen(c: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += hav(c[i - 1], c[i]);
  return s;
}

function route(city: string, from: string, to: string, activity: string, at?: string): RouteResponse {
  const c = meta.cities.find((x) => x.id === city)!;
  const a = from.split(',').map(Number) as LatLon;
  const b = to.split(',').map(Number) as LatLon;
  const [s, w, n, e] = c.bbox;
  const inside = (p: LatLon) => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
  if (!inside(a) || !inside(b)) {
    throw new MockError('outside_coverage', 'One of the points is outside the area covered by the street graph.');
  }
  const straight = hav(a, b);
  if (straight < 30) throw new MockError('too_close', 'Start and destination are the same place.');
  const saved = file(`route_${city}`) as RouteResponse | undefined;
  if (saved) {
    const near = (p: LatLon, q: { lat: number; lon: number }) => hav(p, [q.lat, q.lon]) < 300;
    if (near(a, saved.from) && near(b, saved.to)) return saved;
    if (near(a, saved.to) && near(b, saved.from)) return saved;
  }
  // shortest: an L-shaped path; cleanest: bends away through a perpendicular detour.
  const shortest: LatLon[] = [a, [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2], b];
  const mid = lerp(a, b, 0.5);
  const perp: LatLon = [-(b[1] - a[1]) * 0.18, (b[0] - a[0]) * 0.18];
  const detour: LatLon = [mid[0] + perp[0], mid[1] + perp[1]];
  const cleanest: LatLon[] = [a, lerp(a, detour, 0.5), detour, lerp(detour, b, 0.5), b];
  const speed = activity === 'run' ? 160 : 80;
  const vent = activity === 'run' ? 3.0 : 1.2;
  const pm = 7.1;
  const mk = (coords: LatLon[], mean: number, byKind: Record<string, number>, exp: number, dij: number) => {
    const d = Math.round(polyLen(coords));
    const minutes = Math.round((d / speed) * 10) / 10;
    return {
      coords,
      distance_m: d,
      minutes,
      weighted_cost: Math.round(d * mean),
      mean_index: mean,
      exposure_score: Math.round(pm * mean * vent * (minutes / 60) * 10) / 10,
      by_kind: byKind,
      expanded: exp,
      expanded_dijkstra: dij,
    };
  };
  const sh = mk(shortest, 1.46, { major: 0.34, secondary: 0.18, street: 0.31, path: 0.17 }, 1830, 9120);
  const explored: LatLon[] = [];
  for (let i = 0; i < 900; i++) {
    const t = i / 900;
    const ang = i * 2.399963;
    const rad = 0.15 + 0.85 * Math.sqrt(t);
    const center = lerp(a, b, t * 0.55);
    explored.push([
      center[0] + Math.sin(ang) * rad * Math.abs(b[0] - a[0] + 0.004) * 0.6,
      center[1] + Math.cos(ang) * rad * Math.abs(b[1] - a[1] + 0.006) * 0.6,
    ]);
  }
  const cl = {
    ...mk(cleanest, 1.02, { park: 0.28, path: 0.33, street: 0.29, roadside_secondary: 0.1 }, 2410, 11870),
    explored,
  };
  return {
    city: c.id,
    from: { lat: a[0], lon: a[1], snapped: a, snap_m: 9 },
    to: { lat: b[0], lon: b[1], snapped: b, snap_m: 14 },
    at: at ?? '2026-11-10T11:00',
    pm25_at: pm,
    ventilation_m3h: vent,
    shortest: sh,
    cleanest: cl,
    comparison: {
      extra_distance_pct: Math.round((cl.distance_m / sh.distance_m - 1) * 1000) / 10,
      extra_minutes: Math.round((cl.minutes - sh.minutes) * 10) / 10,
      exposure_reduction_pct: Math.round((1 - cl.weighted_cost / sh.weighted_cost) * 1000) / 10,
      same_route: false,
    },
  };
}
