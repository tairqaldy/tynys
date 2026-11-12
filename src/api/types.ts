// Types for the HTTP API in docs/SPEC.md §6. Field names and shapes are binding.

/** Four probabilities in class order: low, moderate, elevated, high. */
export type Vec4 = [number, number, number, number];
export type Mat4 = [Vec4, Vec4, Vec4, Vec4];
/** Class index 0..3 (low, moderate, elevated, high). */
export type ClassIdx = 0 | 1 | 2 | 3;
export type ClassId = 'low' | 'moderate' | 'elevated' | 'high';
export type BlockId = 'night' | 'morning' | 'day' | 'evening';
export type Action = 'go' | 'wait' | 'skip';
export type CityId = 'astana' | 'almaty';
export type ActivityId = 'walk' | 'run' | 'kids' | 'errand';
export type Source = 'live' | 'snapshot';
/** [south, west, north, east] */
export type BBox = [number, number, number, number];
/** [lat, lon] */
export type LatLon = [number, number];

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------- /api/meta

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface CityMeta {
  id: CityId;
  name: string;
  center: LatLon;
  bbox: BBox;
  graph: { nodes: number; edges: number; osm_timestamp?: string };
  places: Place[];
}

export interface ClassMeta {
  id: ClassId;
  label: string;
  min: number;
  max: number | null;
}

export interface ActivityMeta {
  id: ActivityId;
  label: string;
  duration_min: number;
  intensity: number;
  benefit: number;
  must: boolean;
}

export interface KindMeta {
  id: string;
  label: string;
  index: number;
}

export interface MetaResponse {
  cities: CityMeta[];
  classes: ClassMeta[];
  activities: ActivityMeta[];
  defaults: { reliability: number; wait_cost: number; deadline_hours: number; harm: Vec4 };
  kinds: KindMeta[];
  assumptions: string[];
  /** extras the backend sends beyond §6 */
  timezone?: string;
  h_factor?: number;
  limits?: Record<string, [number, number]>;
}

// ---------------------------------------------------------------- /api/air

export interface HourReading {
  time: string;
  /** null when the model has no value for that hour */
  pm25: number | null;
  band: ClassIdx | null;
}

export interface FilteredHour {
  time: string;
  /** null when the reading for that hour is missing (the filter only predicts) */
  obs: ClassIdx | null;
  belief: Vec4;
  viterbi: ClassIdx;
}

export interface BayesStep {
  time: string;
  obs: ClassIdx;
  predicted: Vec4;
  likelihood: Vec4;
  unnormalised: Vec4;
  evidence: number;
  posterior: Vec4;
}

export interface PredictedHour {
  time: string;
  lead_h: number;
  forecast_band: ClassIdx;
  forecast_reliability: number;
  belief: Vec4;
  expected_pm25: number;
}

export interface BackedOffRow {
  block: BlockId;
  row: ClassIdx;
  count: number;
}

export interface HmmBlock {
  history_hours: number;
  reliability: number;
  agreement: number;
  prior: Vec4;
  rep_pm25: Vec4;
  emission: Mat4;
  transitions: Record<BlockId, Mat4>;
  transition_counts: Record<BlockId | 'all', Mat4>;
  backed_off: BackedOffRow[];
  filtered: FilteredHour[];
  belief_now: Vec4;
  state_now: ClassIdx;
  bayes_step: BayesStep;
  predicted: PredictedHour[];
}

export interface AirResponse {
  city: CityId;
  timezone: string;
  now: string;
  source: Source;
  snapshot_taken?: string;
  current: { pm25: number; pm10: number | null; band: ClassIdx };
  readings: HourReading[];
  forecast: HourReading[];
  hmm: HmmBlock;
  weather: { wind_kmh: number; temp_c: number } | null;
}

// ---------------------------------------------------------------- /api/plan

export interface PlanInputs {
  activity: ActivityId;
  duration_min: number;
  deadline_hours: number;
  wait_cost: number;
  sensitive: boolean;
  must: boolean;
  intensity: number;
  benefit: number;
  sensitivity: number;
  harm: Vec4;
}

export interface PlanHour {
  t: number;
  time: string;
  forecast_band: ClassIdx;
  /** whether forecast_band comes from the latest reading (t = 0) or the forecast; absent → t = 0 is "reading" */
  band_source?: 'reading' | 'forecast';
  expected_pm25: number;
  transition: Mat4 | null;
  q_go: Vec4;
  q_wait: Vec4 | null;
  value: Vec4;
  policy: [Action, Action, Action, Action];
  p_go: number;
  p_go_cumulative: number;
}

export interface BellmanExample {
  state: ClassIdx;
  wait_cost: number;
  transition_row: Vec4;
  next_values: Vec4;
  expected_next: number;
  q_wait: number;
  q_go: number;
}

export interface PlanDecision {
  action: Action;
  q_go: number;
  q_wait: number;
  /** §6 says 0; the backend sends null when the activity cannot be skipped (errand). */
  q_skip: number | null;
  best_t: number | null;
  best_time: string | null;
  bellman: BellmanExample;
}

export interface PlanResponse {
  city: CityId;
  timezone?: string;
  now: string;
  source: Source;
  snapshot_taken?: string;
  inputs: PlanInputs;
  reward_go: Vec4;
  belief_now: Vec4;
  state_now: ClassIdx;
  hours: PlanHour[];
  p_skip: number;
  decision: PlanDecision;
}

// ---------------------------------------------------------------- /api/route

export interface RouteEnd {
  lat: number;
  lon: number;
  snapped: LatLon;
  snap_m: number;
}

export interface RouteInfo {
  coords: LatLon[];
  distance_m: number;
  minutes: number;
  weighted_cost: number;
  mean_index: number;
  exposure_score: number;
  by_kind: Record<string, number>;
  expanded: number;
  expanded_dijkstra: number;
}

export interface CleanestRoute extends RouteInfo {
  explored: LatLon[];
}

export interface RouteResponse {
  city: CityId;
  timezone?: string;
  source?: Source;
  h_factor?: number;
  from: RouteEnd;
  to: RouteEnd;
  at: string;
  pm25_at: number;
  ventilation_m3h: number;
  /** set when the backend moved a stale `at` to now */
  at_clamped?: boolean;
  shortest: RouteInfo;
  cleanest: CleanestRoute;
  comparison: {
    extra_distance_pct: number;
    extra_minutes: number;
    exposure_reduction_pct: number;
    same_route: boolean;
  };
}

// ---------------------------------------------------------------- /api/places

export interface PlaceResult {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

export interface PlacesResponse {
  source?: string;
  results: PlaceResult[];
}

// ---------------------------------------------------------------- request params

export interface PlanParams {
  city: CityId;
  activity: ActivityId;
  duration: number;
  deadline: number;
  wait_cost: number;
  sensitive: boolean;
  reliability: number;
}

export interface RouteParams {
  city: CityId;
  from: LatLon;
  to: LatLon;
  activity: ActivityId;
  at?: string;
  /** the backend also accepts the trust setting, used for E[pm] at `at` */
  reliability?: number;
}
