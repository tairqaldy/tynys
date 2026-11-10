import { describe, expect, it } from 'vitest';
import type { PlanResponse, RouteResponse } from '../api/types';
import { decisionSentence, nowSentence, planReason, routeSentence } from '../lib/copy';
import { num, pct, relTime } from '../lib/format';
import plan from '../mocks/plan_astana_walk.json';

const base = plan as unknown as PlanResponse;
const withDecision = (patch: Partial<PlanResponse['decision']>, extra: Partial<PlanResponse> = {}): PlanResponse => ({
  ...base,
  ...extra,
  decision: { ...base.decision, ...patch },
});

describe('format', () => {
  it('formats probabilities and signs', () => {
    expect(pct(0.623)).toBe('62%');
    expect(pct(0.001)).toBe('<1%');
    expect(pct(0.999)).toBe('>99%');
    expect(num(-0.3, 2)).toBe('−0.30');
    expect(num(-0.0001, 2)).toBe('0.00');
  });
  it('gives relative times without Date timezone shifts', () => {
    expect(relTime('2026-11-10T15:00', '2026-11-10T11:00')).toBe('15:00');
    expect(relTime('2026-11-11T09:00', '2026-11-10T22:00')).toBe('tomorrow 09:00');
  });
});

describe('articles', () => {
  it('reads percentages aloud', async () => {
    const { aPct } = await import('../lib/copy');
    expect(aPct(0.87)).toBe('an 87%');
    expect(aPct(0.11)).toBe('an 11%');
    expect(aPct(0.18)).toBe('an 18%');
    expect(aPct(0.62)).toBe('a 62%');
    expect(aPct(0.08)).toBe('an 8%');
    expect(aPct(0.15)).toBe('a 15%');
  });
});

describe('sentences', () => {
  it('states the class plainly when the belief is confident', () => {
    const s = nowSentence('Almaty', [0.02, 0.05, 0.88, 0.05]);
    expect(s.lead + s.word + s.tail).toBe('Particle pollution in Almaty is elevated right now.');
    expect(s.hedge).toBeNull();
  });
  it('hedges when the belief is split', () => {
    const s = nowSentence('Astana', [0.1, 0.45, 0.4, 0.05]);
    expect(s.lead + s.word + s.tail).toBe('Particle pollution in Astana is probably moderate or elevated right now.');
  });
  it('builds the three decision sentences', () => {
    expect(decisionSentence(withDecision({ action: 'go', best_t: 0 })).head).toBe('Go now.');
    expect(decisionSentence(withDecision({ action: 'skip', best_t: null, best_time: null })).head).toBe('Probably not today.');
    const w = withDecision(
      { action: 'wait', best_t: 2, best_time: '2026-11-10T13:00' },
      { hours: base.hours.map((h) => ({ ...h, p_go_cumulative: h.t >= 2 ? 0.6 : 0 })) },
    );
    expect(decisionSentence(w).head).toBe('Wait — most likely around 13:00.');
    expect(decisionSentence(withDecision({ action: 'wait', best_t: null, best_time: null })).head).toBe('Probably not today.');
  });
  it('explains the choice with the returned numbers', () => {
    const r = planReason(withDecision({ action: 'wait', q_go: 3.9, q_wait: 4.3, q_skip: 0 }));
    expect(r).toContain('waiting is worth 4.30 points');
    expect(r).toContain('going now 3.90');
    expect(r).toContain('0.40 ahead');
  });
  it('compares routes in one sentence', () => {
    const r = {
      comparison: { extra_distance_pct: 6.2, extra_minutes: 1.7, exposure_reduction_pct: 21.5, same_route: false },
    } as RouteResponse;
    expect(routeSentence(r, 'walking')).toBe('22% less traffic exposure for 6% more walking (about 2 min longer).');
    expect(routeSentence({ comparison: { ...r.comparison, same_route: true } } as RouteResponse, 'walking')).toMatch(/already/);
  });
});
