// Contract tests: every mock and every backend fixture must match docs/SPEC.md §6, and the numbers
// the "Show the math" panels display must be internally consistent (so the worked sums add up).
import { describe, expect, it } from 'vitest';
import type { AirResponse, PlanResponse, RouteResponse } from '../api/types';
import { validate, SPECS } from '../api/validate';

type Kind = keyof typeof SPECS;

const mocks = import.meta.glob('../mocks/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fixtures = import.meta.glob('../../fixtures/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function kindOf(path: string): Kind | null {
  const f = path.split('/').pop()!;
  for (const k of ['error', 'meta', 'air', 'plan', 'route', 'places'] as const) if (f.startsWith(k)) return k;
  return null;
}

const close = (a: number, b: number, tol = 2e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

function airChecks(a: AirResponse): string[] {
  const e: string[] = [];
  const h = a.hmm;
  if (!close(sum(h.belief_now), 1)) e.push('belief_now does not sum to 1');
  h.emission.forEach((r, i) => !close(sum(r), 1) && e.push(`emission row ${i} sum ${sum(r)}`));
  for (const [b, m] of Object.entries(h.transitions)) m.forEach((r, i) => !close(sum(r), 1) && e.push(`transitions.${b}[${i}] sum ${sum(r)}`));
  const s = h.bayes_step;
  s.predicted.forEach((p, i) => !close(p * s.likelihood[i], s.unnormalised[i], 5e-3) && e.push(`bayes unnormalised[${i}] ≠ predicted×likelihood`));
  if (!close(sum(s.unnormalised), s.evidence, 5e-3)) e.push(`bayes evidence ${s.evidence} ≠ Σ unnormalised ${sum(s.unnormalised)}`);
  s.posterior.forEach((p, i) => !close(p, s.unnormalised[i] / s.evidence, 5e-3) && e.push(`bayes posterior[${i}] ≠ unnormalised/evidence`));
  if (!close(sum(s.posterior), 1)) e.push('bayes posterior does not sum to 1');
  if (h.filtered.length !== 24) e.push(`filtered has ${h.filtered.length} hours, expected 24`);
  if (a.readings[a.readings.length - 1]?.time !== a.now) e.push('readings do not end at now');
  if (h.filtered[h.filtered.length - 1]?.time !== a.now) e.push('filtered does not end at now');
  if (s.time !== a.now) e.push('bayes_step.time is not now');
  s.posterior.forEach((p, i) => !close(p, h.belief_now[i], 5e-3) && e.push('bayes posterior ≠ belief_now'));
  const am = h.belief_now.indexOf(Math.max(...h.belief_now));
  if (am !== h.state_now) e.push('state_now is not argmax(belief_now)');
  h.predicted.forEach((p, k) => !close(sum(p.belief), 1) && e.push(`predicted[${k}] belief sum`));
  for (const b of h.backed_off) {
    const n = sum(h.transition_counts[b.block][b.row]);
    if (n !== b.count) e.push(`backed_off ${b.block}/${b.row} count ${b.count} ≠ row sum ${n}`);
  }
  return e;
}

function planChecks(p: PlanResponse): string[] {
  const e: string[] = [];
  const d = p.decision;
  const total = sum(p.hours.map((h) => h.p_go)) + p.p_skip;
  if (!close(total, 1, 5e-3)) e.push(`Σ p_go + p_skip = ${total}`);
  if (d.action === 'wait' && d.best_t === 0) e.push('wait with best_t = 0');
  if (p.inputs.must && p.hours.some((h) => h.policy.includes('skip'))) e.push('must activity has skip in policy');
  const h0 = p.hours[0];
  if (!close(sum(p.belief_now.map((b, s) => b * h0.q_go[s])), d.q_go, 5e-3)) e.push('decision.q_go ≠ Σ b·Q0(go)');
  if (h0.q_wait && !close(sum(p.belief_now.map((b, s) => b * h0.q_wait![s])), d.q_wait, 5e-3)) e.push('decision.q_wait ≠ Σ b·Q0(wait)');
  const bm = d.bellman;
  if (bm) {
    const exp = sum(bm.transition_row.map((t, k) => t * bm.next_values[k]));
    if (!close(exp, bm.expected_next, 5e-3)) e.push('bellman expected_next ≠ Σ T·V');
    if (!close(-bm.wait_cost + bm.expected_next, bm.q_wait, 5e-3)) e.push('bellman q_wait ≠ −wait_cost + expected_next');
    if (!close(bm.q_go, p.reward_go[bm.state], 5e-3)) e.push('bellman q_go ≠ reward_go[state]');
  }
  if (p.hours.length !== p.inputs.deadline_hours + 1) e.push(`hours has ${p.hours.length}, expected H+1`);
  const last = p.hours[p.hours.length - 1];
  if (last.transition !== null || last.q_wait !== null) e.push('last hour should have transition = null and q_wait = null');
  p.reward_go.forEach((r, s) => {
    const i = p.inputs;
    const want = i.benefit - i.harm[s] * (i.duration_min / 60) * i.intensity * i.sensitivity;
    if (!close(r, want, 5e-3)) e.push(`reward_go[${s}] ${r} ≠ formula ${want}`);
  });
  if (d.best_t !== null) {
    const h = p.hours.find((x) => x.t === d.best_t);
    if (!h || h.p_go_cumulative < 0.5 - 1e-4) e.push('best_t does not reach 50% cumulative');
  }
  return e;
}

function routeChecks(r: RouteResponse): string[] {
  const e: string[] = [];
  for (const k of ['shortest', 'cleanest'] as const) {
    const x = r[k];
    if (!close(sum(Object.values(x.by_kind)), 1, 5e-3)) e.push(`${k}.by_kind sums to ${sum(Object.values(x.by_kind))}`);
    if (!close(x.mean_index, x.weighted_cost / x.distance_m, 1e-2)) e.push(`${k}.mean_index ≠ weighted_cost/distance`);
  }
  if (r.cleanest.weighted_cost > r.shortest.weighted_cost + 1e-6) e.push('cleanest weighted cost > shortest');
  if (r.cleanest.explored.length > 1500) e.push('explored > 1500 points');
  const red = 100 * (1 - r.cleanest.weighted_cost / r.shortest.weighted_cost);
  if (Math.abs(red - r.comparison.exposure_reduction_pct) > 0.15) e.push(`exposure_reduction_pct ${r.comparison.exposure_reduction_pct} ≠ ${red.toFixed(2)}`);
  return e;
}

function deepChecks(kind: Kind, x: unknown): string[] {
  if (kind === 'air') return airChecks(x as AirResponse);
  if (kind === 'plan') return planChecks(x as PlanResponse);
  if (kind === 'route') return routeChecks(x as RouteResponse);
  return [];
}

describe.each([
  ['mock', mocks],
  ['fixture', fixtures],
] as const)('%s responses', (_label, files) => {
  const entries = Object.entries(files).filter(([p]) => kindOf(p));
  if (entries.length === 0) {
    it.skip('none present', () => {});
    return;
  }
  it.each(entries)('%s matches §6', (path, data) => {
    const kind = kindOf(path)!;
    // error fixtures are saved as { status, body }
    const body = kind === 'error' && data && typeof data === 'object' && 'body' in data ? (data as { body: unknown }).body : data;
    expect(validate(kind, body)).toEqual([]);
  });
  it.each(entries.filter(([p]) => ['air', 'plan', 'route'].includes(kindOf(p)!)))('%s is internally consistent', (path, data) => {
    expect(deepChecks(kindOf(path)!, data)).toEqual([]);
  });
});

describe('missing model hours', () => {
  it('an hour without a model value (null pm25, band and obs) still passes validation', () => {
    const air = structuredClone(mocks['../mocks/air_almaty.json']) as AirResponse;
    air.readings[5] = { ...air.readings[5], pm25: null, band: null };
    air.hmm.filtered[3] = { ...air.hmm.filtered[3], obs: null };
    expect(validate('air', air)).toEqual([]);
  });
});
