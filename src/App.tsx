import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, mockStore } from './api/client';
import type { ActivityMeta, CityId, LatLon, PlanParams, RouteParams } from './api/types';
import { Badge, ClassPatterns, ErrorState, Skeleton } from './components/common';
import { Header } from './components/Header';
// MapLibre is large; load it after the first paint so the answers appear first.
const MapView = lazy(() => import('./components/MapView').then((m) => ({ default: m.MapView })));
import type { RoutePoint } from './components/PlaceField';
import { CLASS_IDS, CLASS_LABEL } from './lib/classes';
import { dayMonth, hhmm, relTime } from './lib/format';
import { useDebounced, useMediaQuery, useReducedMotion, useRequest } from './lib/hooks';
import { load, save } from './lib/storage';
import { parseUrlState, writeUrlState, type UrlPoint } from './lib/urlState';
import type { Navigate } from './lib/route';
import { useTheme } from './lib/theme';
import { usePageFocus } from './lib/route';
import { About } from './sections/About';
import { MathSection } from './sections/MathSection';
import { Now } from './sections/Now';
import { Overview } from './sections/Overview';
import { When, type PlanControls } from './sections/When';
import { Which } from './sections/Which';

// Used until /api/meta answers (same values as docs/SPEC.md §4.4), so Now and When never wait on meta.
const FALLBACK_ACTIVITIES: ActivityMeta[] = [
  { id: 'walk', label: 'Walk', duration_min: 45, intensity: 1.0, benefit: 5, must: false },
  { id: 'run', label: 'Run', duration_min: 40, intensity: 2.5, benefit: 8, must: false },
  { id: 'kids', label: 'Outside with a child', duration_min: 60, intensity: 1.0, benefit: 6, must: false },
  { id: 'errand', label: 'Errand on foot', duration_min: 30, intensity: 1.0, benefit: 6, must: true },
];
const FALLBACK_CITIES: { id: CityId; name: string }[] = [
  { id: 'astana', name: 'Astana' },
  { id: 'almaty', name: 'Almaty' },
];

/** The example route drawn on first load, so the map is never empty: [from id, to id] per city. */
const STARTER: Record<CityId, [string, string]> = {
  astana: ['khan-shatyr', 'ak-orda'],
  almaty: ['republic-square', 'green-bazaar'],
};

const mapPointLabel = (lat: number, lon: number) => `Map point ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
const fromUrl = (p?: UrlPoint): RoutePoint | null => (p ? { lat: p.lat, lon: p.lon, label: p.name ?? mapPointLabel(p.lat, p.lon) } : null);

export default function App({ navigate }: { navigate: Navigate }) {
  // ---------------------------------------------------------------- persistent choices (URL first, then storage)
  const [urlInit] = useState(() => parseUrlState(window.location.search));
  const [city, setCityState] = useState<CityId>(() => urlInit.city ?? (load('tynys.city') === 'almaty' ? 'almaty' : 'astana'));
  const [theme, toggleTheme] = useTheme();
  usePageFocus(false);

  const usingMock = useSyncExternalStore(mockStore.subscribe, mockStore.get, () => false);
  const reducedMotion = useReducedMotion();
  const narrow = useMediaQuery('(max-width: 880px)');

  // ---------------------------------------------------------------- meta
  const metaReq = useRequest('meta', (s) => api.meta(s));
  const meta = metaReq.data;
  const cityMeta = meta?.cities.find((c) => c.id === city) ?? null;
  const cityName = cityMeta?.name ?? FALLBACK_CITIES.find((c) => c.id === city)!.name;
  const activities = meta?.activities ?? FALLBACK_ACTIVITIES;

  // ---------------------------------------------------------------- air
  const [reliability, setReliability] = useState(urlInit.reliability ?? 0.8);
  const relDeb = useDebounced(reliability, 350);
  const airReq = useRequest(`${city}|${relDeb}`, (s) => api.air(city, relDeb, s));
  const air = airReq.data && airReq.data.city === city ? airReq.data : null;

  // the atmosphere of the page follows the current class
  const airClass = air ? CLASS_IDS[air.hmm.state_now] : null;
  useLayoutEffect(() => {
    const el = document.documentElement;
    if (airClass) el.dataset.air = airClass;
    else delete el.dataset.air;
  }, [airClass]);
  useEffect(() => {
    document.title = air ? `Tynys — particle pollution ${CLASS_LABEL[air.hmm.state_now].toLowerCase()} in ${cityName}` : `Tynys — air in ${cityName}`;
  }, [air, cityName]);

  // ---------------------------------------------------------------- plan
  const [controls, setControlsState] = useState<PlanControls>(() => {
    const activity = urlInit.activity ?? 'walk';
    return {
      activity,
      duration: urlInit.duration ?? FALLBACK_ACTIVITIES.find((a) => a.id === activity)!.duration_min,
      deadline: urlInit.deadline ?? 8,
      waitCost: urlInit.wait ?? 0.3,
      sensitive: urlInit.sensitive ?? false,
    };
  });
  const setControls = useCallback((patch: Partial<PlanControls>) => setControlsState((c) => ({ ...c, ...patch })), []);
  const planParams: PlanParams = {
    city,
    activity: controls.activity,
    duration: controls.duration,
    deadline: controls.deadline,
    wait_cost: controls.waitCost,
    sensitive: controls.sensitive || controls.activity === 'kids',
    reliability,
  };
  const planKey = useDebounced(JSON.stringify(planParams), 350);
  const planReq = useRequest(planKey, (s) => api.plan(JSON.parse(planKey) as PlanParams, s));
  const plan = planReq.data && planReq.data.city === city ? planReq.data : null;

  // ---------------------------------------------------------------- route
  const [from, setFromState] = useState<RoutePoint | null>(() => fromUrl(urlInit.from));
  const [to, setToState] = useState<RoutePoint | null>(() => fromUrl(urlInit.to));
  const [example, setExample] = useState(false);
  const [pickTarget, setPickTarget] = useState<'from' | 'to'>(() => (urlInit.from && !urlInit.to ? 'to' : 'from'));
  const [replay, setReplay] = useState(0);
  const [clearExplored, setClearExplored] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [mapFailed, setMapFailed] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<'loading' | 'ready' | 'failed'>('loading');
  // any point the user sets ends the example
  const setFrom = useCallback((p: RoutePoint | null) => {
    setFromState(p);
    setExample(false);
  }, []);
  const setTo = useCallback((p: RoutePoint | null) => {
    setToState(p);
    setExample(false);
  }, []);

  // The city whose example route has been considered; points from the URL count as a choice.
  const seeded = useRef<CityId | null>(urlInit.from || urlInit.to ? city : null);

  const setCity = (c: CityId) => {
    if (c === city) return;
    setCityState(c);
    save('tynys.city', c);
    setFrom(null);
    setTo(null);
    setPickTarget('from');
  };

  const seedExample = useCallback(() => {
    if (!cityMeta) return;
    const byId = (id: string) => cityMeta.places.find((p) => p.id === id);
    const [a, b] = STARTER[cityMeta.id];
    const pa = byId(a) ?? cityMeta.places[0];
    const pb = byId(b) ?? cityMeta.places[1];
    if (!pa || !pb) return;
    setFromState({ lat: pa.lat, lon: pa.lon, label: pa.name });
    setToState({ lat: pb.lat, lon: pb.lon, label: pb.name });
    setExample(true);
    setPickTarget('from');
  }, [cityMeta]);

  // Example route on first load and after a city switch, when nothing is chosen yet.
  useEffect(() => {
    if (!cityMeta || seeded.current === city) return;
    seeded.current = city;
    if (!from && !to) seedExample();
  }, [cityMeta, city, from, to, seedExample]);

  const inside = useCallback(
    (p: { lat: number; lon: number }) => {
      if (!cityMeta) return true;
      const [s, w, n, e] = cityMeta.bbox;
      return p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;
    },
    [cityMeta],
  );
  const outside: string[] = [];
  if (from && !inside(from)) outside.push('A (from)');
  if (to && !inside(to)) outside.push('B (to)');
  const pointMsg = outside.length
    ? `Point ${outside.join(' and ')} is outside the area the street graph covers. Pick a point inside the dashed outline on the map.`
    : null;

  const setPoint = (which: 'from' | 'to', p: RoutePoint | null) => {
    if (which === 'from') {
      setFrom(p);
      if (p) setPickTarget('to');
    } else {
      setTo(p);
    }
  };
  const onPick = useCallback(
    (ll: LatLon) => {
      const p: RoutePoint = { lat: ll[0], lon: ll[1], label: mapPointLabel(ll[0], ll[1]) };
      if (pickTarget === 'from') {
        setFrom(p);
        setPickTarget('to');
      } else setTo(p);
    },
    [pickTarget, setFrom, setTo],
  );
  const onDrag = useCallback(
    (which: 'from' | 'to', ll: LatLon) => {
      const p: RoutePoint = { lat: ll[0], lon: ll[1], label: mapPointLabel(ll[0], ll[1]) };
      if (which === 'from') setFrom(p);
      else setTo(p);
    },
    [setFrom, setTo],
  );
  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  // Score the route for the hour the plan recommends; wait for the plan so we do not fetch twice.
  const at = plan && plan.decision.action === 'wait' && plan.decision.best_time ? plan.decision.best_time : undefined;
  const planSettled = plan !== null || (!planReq.loading && planReq.error !== null);
  const routeKey =
    from && to && !pointMsg && planSettled
      ? JSON.stringify({
          city,
          from: [from.lat, from.lon],
          to: [to.lat, to.lon],
          activity: planParams.activity,
          at,
          reliability: relDeb,
        })
      : null;
  const routeReq = useRequest(routeKey, (s) => {
    return api.route(JSON.parse(routeKey!) as RouteParams, s);
  });
  const route = routeKey && routeReq.data && !routeReq.error && routeReq.data.city === city ? routeReq.data : null;
  const atText = at && plan ? `${relTime(at, plan.now)}, the hour the plan suggests` : 'now';
  useEffect(() => {
    setReplaying(false);
    setShown(null);
  }, [route]);

  // ---------------------------------------------------------------- shareable URL
  const urlSearch = writeUrlState(window.location.search, {
    city,
    activity: controls.activity,
    duration: controls.duration,
    deadline: controls.deadline,
    wait: controls.waitCost,
    sensitive: controls.sensitive,
    reliability,
    // the example route is not a choice, so it stays out of the link
    from: !example && from ? { lat: from.lat, lon: from.lon, name: from.label.startsWith('Map point') ? undefined : from.label } : undefined,
    to: !example && to ? { lat: to.lat, lon: to.lon, name: to.label.startsWith('Map point') ? undefined : to.label } : undefined,
  });
  const urlDeb = useDebounced(urlSearch, 400);
  useEffect(() => {
    if (urlDeb === window.location.search) return;
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${urlDeb}${window.location.hash}`);
    } catch {
      /* some browsers rate-limit replaceState; the next change will try again */
    }
  }, [urlDeb]);

  // ---------------------------------------------------------------- map placement
  const mapEl = useMemo(() => {
    const el = document.createElement('div');
    el.className = 'map-canvas';
    return el;
  }, []);
  const desktopSlot = useRef<HTMLDivElement>(null);
  const mobileSlot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = narrow ? mobileSlot.current : desktopSlot.current;
    if (slot && mapEl.parentElement !== slot) slot.appendChild(mapEl);
  }, [narrow, mapEl, cityMeta]);

  // ---------------------------------------------------------------- badges
  const snapshot = air?.source === 'snapshot' ? air : plan?.source === 'snapshot' ? plan : null;
  const badges = (
    <>
      {usingMock && (
        <Badge kind="mock" title="The API was not reachable, so the page shows saved development responses, not live data.">
          Mock data
        </Badge>
      )}
      {snapshot && (
        <Badge kind="snapshot" title="Live data could not be fetched; the server is showing a saved snapshot.">
          Snapshot data
          {snapshot.snapshot_taken ? ` · ${dayMonth(snapshot.snapshot_taken)} ${hhmm(snapshot.snapshot_taken)}` : ''}
        </Badge>
      )}
    </>
  );

  const legend = (
    <>
      <MapLegend airLabel={air ? CLASS_LABEL[air.hmm.state_now] : null} hasRoute={!!route} same={!!route?.comparison.same_route} />
      {basemap !== 'ready' && !mapFailed && (
        <p className={`map-status map-status--${basemap}`} role="status">
          {basemap === 'loading'
            ? 'Loading map…'
            : 'The street map could not load, so the routes are drawn on a plain background.'}
        </p>
      )}
    </>
  );

  return (
    <>
      <ClassPatterns />
      <Header
        page="planner"
        navigate={navigate}
        city={city}
        setCity={setCity}
        cities={meta?.cities.map((c) => ({ id: c.id, name: c.name })) ?? FALLBACK_CITIES}
        theme={theme}
        toggleTheme={toggleTheme}
        badges={badges}
      />
      <div className="layout">
        <main id="main" className="column" tabIndex={-1}>
          {(usingMock || snapshot) && (
            <p className="data-note" role="note">
              {usingMock
                ? 'Mock data: this page shows saved copies of earlier API responses (10 Nov 2026, 11:00), not live answers. They do not follow every control the way the live API does.'
                : 'Live air data could not be fetched, so these numbers come from a saved snapshot of the same model.'}
            </p>
          )}
          <Overview air={air} plan={plan} route={route} cityName={cityName} airError={!air && airReq.error !== null} />
          <Now req={airReq} air={air} cityName={cityName} reliability={reliability} setReliability={setReliability} />
          <When req={planReq} plan={plan} activities={activities} controls={controls} setControls={setControls} />
          {cityMeta && meta ? (
            <Which
              city={cityMeta}
              kinds={meta.kinds}
              from={from}
              to={to}
              setPoint={setPoint}
              swap={swap}
              pickTarget={pickTarget}
              setPickTarget={setPickTarget}
              req={routeReq}
              route={route}
              atText={atText}
              verb={controls.activity === 'run' ? 'running' : 'walking'}
              onReplay={() => {
                setReplaying(true);
                setReplay((n) => n + 1);
              }}
              onClear={() => {
                setReplaying(false);
                setShown(null);
                setClearExplored((n) => n + 1);
              }}
              shown={shown}
              example={example}
              replaying={replaying}
              pointMsg={pointMsg}
              onUseExample={seedExample}
              onClearPoints={() => {
                setFrom(null);
                setTo(null);
                setPickTarget('from');
              }}
              mapFailed={mapFailed}
              mapSlot={
                narrow ? (
                  <div className="map-frame map-frame--inline">
                    <div ref={mobileSlot} className="map-slot" />
                    {legend}
                  </div>
                ) : null
              }
            />
          ) : (
            <section className="q" id="which" aria-label="Which way should I walk?">
              {metaReq.error ? (
                <ErrorState title="The route planner did not load." message={metaReq.error.message} onRetry={metaReq.retry} />
              ) : (
                <Skeleton lines={3} />
              )}
            </section>
          )}
          <MathSection air={air} plan={plan} route={route} kinds={meta?.kinds ?? []} navigate={navigate} />
          <About meta={meta} city={cityMeta} navigate={navigate} />
        </main>
        {!narrow && (
          <aside className="map-aside" aria-label="Map">
            <div className="map-frame">
              <div ref={desktopSlot} className="map-slot" />
              {legend}
            </div>
          </aside>
        )}
      </div>
      <Suspense fallback={null}>
      <MapView
        container={mapEl}
        theme={theme}
        air={airClass}
        bbox={cityMeta?.bbox ?? null}
        route={route}
        from={from}
        to={to}
        onPick={onPick}
        onDrag={onDrag}
        replay={replay}
        clear={clearExplored}
        onReplayProgress={setShown}
        reducedMotion={reducedMotion}
        cooperative={narrow}
        onReplayDone={() => setReplaying(false)}
        onFail={setMapFailed}
        onStatus={setBasemap}
      />
      </Suspense>
    </>
  );
}

function MapLegend({ airLabel, hasRoute, same }: { airLabel: string | null; hasRoute: boolean; same: boolean }) {
  return (
    <div className="map-legend" aria-hidden="true">
      {hasRoute && (
        <span className="map-legend__item">
          <span className="lg lg--clean" /> {same ? 'shortest = least exposure' : 'least exposure'}
        </span>
      )}
      {hasRoute && !same && (
        <span className="map-legend__item">
          <span className="lg lg--short" /> shortest
        </span>
      )}
      <span className="map-legend__item">
        <span className="lg lg--cover" /> street graph coverage
      </span>
      {airLabel && <span className="map-legend__item map-legend__air">tint follows the air: {airLabel.toLowerCase()}</span>}
    </div>
  );
}
