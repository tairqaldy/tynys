// The lab's Bayes step must reproduce the backend's last real update (hmm.bayes_step) from the
// belief one hour earlier and the transition matrix of that hour's block (tynys/hmm.py conventions).
import { describe, expect, it } from 'vitest';
import type { AirResponse } from '../api/types';
import airAlmaty from '../mocks/air_almaty.json';
import airAstana from '../mocks/air_astana.json';
import { bayesUpdate, blockOfHour, filterStep, predict } from './hmmStep';

const close = (a: readonly number[], b: readonly number[], tol = 1e-3) =>
  a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(tol));

describe.each([
  ['almaty', airAlmaty as unknown as AirResponse],
  ['astana', airAstana as unknown as AirResponse],
])('Bayes step on the %s mock', (_city, air) => {
  const h = air.hmm;
  const step = h.bayes_step;
  const before = h.filtered[h.filtered.length - 2];
  // the step before -> step.time uses the block of the hour it starts from
  const block = blockOfHour(Number(before.time.slice(11, 13)));

  it('the belief before the step is the second-to-last filtered hour', () => {
    expect(h.filtered[h.filtered.length - 1].time).toBe(step.time);
  });

  it('predict reproduces bayes_step.predicted', () => {
    close(predict(before.belief, h.transitions[block]), step.predicted);
  });

  it('update reproduces likelihood, product, evidence and posterior', () => {
    const r = filterStep(before.belief, h.transitions[block], h.emission, step.obs, block);
    close(r.predicted, step.predicted);
    close(r.likelihood, step.likelihood, 1e-9);
    close(r.unnormalised, step.unnormalised);
    expect(Math.abs(r.evidence - step.evidence)).toBeLessThan(1e-3);
    close(r.posterior, step.posterior);
    close(r.posterior, h.belief_now);
  });

  it('the posterior sums to 1', () => {
    const r = filterStep(before.belief, h.transitions[block], h.emission, step.obs, block);
    expect(r.posterior.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe('helpers', () => {
  it('blocks by origin hour', () => {
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(blockOfHour)).toEqual([
      'night', 'night', 'morning', 'morning', 'day', 'day', 'evening', 'evening',
    ]);
  });

  it('predict is Aᵀb (rows are "from")', () => {
    const A = [
      [0.7, 0.3],
      [0.4, 0.6],
    ];
    // certainly in state 0 → the next-step distribution is row 0; uniform → the column averages
    const p = predict([1, 0], A);
    expect(p).toEqual([0.7, 0.3]);
    close(predict([0.5, 0.5], A), [0.55, 0.45], 1e-12);
  });

  it('AIMA umbrella world: P(rain | u1) = 0.818', () => {
    const A = [
      [0.7, 0.3],
      [0.3, 0.7],
    ];
    const B = [
      [0.9, 0.1],
      [0.2, 0.8],
    ];
    const r1 = bayesUpdate(predict([0.5, 0.5], A), B, 0);
    expect(r1.posterior[0]).toBeCloseTo(0.818, 3);
    const r2 = bayesUpdate(predict(r1.posterior, A), B, 0);
    expect(r2.posterior[0]).toBeCloseTo(0.883, 3);
  });
});
