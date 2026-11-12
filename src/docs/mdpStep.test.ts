// The lab's Bellman backup must reproduce the backend's Q values for every cell of the mock plans:
// Q_t(s, wait) = −wait_cost + Σ_s′ hours[t].transition[s][s′] · hours[t + 1].value[s′].
import { describe, expect, it } from 'vitest';
import type { PlanResponse } from '../api/types';
import { backup, beliefQ, rewardGo } from './mdpStep';

const files = import.meta.glob('../mocks/plan_*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const plans = Object.entries(files).map(([name, p]) => [name.replace(/^.*\/|\.json$/g, ''), p as PlanResponse] as const);

describe.each(plans)('%s', (_name, plan) => {
  const H = plan.hours.length - 1;

  it('recomputed Q_wait matches hours[t].q_wait for every (t, s)', () => {
    for (let t = 0; t < H; t++) {
      for (let s = 0; s < 4; s++) {
        const b = backup(plan, t, s);
        expect(b.qWait).toBe(plan.hours[t].q_wait![s]);
        expect(Math.abs(b.qWaitRecomputed! - plan.hours[t].q_wait![s])).toBeLessThan(1e-3);
      }
    }
  });

  it('no waiting at the deadline', () => {
    for (let s = 0; s < 4; s++) {
      const b = backup(plan, H, s);
      expect(b.qWait).toBeNull();
      expect(b.terms).toBeNull();
    }
  });

  it('Q_go is R_go and V is the max of the allowed actions', () => {
    for (let t = 0; t <= H; t++) {
      for (let s = 0; s < 4; s++) {
        const b = backup(plan, t, s);
        expect(Math.abs(rewardGo(plan.inputs, s) - b.qGo)).toBeLessThan(1e-3);
        const allowed = [b.qGo, b.qWait, b.qSkip].filter((x): x is number => x !== null);
        expect(Math.abs(Math.max(...allowed) - b.value)).toBeLessThan(1e-3);
      }
    }
  });

  it('the worked example in decision.bellman is the cell (0, state_now)', () => {
    const bm = plan.decision.bellman;
    const b = backup(plan, 0, bm.state);
    expect(b.terms!.map((x) => x.T)).toEqual(bm.transition_row);
    expect(b.terms!.map((x) => x.V)).toEqual(bm.next_values);
    expect(Math.abs(b.expectedNext! - bm.expected_next)).toBeLessThan(1e-3);
  });

  it('belief-weighted Q reproduces the decision', () => {
    const h0 = plan.hours[0];
    expect(Math.abs(beliefQ(plan.belief_now, h0.q_go) - plan.decision.q_go)).toBeLessThan(1e-3);
    if (h0.q_wait) expect(Math.abs(beliefQ(plan.belief_now, h0.q_wait) - plan.decision.q_wait)).toBeLessThan(1e-3);
  });
});
