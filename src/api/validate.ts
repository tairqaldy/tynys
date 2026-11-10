// Runtime shape checks for the §6 responses. Used by the unit tests against the mocks and the
// backend's fixtures, so a contract drift shows up as a readable list of paths.

type Spec =
  | 'number'
  | 'int'
  | 'string'
  | 'boolean'
  | 'vec4'
  | 'mat4'
  | 'class'
  | 'latlon'
  | 'bbox'
  | { nullable: Spec }
  | { optional: Spec }
  | { array: Spec; len?: number }
  | { record: Spec }
  | { oneOf: readonly (string | number | boolean)[] }
  | { [key: string]: Spec };

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function check(x: unknown, s: Spec, path: string, errs: string[]): void {
  if (typeof s === 'string') {
    const num = typeof x === 'number' && Number.isFinite(x);
    switch (s) {
      case 'number':
        if (!num) errs.push(`${path}: expected number, got ${JSON.stringify(x)}`);
        return;
      case 'int':
        if (!num || !Number.isInteger(x)) errs.push(`${path}: expected integer, got ${JSON.stringify(x)}`);
        return;
      case 'string':
        if (typeof x !== 'string') errs.push(`${path}: expected string`);
        return;
      case 'boolean':
        if (typeof x !== 'boolean') errs.push(`${path}: expected boolean`);
        return;
      case 'class':
        if (![0, 1, 2, 3].includes(x as number)) errs.push(`${path}: expected class index 0..3, got ${JSON.stringify(x)}`);
        return;
      case 'vec4':
        if (!Array.isArray(x) || x.length !== 4 || !x.every((v) => typeof v === 'number'))
          errs.push(`${path}: expected 4 numbers`);
        return;
      case 'mat4':
        if (!Array.isArray(x) || x.length !== 4) errs.push(`${path}: expected 4x4 matrix`);
        else x.forEach((r, i) => check(r, 'vec4', `${path}[${i}]`, errs));
        return;
      case 'latlon':
        if (!Array.isArray(x) || x.length !== 2 || !x.every((v) => typeof v === 'number'))
          errs.push(`${path}: expected [lat, lon]`);
        return;
      case 'bbox':
        if (!Array.isArray(x) || x.length !== 4 || !x.every((v) => typeof v === 'number'))
          errs.push(`${path}: expected [s, w, n, e]`);
        else if (!(x[0] < x[2] && x[1] < x[3])) errs.push(`${path}: bbox is not [south, west, north, east]`);
        return;
    }
  }
  if ('nullable' in s && Object.keys(s).length === 1) {
    if (x !== null) check(x, s.nullable as Spec, path, errs);
    return;
  }
  if ('optional' in s && Object.keys(s).length === 1) {
    if (x !== undefined) check(x, s.optional as Spec, path, errs);
    return;
  }
  if ('array' in s && (Object.keys(s).length === 1 || 'len' in s)) {
    if (!Array.isArray(x)) {
      errs.push(`${path}: expected array`);
      return;
    }
    const len = (s as { len?: number }).len;
    if (len !== undefined && x.length !== len) errs.push(`${path}: expected ${len} items, got ${x.length}`);
    x.forEach((v, i) => check(v, s.array as Spec, `${path}[${i}]`, errs));
    return;
  }
  if ('record' in s && Object.keys(s).length === 1) {
    if (!isObj(x)) {
      errs.push(`${path}: expected object`);
      return;
    }
    for (const [k, v] of Object.entries(x)) check(v, s.record as Spec, `${path}.${k}`, errs);
    return;
  }
  if ('oneOf' in s && Object.keys(s).length === 1) {
    if (!(s.oneOf as readonly unknown[]).includes(x)) errs.push(`${path}: ${JSON.stringify(x)} not in ${JSON.stringify(s.oneOf)}`);
    return;
  }
  if (!isObj(x)) {
    errs.push(`${path}: expected object`);
    return;
  }
  for (const [k, sub] of Object.entries(s as Record<string, Spec>)) {
    const optional = isObj(sub) && 'optional' in sub && Object.keys(sub).length === 1;
    if (!(k in x) && !optional) errs.push(`${path}.${k}: missing`);
    else check(x[k], sub, `${path}.${k}`, errs);
  }
}

const time = 'string' as const;
const action = { oneOf: ['go', 'wait', 'skip'] } as const;
const blocks = (inner: Spec) => ({ night: inner, morning: inner, day: inner, evening: inner });

export const SPECS = {
  meta: {
    cities: {
      array: {
        id: { oneOf: ['astana', 'almaty'] },
        name: 'string',
        center: 'latlon',
        bbox: 'bbox',
        graph: { nodes: 'int', edges: 'int' },
        places: { array: { id: 'string', name: 'string', lat: 'number', lon: 'number' } },
      },
    },
    classes: { array: { id: 'string', label: 'string', min: 'number', max: { nullable: 'number' } }, len: 4 },
    activities: {
      array: { id: 'string', label: 'string', duration_min: 'number', intensity: 'number', benefit: 'number', must: 'boolean' },
    },
    defaults: { reliability: 'number', wait_cost: 'number', deadline_hours: 'number', harm: 'vec4' },
    kinds: { array: { id: 'string', label: 'string', index: 'number' } },
    assumptions: { array: 'string' },
  },
  air: {
    city: 'string',
    timezone: 'string',
    now: time,
    source: { oneOf: ['live', 'snapshot'] },
    snapshot_taken: { optional: 'string' },
    current: { pm25: 'number', pm10: 'number', band: 'class' },
    readings: { array: { time, pm25: 'number', band: 'class' } },
    forecast: { array: { time, pm25: 'number', band: 'class' } },
    hmm: {
      history_hours: 'int',
      reliability: 'number',
      agreement: 'number',
      prior: 'vec4',
      rep_pm25: 'vec4',
      emission: 'mat4',
      transitions: blocks('mat4'),
      transition_counts: { ...blocks('mat4'), all: 'mat4' },
      backed_off: { array: { block: { oneOf: ['night', 'morning', 'day', 'evening'] }, row: 'class', count: 'int' } },
      filtered: { array: { time, obs: 'class', belief: 'vec4', viterbi: 'class' } },
      belief_now: 'vec4',
      state_now: 'class',
      bayes_step: {
        time,
        obs: 'class',
        predicted: 'vec4',
        likelihood: 'vec4',
        unnormalised: 'vec4',
        evidence: 'number',
        posterior: 'vec4',
      },
      predicted: {
        array: {
          time,
          lead_h: 'int',
          forecast_band: 'class',
          forecast_reliability: 'number',
          belief: 'vec4',
          expected_pm25: 'number',
        },
      },
    },
    weather: { nullable: { wind_kmh: 'number', temp_c: 'number' } },
  },
  plan: {
    city: 'string',
    now: time,
    source: { oneOf: ['live', 'snapshot'] },
    inputs: {
      activity: 'string',
      duration_min: 'number',
      deadline_hours: 'int',
      wait_cost: 'number',
      sensitive: 'boolean',
      must: 'boolean',
      intensity: 'number',
      benefit: 'number',
      sensitivity: 'number',
      harm: 'vec4',
    },
    reward_go: 'vec4',
    belief_now: 'vec4',
    state_now: 'class',
    hours: {
      array: {
        t: 'int',
        time,
        forecast_band: 'class',
        expected_pm25: 'number',
        transition: { nullable: 'mat4' },
        q_go: 'vec4',
        q_wait: { nullable: 'vec4' },
        value: 'vec4',
        policy: { array: action, len: 4 },
        p_go: 'number',
        p_go_cumulative: 'number',
      },
    },
    p_skip: 'number',
    decision: {
      action,
      q_go: 'number',
      q_wait: 'number',
      q_skip: { nullable: 'number' },
      best_t: { nullable: 'int' },
      best_time: { nullable: 'string' },
      bellman: {
        state: 'class',
        wait_cost: 'number',
        transition_row: 'vec4',
        next_values: 'vec4',
        expected_next: 'number',
        q_wait: 'number',
        q_go: 'number',
      },
    },
  },
  route: (() => {
    const end = { lat: 'number', lon: 'number', snapped: 'latlon', snap_m: 'number' } as const;
    const info = {
      coords: { array: 'latlon' },
      distance_m: 'number',
      minutes: 'number',
      weighted_cost: 'number',
      mean_index: 'number',
      exposure_score: 'number',
      by_kind: { record: 'number' },
      expanded: 'int',
      expanded_dijkstra: 'int',
    } as const;
    return {
      city: 'string',
      from: end,
      to: end,
      at: time,
      pm25_at: 'number',
      ventilation_m3h: 'number',
      shortest: info,
      cleanest: { ...info, explored: { array: 'latlon' } },
      comparison: {
        extra_distance_pct: 'number',
        extra_minutes: 'number',
        exposure_reduction_pct: 'number',
        same_route: 'boolean',
      },
    };
  })(),
  places: { results: { array: { name: 'string', detail: 'string', lat: 'number', lon: 'number' } } },
  error: { error: { code: 'string', message: 'string' } },
} satisfies Record<string, Spec>;

export function validate(kind: keyof typeof SPECS, x: unknown): string[] {
  const errs: string[] = [];
  check(x, SPECS[kind] as Spec, kind, errs);
  return errs;
}
