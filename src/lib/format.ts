// Formatting helpers. API times are local wall-clock strings "YYYY-MM-DDTHH:00" (Asia/Almaty);
// they are never converted through Date so the browser's own timezone cannot shift them.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const hhmm = (t: string) => t.slice(11, 16);
export const hourOf = (t: string) => Number(t.slice(11, 13));
export const dateOf = (t: string) => t.slice(0, 10);

/** "10 Nov" */
export function dayMonth(t: string): string {
  const m = Number(t.slice(5, 7));
  return `${Number(t.slice(8, 10))} ${MONTHS[m - 1] ?? ''}`;
}

/** "15:00", "tomorrow 09:00" relative to `now`. */
export function relTime(t: string, now: string): string {
  if (dateOf(t) === dateOf(now)) return hhmm(t);
  const d0 = Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1, +now.slice(8, 10));
  const d1 = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  const days = Math.round((d1 - d0) / 86400000);
  if (days === 1) return `tomorrow ${hhmm(t)}`;
  return `${dayMonth(t)} ${hhmm(t)}`;
}

/** Percent for probabilities: "62%", "<1%", "100%". */
export function pct(p: number, digits = 0): string {
  if (p > 0 && p < 0.005 && digits === 0) return '<1%';
  if (p < 1 && p > 0.995 && digits === 0) return '>99%';
  return `${(p * 100).toFixed(digits)}%`;
}

/** Fixed decimals with a true minus sign. */
export function num(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const s = Math.abs(x).toFixed(digits);
  const isZero = Number(s) === 0;
  return (x < 0 && !isZero ? '−' : '') + s;
}

export function km(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${Math.round(m)} m`;
}

export function intl(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}
