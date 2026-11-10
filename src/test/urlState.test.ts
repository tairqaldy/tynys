import { describe, expect, it } from 'vitest';
import { parseUrlState, writeUrlState } from '../lib/urlState';

describe('URL state', () => {
  it('round-trips the main state and keeps unrelated parameters', () => {
    const search = writeUrlState('?mock=1', {
      city: 'almaty',
      activity: 'run',
      duration: 40,
      deadline: 6,
      wait: 0.5,
      sensitive: true,
      reliability: 0.7,
      from: { lat: 43.238884, lon: 76.945474, name: 'Republic Square' },
      to: { lat: 43.263676, lon: 76.955197 },
    });
    expect(search).toContain('mock=1');
    expect(parseUrlState(search)).toEqual({
      city: 'almaty',
      activity: 'run',
      duration: 40,
      deadline: 6,
      wait: 0.5,
      sensitive: true,
      reliability: 0.7,
      from: { lat: 43.238884, lon: 76.945474, name: 'Republic Square' },
      to: { lat: 43.263676, lon: 76.955197 },
    });
  });

  it('ignores junk silently', () => {
    expect(
      parseUrlState(
        '?city=paris&activity=swim&duration=999&deadline=0&wait=abc&sensitive=yes&r=2&from=hello&to=91,10&fromName=x',
      ),
    ).toEqual({});
    expect(parseUrlState('?from=51.1,71.4,3')).toEqual({});
    expect(parseUrlState('%%%')).toEqual({});
  });

  it('snaps values to the control steps and cleans names', () => {
    const s = parseUrlState('?duration=47&wait=0.33&r=0.81&from=51.1,71.4&fromName=%0A%20Baiterek%20');
    expect(s.duration).toBe(45);
    expect(s.wait).toBe(0.3);
    expect(s.reliability).toBe(0.8);
    expect(s.from).toEqual({ lat: 51.1, lon: 71.4, name: 'Baiterek' });
  });
});
