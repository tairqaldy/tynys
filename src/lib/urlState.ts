// The main state mirrored in the URL query, so a prepared link opens the same view.
// Everything read from the URL is validated; anything malformed is ignored silently.

import type { ActivityId, CityId } from '../api/types';

export interface UrlPoint {
  lat: number;
  lon: number;
  name?: string;
}

export interface UrlState {
  city?: CityId;
  activity?: ActivityId;
  duration?: number;
  deadline?: number;
  wait?: number;
  sensitive?: boolean;
  reliability?: number;
  from?: UrlPoint;
  to?: UrlPoint;
}

const ACTIVITIES: readonly ActivityId[] = ['walk', 'run', 'kids', 'errand'];

function numIn(raw: string | null, lo: number, hi: number, step: number): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const x = Number(raw);
  if (!Number.isFinite(x) || x < lo || x > hi) return undefined;
  // snap to the control's step so a slider can show it exactly
  const snapped = Math.round((x - lo) / step) * step + lo;
  return Math.round(snapped * 1000) / 1000;
}

function point(raw: string | null, name: string | null): UrlPoint | undefined {
  if (!raw) return undefined;
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return undefined;
  // names are display text only: drop control characters and cap the length
  const clean = name?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return clean ? { lat, lon, name: clean } : { lat, lon };
}

export function parseUrlState(search: string): UrlState {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return {};
  }
  const s: UrlState = {};
  const city = q.get('city');
  if (city === 'astana' || city === 'almaty') s.city = city;
  const act = q.get('activity');
  if (act && (ACTIVITIES as readonly string[]).includes(act)) s.activity = act as ActivityId;
  s.duration = numIn(q.get('duration'), 10, 180, 5);
  s.deadline = numIn(q.get('deadline'), 1, 12, 1);
  s.wait = numIn(q.get('wait'), 0.1, 1, 0.1);
  s.reliability = numIn(q.get('r'), 0.55, 0.95, 0.05);
  const sens = q.get('sensitive');
  if (sens === '1' || sens === '0') s.sensitive = sens === '1';
  s.from = point(q.get('from'), q.get('fromName'));
  s.to = point(q.get('to'), q.get('toName'));
  for (const k of Object.keys(s) as (keyof UrlState)[]) if (s[k] === undefined) delete s[k];
  return s;
}

/** Writes the state into `search`, keeping unrelated parameters (such as mock=1). */
export function writeUrlState(search: string, s: UrlState): string {
  const q = new URLSearchParams(search);
  const keys = ['city', 'activity', 'duration', 'deadline', 'wait', 'sensitive', 'r', 'from', 'fromName', 'to', 'toName'];
  keys.forEach((k) => q.delete(k));
  if (s.city) q.set('city', s.city);
  if (s.activity) q.set('activity', s.activity);
  if (s.duration !== undefined) q.set('duration', String(s.duration));
  if (s.deadline !== undefined) q.set('deadline', String(s.deadline));
  if (s.wait !== undefined) q.set('wait', s.wait.toFixed(1));
  if (s.sensitive !== undefined) q.set('sensitive', s.sensitive ? '1' : '0');
  if (s.reliability !== undefined) q.set('r', s.reliability.toFixed(2));
  const pt = (k: 'from' | 'to', p?: UrlPoint) => {
    if (!p) return;
    q.set(k, `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`);
    if (p.name) q.set(`${k}Name`, p.name);
  };
  pt('from', s.from);
  pt('to', s.to);
  const out = q.toString();
  return out ? `?${out}` : '';
}
