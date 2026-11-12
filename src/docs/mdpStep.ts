// The Bellman backup of tynys/mdp.py for one cell (t, s), recomputed from the numbers the API sends,
// so the lab can show every term. hours[t].transition is T_t, the matrix used when waiting at hour t;
// it moves the class from hour t to hour t + 1 and is null at the deadline t = H.

import type { Action, PlanInputs, PlanResponse } from '../api/types';

/** R_go(s) = benefit − harm[s] · (duration / 60) · intensity · sensitivity */
export function rewardGo(inputs: PlanInputs, s: number): number {
  return inputs.benefit - inputs.harm[s] * (inputs.duration_min / 60) * inputs.intensity * inputs.sensitivity;
}

export interface Backup {
  t: number;
  s: number;
  qGo: number;
  /** Q_t(s, wait) as the API sends it; null at the deadline, where waiting is not allowed */
  qWait: number | null;
  /** the same value recomputed here from T_t and V_{t+1} (equal up to the API's 4-decimal rounding) */
  qWaitRecomputed: number | null;
  /** null for an activity that cannot be skipped */
  qSkip: number | null;
  value: number;
  action: Action;
  /** the four terms T_t[s][s′] · V_{t+1}(s′); null at the deadline */
  terms: { T: number; V: number; product: number }[] | null;
  /** Σ_s′ T_t[s][s′] · V_{t+1}(s′) recomputed from the rounded API numbers */
  expectedNext: number | null;
}

/**
 * Q_t(s, wait) = −wait_cost + Σ_s′ T_t[s][s′] · V_{t+1}(s′), from hours[t].transition and hours[t + 1].value.
 * Q_t(s, go) and V come straight from the API; this recomputes the wait term so it can be shown.
 */
export function backup(plan: PlanResponse, t: number, s: number): Backup {
  const h = plan.hours[t];
  const next = plan.hours[t + 1];
  const T = h.transition;
  let terms: Backup['terms'] = null;
  let expectedNext: number | null = null;
  let qWaitRecomputed: number | null = null;
  if (T && next) {
    terms = T[s].map((p, s2) => ({ T: p, V: next.value[s2], product: p * next.value[s2] }));
    expectedNext = terms.reduce((a, x) => a + x.product, 0);
    qWaitRecomputed = -plan.inputs.wait_cost + expectedNext;
  }
  return {
    t,
    s,
    qGo: h.q_go[s],
    qWait: h.q_wait ? h.q_wait[s] : null,
    qWaitRecomputed,
    qSkip: plan.inputs.must ? null : 0,
    value: h.value[s],
    action: h.policy[s],
    terms,
    expectedNext,
  };
}

/** QMDP: Q(b, a) = Σ_s b[s] · Q_0(s, a). */
export function beliefQ(belief: readonly number[], q: readonly number[]): number {
  return belief.reduce((a, b, s) => a + b * q[s], 0);
}
