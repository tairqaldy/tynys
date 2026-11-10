// Smoke test: render every section to static markup with each fixture, at a desktop and a phone
// chart width, and check nothing throws and no NaN / undefined / Infinity leaks into the page.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AirResponse, MetaResponse, PlanResponse, RouteResponse } from '../api/types';
import type { RequestState } from '../lib/hooks';

let width = 640;
vi.mock('../lib/hooks', async (orig) => {
  const mod = await orig<typeof import('../lib/hooks')>();
  return { ...mod, useWidth: () => [{ current: null }, width] };
});

const { Now } = await import('../sections/Now');
const { When } = await import('../sections/When');
const { Which } = await import('../sections/Which');
const { MathSection } = await import('../sections/MathSection');
const { About } = await import('../sections/About');

const files = import.meta.glob('../mocks/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const get = <T,>(n: string) => files[`../mocks/${n}.json`] as T;
const meta = get<MetaResponse>('meta');

function req<T>(data: T): RequestState<T> {
  return { data, dataKey: 'k', error: null, loading: false, retry: () => {} };
}

function clean(html: string) {
  const text = html.replace(/<[^>]+>/g, ' ');
  expect(text).not.toMatch(/\bNaN\b|\bundefined\b|Infinity|\[object Object\]/);
  expect(html).not.toMatch(/="[^"]*(NaN|Infinity|undefined)[^"]*"/);
}

describe.each([640, 343])('sections at %ipx', (w) => {
  for (const city of ['astana', 'almaty'] as const) {
    const cm = meta.cities.find((c) => c.id === city)!;
    const air = get<AirResponse>(`air_${city}`);
    const route = get<RouteResponse>(`route_${city}`);

    it(`${city}: Now`, () => {
      width = w;
      const html = renderToStaticMarkup(<Now req={req(air)} air={air} cityName={cm.name} reliability={0.8} setReliability={() => {}} />);
      clean(html);
      expect(html).toContain(`Particle pollution in ${cm.name}`);
    });

    for (const act of ['walk', 'run', 'kids', 'errand'] as const) {
      it(`${city}: When (${act}) and the MDP panel`, () => {
        width = w;
        const plan = get<PlanResponse>(`plan_${city}_${act}`);
        const html = renderToStaticMarkup(
          <When
            req={req(plan)}
            plan={plan}
            activities={meta.activities}
            controls={{ activity: act, duration: plan.inputs.duration_min, deadline: plan.inputs.deadline_hours, waitCost: plan.inputs.wait_cost, sensitive: plan.inputs.sensitive }}
            setControls={() => {}}
          />,
        );
        clean(html);
        const m = renderToStaticMarkup(<MathSection air={air} plan={plan} route={route} kinds={meta.kinds} />);
        clean(m);
        if (plan.inputs.must) expect(html).not.toContain('>skip<');
      });
    }

    it(`${city}: Which way with the saved route`, () => {
      width = w;
      const p = (e: { lat: number; lon: number }) => ({ lat: e.lat, lon: e.lon, label: 'x' });
      const html = renderToStaticMarkup(
        <Which
          city={cm}
          kinds={meta.kinds}
          from={p(route.from)}
          to={p(route.to)}
          setPoint={() => {}}
          swap={() => {}}
          pickTarget="to"
          setPickTarget={() => {}}
          req={req(route)}
          route={route}
          atText="now"
          verb="walking"
          onReplay={() => {}}
          onClear={() => {}}
          shown={Math.floor(route.cleanest.explored.length / 2)}
          example
          replaying={false}
          pointMsg={null}
          mapSlot={null}
          mapFailed={null}
        />,
      );
      clean(html);
      expect(html).toContain('less traffic exposure');
    });

    it(`${city}: About`, () => {
      const html = renderToStaticMarkup(<About meta={meta} city={cm} />);
      clean(html);
      expect(html).toContain('Tair Kaldybayev');
    });
  }
});
