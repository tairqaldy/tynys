import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { num } from '../lib/format';

describe('API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends city on every city-scoped request', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(u);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await api.air('almaty', 0.8);
    await api.plan({ city: 'almaty', activity: 'walk', duration: 45, deadline: 8, wait_cost: 0.3, sensitive: false, reliability: 0.8 });
    await api.route({ city: 'almaty', from: [43.2, 76.9], to: [43.25, 76.95], activity: 'walk' });
    await api.places('almaty', 'bazaar');
    expect(urls).toHaveLength(4);
    for (const u of urls) expect(new URL(u, 'http://x').searchParams.get('city')).toBe('almaty');
  });

  it('returns API errors with their code and message', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'too_far', message: 'Too far.' } }), { status: 400 }),
    );
    await expect(api.route({ city: 'astana', from: [51, 71], to: [51.2, 71.5], activity: 'walk' })).rejects.toMatchObject({
      code: 'too_far',
      status: 400,
      message: 'Too far.',
    });
  });
});

describe('num', () => {
  it('shows an em dash for missing or non-finite values', () => {
    expect(num(null)).toBe('—');
    expect(num(undefined)).toBe('—');
    expect(num(Infinity)).toBe('—');
    expect(num(Number.NaN)).toBe('—');
    expect(num(-1.234, 1)).toBe('−1.2');
  });
});
