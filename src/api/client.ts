// Small typed client for the Tynys API (docs/SPEC.md §6).
//
// Mock data is used only when the URL has ?mock=1, or in development when the API cannot be
// reached at all. Production never falls back silently; whenever mock data is served the
// `mockStore` flips on and the page shows a "Mock data" badge.

import type {
  AirResponse,
  ApiErrorBody,
  CityId,
  MetaResponse,
  PlacesResponse,
  PlanParams,
  PlanResponse,
  RouteParams,
  RouteResponse,
} from './types';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

// ---------------------------------------------------------------- mock switch

type Listener = () => void;
const listeners = new Set<Listener>();
const forceMock = (() => {
  try {
    const v = new URLSearchParams(window.location.search).get('mock');
    return v !== null && v !== '0' && v !== 'false';
  } catch {
    return false;
  }
})();
let mockOn = forceMock;

export const mockStore = {
  get: () => mockOn,
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(v: boolean) {
    if (v === mockOn) return;
    mockOn = v;
    listeners.forEach((l) => l());
  },
};

// ---------------------------------------------------------------- transport

type Query = Record<string, string | number | boolean | undefined>;

function qs(params: Query): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    u.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function request<T>(name: string, params: Query, signal?: AbortSignal): Promise<T> {
  if (mockOn && forceMock) return mockFor<T>(name, params, signal);
  let res: Response;
  try {
    res = await fetch(`/api/${name}${qs(params)}`, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (isAbort(e)) throw e;
    if (import.meta.env.DEV) return mockFor<T>(name, params, signal);
    throw new ApiError('network', 'The server could not be reached. Check your connection and try again.', 0);
  }
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    if (err && typeof err.message === 'string') {
      throw new ApiError(err.code ?? 'error', err.message, res.status);
    }
    // No API-shaped error: the dev proxy could not reach the Python server.
    if (import.meta.env.DEV && (res.status >= 500 || res.status === 404)) {
      return mockFor<T>(name, params, signal);
    }
    throw new ApiError('http', `The server answered with an error (HTTP ${res.status}).`, res.status);
  }
  if (body === null) {
    if (import.meta.env.DEV) return mockFor<T>(name, params, signal);
    throw new ApiError('parse', 'The server sent a response that could not be read.', res.status);
  }
  if (!forceMock) mockStore.set(false);
  return body as T;
}

async function mockFor<T>(name: string, params: Query, signal?: AbortSignal): Promise<T> {
  mockStore.set(true);
  const mod = await import('../mocks/mock');
  try {
    return (await mod.mockResponse(name, params, signal)) as T;
  } catch (e) {
    if (isAbort(e)) throw e;
    const m = e as { code?: string; message?: string; status?: number };
    throw new ApiError(m.code ?? 'mock', m.message ?? 'Mock error', m.status ?? 400);
  }
}

// ---------------------------------------------------------------- endpoints

export const api = {
  meta: (signal?: AbortSignal) => request<MetaResponse>('meta', {}, signal),

  air: (city: CityId, reliability: number, signal?: AbortSignal) =>
    request<AirResponse>('air', { city, reliability: reliability.toFixed(2) }, signal),

  plan: (p: PlanParams, signal?: AbortSignal) =>
    request<PlanResponse>(
      'plan',
      {
        city: p.city,
        activity: p.activity,
        duration: p.duration,
        deadline: p.deadline,
        wait_cost: p.wait_cost.toFixed(2),
        sensitive: p.sensitive,
        reliability: p.reliability.toFixed(2),
      },
      signal,
    ),

  route: (p: RouteParams, signal?: AbortSignal) =>
    request<RouteResponse>(
      'route',
      {
        city: p.city,
        from: `${p.from[0].toFixed(6)},${p.from[1].toFixed(6)}`,
        to: `${p.to[0].toFixed(6)},${p.to[1].toFixed(6)}`,
        activity: p.activity,
        at: p.at,
        reliability: p.reliability?.toFixed(2),
      },
      signal,
    ),

  places: (city: CityId, q: string, signal?: AbortSignal) =>
    request<PlacesResponse>('places', { city, q }, signal),
};
