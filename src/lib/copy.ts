// Plain-language sentences built only from numbers the API returned.

import type { PlanResponse, RouteResponse } from '../api/types';
import { CLASS_LABEL, argmax } from './classes';
import { num, pct, relTime } from './format';

export interface NowSentence {
  lead: string;
  word: string;
  tail: string;
  hedge: string | null;
}

/** "Particle pollution in Almaty is *elevated* right now." */
export function nowSentence(cityName: string, belief: readonly number[]): NowSentence {
  const k = argmax(belief);
  const p = belief[k];
  const word = CLASS_LABEL[k].toLowerCase();
  if (p >= 0.75) return { lead: `Particle pollution in ${cityName} is `, word, tail: ' right now.', hedge: null };
  const order = [0, 1, 2, 3].sort((a, b) => belief[b] - belief[a]);
  const second = CLASS_LABEL[order[1]].toLowerCase();
  if (p >= 0.5) {
    return {
      lead: `Particle pollution in ${cityName} is most likely `,
      word,
      tail: ' right now.',
      hedge: `The model gives it ${pct(p)}; ${second} is next at ${pct(belief[order[1]])}.`,
    };
  }
  return {
    lead: `Particle pollution in ${cityName} is probably `,
    word,
    tail: ` or ${second} right now.`,
    hedge: `The model is unsure: ${pct(p)} ${word}, ${pct(belief[order[1]])} ${second}.`,
  };
}

/** "a 62%" / "an 87%" / "an 11%" — the article follows how the number is read aloud. */
export function aPct(p: number): string {
  const s = pct(p);
  return /^(8|1[18]%|1[18]\d\d)/.test(s) ? `an ${s}` : `a ${s}`;
}

export interface Decision {
  head: string;
  sub: string;
}

export function decisionSentence(plan: PlanResponse): Decision {
  const d = plan.decision;
  const H = plan.inputs.deadline_hours;
  const last = plan.hours[plan.hours.length - 1];
  if (d.action === 'go') {
    return { head: 'Go now.', sub: `Going now scores higher than waiting for the air to improve within the next ${H} h.` };
  }
  if (d.action === 'skip') {
    return {
      head: 'Probably not today.',
      sub: `Within the next ${H} h, skipping scores higher than going at any hour the model expects.`,
    };
  }
  if (d.best_time) {
    const p = plan.hours.find((h) => h.t === d.best_t)?.p_go_cumulative ?? 0.5;
    return {
      head: `Wait — most likely around ${relTime(d.best_time, plan.now)}.`,
      sub: `If you follow the plan, there is ${aPct(p)} chance you will have gone by then${
        plan.p_skip > 0.005 ? ` and ${aPct(plan.p_skip)} chance it ends in skipping` : ''
      }.`,
    };
  }
  return {
    head: 'Probably not today.',
    sub: `Waiting is the better move now, but there is only ${aPct(last?.p_go_cumulative ?? 0)} chance the air clears enough to go within ${H} h.`,
  };
}

/** Why the action wins, from the belief-weighted Q values at t = 0. */
export function planReason(plan: PlanResponse): string {
  const d = plan.decision;
  const i = plan.inputs;
  const f = (x: number) => num(x, 2);
  const skipPart = i.must ? '' : ', skipping 0';
  const mustNote = i.must ? ' Skipping is not an option for an errand.' : '';
  if (d.action === 'go') {
    return (
      `Weighted by how likely each class is right now, going now is worth ${f(d.q_go)} points, ` +
      `waiting ${f(d.q_wait)}${skipPart}. Each hour of waiting costs ${f(i.wait_cost)} points, ` +
      `and the air is not expected to improve by more than that.${mustNote}`
    );
  }
  if (d.action === 'wait') {
    return (
      `Weighted by how likely each class is right now, waiting is worth ${f(d.q_wait)} points, ` +
      `going now ${f(d.q_go)}${skipPart}. Waiting comes out ${f(d.q_wait - d.q_go)} ahead: ` +
      `the improvement the model expects later is worth more than the ${f(i.wait_cost)} points each hour of waiting costs.${mustNote}`
    );
  }
  return (
    `Skipping is worth 0 points; going now is worth ${f(d.q_go)} and waiting ${f(d.q_wait)}. ` +
    `For ${i.duration_min} minutes outside${i.sensitivity > 1 ? ' with sensitivity doubled' : ''}, ` +
    `the expected harm is larger than the benefit of ${f(i.benefit)} points at every hour in reach.`
  );
}

export function routeSentence(r: RouteResponse, verb: 'walking' | 'running'): string {
  const c = r.comparison;
  if (c.same_route) return 'Here the shortest route is already the one with the least traffic exposure.';
  const red = Math.round(c.exposure_reduction_pct);
  const extra = c.extra_distance_pct;
  const extraTxt =
    extra < 0.5 ? 'for about the same distance' : `for ${Math.round(extra)}% more ${verb}`;
  const mins = c.extra_minutes >= 0.5 ? ` (about ${Math.round(c.extra_minutes)} min longer)` : '';
  return `${red}% less traffic exposure ${extraTxt}${mins}.`;
}

