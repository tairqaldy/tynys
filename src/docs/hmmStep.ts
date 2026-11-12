// One step of the Bayes filter, written the same way as tynys/hmm.py so the lab shows
// exactly what the backend computes. Matrices are row-major: m[i][j] is row i, column j.

import type { BlockId, ClassIdx, Mat4, Vec4 } from '../api/types';

export const BLOCKS: readonly { id: BlockId; hours: string }[] = [
  { id: 'night', hours: '00–05' },
  { id: 'morning', hours: '06–11' },
  { id: 'day', hours: '12–17' },
  { id: 'evening', hours: '18–23' },
];

/** Time-of-day block of a local clock hour: night 00–05, morning 06–11, day 12–17, evening 18–23. */
export function blockOfHour(hour: number): BlockId {
  return BLOCKS[Math.floor((((hour % 24) + 24) % 24) / 6)].id;
}

/**
 * Predict one hour ahead without evidence: p[j] = Σ_i A[i][j] · b[i]  (p = Aᵀ b).
 * Row i of A is "from class i", so the step uses the matrix of the block of the hour it starts from.
 */
export function predict(belief: readonly number[], A: readonly (readonly number[])[]): Vec4 {
  const n = belief.length;
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += A[i][j] * belief[i];
    out.push(s);
  }
  return out as Vec4;
}

export interface BayesUpdate {
  predicted: Vec4;
  /** column `obs` of the emission matrix: P(reading = obs | class s) */
  likelihood: Vec4;
  unnormalised: Vec4;
  /** Σ_s likelihood[s] · predicted[s] = P(reading = obs | earlier readings) */
  evidence: number;
  posterior: Vec4;
}

/** Bayes' rule for one reading: posterior[s] = B[s][obs] · predicted[s] / evidence. */
export function bayesUpdate(predicted: readonly number[], B: readonly (readonly number[])[], obs: ClassIdx): BayesUpdate {
  const likelihood = predicted.map((_, s) => B[s][obs]) as Vec4;
  const unnormalised = predicted.map((p, s) => likelihood[s] * p) as Vec4;
  const evidence = unnormalised.reduce((a, b) => a + b, 0);
  // An impossible reading (evidence 0) cannot happen with the smoothed matrices; keep the prior if it does.
  const posterior = (evidence > 0 ? unnormalised.map((x) => x / evidence) : [...predicted]) as Vec4;
  return { predicted: [...predicted] as Vec4, likelihood, unnormalised, evidence, posterior };
}

export interface FilterStep extends BayesUpdate {
  /** the belief that went into the prediction */
  from: Vec4;
  obs: ClassIdx;
  block: BlockId;
}

/** Predict with the block's transition matrix, then update with the reading. */
export function filterStep(belief: Vec4, A: Mat4, B: Mat4, obs: ClassIdx, block: BlockId): FilterStep {
  return { from: [...belief] as Vec4, obs, block, ...bayesUpdate(predict(belief, A), B, obs) };
}
