import { useEffect, useRef } from 'react';
import {
  AttributionControl,
  LngLatBounds,
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type FilterSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre builds its worker URL at runtime, which bundlers cannot see; point it at the emitted file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection, Position } from 'geojson';
import type { BBox, ClassId, LatLon, RouteResponse } from '../api/types';
import type { RoutePoint } from './PlaceField';

setWorkerUrl(workerUrl);

// OpenFreeMap styles (https://openfreemap.org): Positron is a quiet light basemap, Dark its night twin.
export const MAP_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

interface Props {
  container: HTMLElement;
  theme: 'light' | 'dark';
  air: ClassId | null;
  bbox: BBox | null;
  route: RouteResponse | null;
  from: RoutePoint | null;
  to: RoutePoint | null;
  onPick: (p: LatLon) => void;
  onDrag: (which: 'from' | 'to', p: LatLon) => void;
  replay: number;
  /** increment to remove the replayed search from the map */
  clear: number;
  onReplayProgress: (shown: number) => void;
  reducedMotion: boolean;
  cooperative: boolean;
  onReplayDone: () => void;
  onFail: (msg: string) => void;
  onStatus: (s: BasemapStatus) => void;
}

type FC = FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const WORLD: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

function bboxRing(b: BBox): Position[] {
  const [s, w, n, e] = b;
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/** The first share `e` (0..1) of a polyline, measured along its length, ending on an interpolated point. */
function partialLine(coords: LatLon[], e: number): LatLon[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180)));
  }
  const target = e * cum[cum.length - 1];
  let j = 1;
  while (j < coords.length - 1 && cum[j] < target) j++;
  const seg = cum[j] - cum[j - 1] || 1;
  const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / seg));
  const [a, b] = [coords[j - 1], coords[j]];
  return [...coords.slice(0, j), [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]];
}

const line = (coords: LatLon[]): FC => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(([la, lo]) => [lo, la]) } }],
});

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function markerEl(letter: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `map-marker map-marker--${letter.toLowerCase()}`;
  el.textContent = letter;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Drop road-shield layers: not needed on a quiet basemap, and their filters warn in MapLibre 6. */
const quiet = (style: StyleSpecification): StyleSpecification => ({
  ...style,
  layers: style.layers.filter((l) => !/shield/i.test(l.id)),
});

/** A plain paper-coloured style: shown at once, and kept if the basemap cannot be loaded. */
const plainStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'paper', type: 'background', paint: { 'background-color': cssVar('--paper') } }],
});

export type BasemapStatus = 'loading' | 'ready' | 'failed';

const HIDE_ALL: FilterSpecification = ['<', ['get', 'i'], -1];
/** how many of the most recently expanded nodes are drawn darker, so the search frontier shows */
const FRONTIER = 250;
const frontierOpacity = (n: number) => ['case', ['>=', ['get', 'i'], n - FRONTIER], 0.95, 0.45] as unknown as number;

export function MapView(p: Props) {
  const mapRef = useRef<MlMap | null>(null);
  const data = useRef({ mask: EMPTY, coverage: EMPTY, short: EMPTY, clean: EMPTY, explored: EMPTY });
  const exploredFilter = useRef<FilterSpecification>(HIDE_ALL);
  const markers = useRef<{ from: Marker | null; to: Marker | null }>({ from: null, to: null });
  const cb = useRef(p);
  cb.current = p;
  const anim = useRef<number | null>(null);
  const drawAnim = useRef<number | null>(null);
  const shownRef = useRef(0);
  const cityFits = useRef(0);

  // ------------------------------------------------------------ create once
  useEffect(() => {
    let map: MlMap;
    try {
      map = new MlMap({
        container: p.container,
        // start on plain paper so the coverage outline and routes show while the basemap downloads
        style: plainStyle(),
        center: [71.4304, 51.1282],
        zoom: 12,
        attributionControl: false,
        cooperativeGestures: p.cooperative,
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
      });
    } catch {
      p.onFail('The map could not start in this browser (WebGL is unavailable). You can still search places by name.');
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.getCanvas().style.cursor = 'crosshair';
    map.on('error', () => {
      /* tile or style errors are non-fatal; keep the console quiet */
    });
    map.on('style.load', () => install(map));
    // The dark style references a fill pattern its sprite lacks; supply a transparent pixel.
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.on('click', (e) => cb.current.onPick([e.lngLat.lat, e.lngLat.lng]));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(p.container);
    return () => {
      ro.disconnect();
      if (anim.current) cancelAnimationFrame(anim.current);
      if (drawAnim.current) cancelAnimationFrame(drawAnim.current);
      markers.current.from?.remove();
      markers.current.to?.remove();
      markers.current = { from: null, to: null };
      map.remove();
      mapRef.current = null;
    };
  }, [p.container]);

  function install(map: MlMap) {
    const d = data.current;
    const add = (id: string, fc: FC) => {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: fc });
      else (map.getSource(id) as GeoJSONSource).setData(fc);
    };
    add('t-haze', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD] } }] });
    add('t-mask', d.mask);
    add('t-coverage', d.coverage);
    add('t-explored', d.explored);
    add('t-short', d.short);
    add('t-clean', d.clean);
    const has = (id: string) => !!map.getLayer(id);
    if (!has('t-haze'))
      map.addLayer({ id: 't-haze', type: 'fill', source: 't-haze', paint: { 'fill-color': cssVar('--haze-color'), 'fill-opacity': Number(cssVar('--haze-opacity')) || 0, 'fill-opacity-transition': { duration: 1400 } } });
    if (!has('t-mask')) map.addLayer({ id: 't-mask', type: 'fill', source: 't-mask', paint: { 'fill-color': cssVar('--ink'), 'fill-opacity': 0.06 } });
    if (!has('t-coverage'))
      map.addLayer({ id: 't-coverage', type: 'line', source: 't-coverage', paint: { 'line-color': cssVar('--ink-3'), 'line-width': 1.2, 'line-dasharray': [3, 3], 'line-opacity': 0.7 } });
    if (!has('t-explored'))
      map.addLayer({
        id: 't-explored',
        type: 'circle',
        source: 't-explored',
        filter: exploredFilter.current,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.4, 14, 3, 17, 4],
          'circle-color': cssVar('--accent'),
          'circle-opacity': frontierOpacity(shownRef.current),
          'circle-stroke-width': 0,
        },
      });
    if (!has('t-short'))
      map.addLayer({
        id: 't-short',
        type: 'line',
        source: 't-short',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': cssVar('--route-short'), 'line-width': 3.5, 'line-dasharray': [0.1, 2], 'line-opacity': 0.95 },
      });
    if (!has('t-clean-casing'))
      map.addLayer({
        id: 't-clean-casing',
        type: 'line',
        source: 't-clean',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': cssVar('--paper'), 'line-width': 8.5 },
      });
    if (!has('t-clean'))
      map.addLayer({
        id: 't-clean',
        type: 'line',
        source: 't-clean',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': cssVar('--accent'), 'line-width': 5 },
      });
    recolor(map);
  }

  function recolor(map: MlMap) {
    if (!map.getLayer('t-haze')) return;
    map.setPaintProperty('t-haze', 'fill-color', cssVar('--haze-color'));
    map.setPaintProperty('t-haze', 'fill-opacity', Number(cssVar('--haze-opacity')) || 0);
    map.setPaintProperty('t-mask', 'fill-color', cssVar('--ink'));
    map.setPaintProperty('t-coverage', 'line-color', cssVar('--ink-3'));
    map.setPaintProperty('t-explored', 'circle-color', cssVar('--accent'));
    map.setPaintProperty('t-short', 'line-color', cssVar('--route-short'));
    map.setPaintProperty('t-clean-casing', 'line-color', cssVar('--paper'));
    map.setPaintProperty('t-clean', 'line-color', cssVar('--accent'));
  }

  function setData(id: 'mask' | 'coverage' | 'short' | 'clean' | 'explored', fc: FC) {
    data.current[id] = fc;
    const src = mapRef.current?.getSource(`t-${id}`) as GeoJSONSource | undefined;
    src?.setData(fc);
  }

  // ------------------------------------------------------------ theme
  // Fetch the basemap style ourselves so a failure leaves the plain style (and the routes) in place.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 15000);
    let done = false;
    cb.current.onStatus('loading');
    fetch(MAP_STYLES[p.theme], { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<StyleSpecification>;
      })
      .then((json) => {
        if (done) return;
        m.setStyle(quiet(json), { diff: false });
        m.once('idle', () => {
          if (!done) cb.current.onStatus('ready');
        });
      })
      .catch(() => {
        if (done) return;
        // keep the plain style (still in place unless a basemap loaded before); install() re-adds our layers
        if (m.getLayer('paper')) m.setPaintProperty('paper', 'background-color', cssVar('--paper'));
        else m.setStyle(plainStyle(), { diff: false });
        cb.current.onStatus('failed');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      done = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [p.theme, p.container]);

  // ------------------------------------------------------------ air → haze and accent
  useEffect(() => {
    const m = mapRef.current;
    if (m) recolor(m);
  }, [p.air, p.theme]);

  // ------------------------------------------------------------ coverage + city view
  useEffect(() => {
    const m = mapRef.current;
    if (!p.bbox) return;
    setData('mask', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD, bboxRing(p.bbox).slice().reverse()] } }] });
    setData('coverage', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: bboxRing(p.bbox) } }] });
    const [s, w, n, e] = p.bbox;
    // the first view is instant; switching city flies there (instant under reduced motion)
    const first = cityFits.current === 0;
    if (m) cityFits.current += 1;
    m?.fitBounds([[w, s], [e, n]], { padding: 24, duration: first || cb.current.reducedMotion ? 0 : 1600 });
  }, [p.bbox?.join(',')]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (p.cooperative) m.cooperativeGestures.enable();
    else m.cooperativeGestures.disable();
  }, [p.cooperative]);

  // ------------------------------------------------------------ route
  useEffect(() => {
    const r = p.route;
    if (anim.current) cancelAnimationFrame(anim.current);
    if (drawAnim.current) cancelAnimationFrame(drawAnim.current);
    drawAnim.current = null;
    exploredFilter.current = HIDE_ALL;
    shownRef.current = 0;
    anim.current = null;
    mapRef.current?.getLayer('t-explored') && mapRef.current.setFilter('t-explored', HIDE_ALL);
    if (!r) {
      setData('short', EMPTY);
      setData('clean', EMPTY);
      setData('explored', EMPTY);
      return;
    }
    // draw both routes in from A to B (by distance), unless motion is reduced
    const clean = r.cleanest.coords;
    const short = r.comparison.same_route ? null : r.shortest.coords;
    const showAt = (e: number) => {
      setData('clean', line(e >= 1 ? clean : partialLine(clean, e)));
      setData('short', short ? line(e >= 1 ? short : partialLine(short, e)) : EMPTY);
    };
    if (cb.current.reducedMotion || clean.length < 3) showAt(1);
    else {
      const t0 = performance.now();
      const D = 1200;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / D);
        showAt(1 - Math.pow(1 - k, 3));
        drawAnim.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      showAt(0.001);
      drawAnim.current = requestAnimationFrame(step);
    }
    setData('explored', {
      type: 'FeatureCollection',
      features: r.cleanest.explored.map(([la, lo], i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [lo, la] } })),
    });
    fitRoute();
  }, [p.route]);

  /** Fit both routes and both picked points, leaving room for the legend, the controls and the attribution. */
  function fitRoute() {
    const m = mapRef.current;
    const r = cb.current.route;
    if (!m || !r) return;
    const b = new LngLatBounds();
    [...r.cleanest.coords, ...r.shortest.coords].forEach(([la, lo]) => b.extend([lo, la]));
    for (const pt of [cb.current.from, cb.current.to]) if (pt) b.extend([pt.lon, pt.lat]);
    if (b.isEmpty()) return;
    const box = p.container;
    const W = box.clientWidth;
    const H = box.clientHeight;
    if (W < 120 || H < 120) return;
    const legend = box.closest('.map-frame')?.querySelector<HTMLElement>('.map-legend');
    const small = W < 480;
    const marker = 18; // half a marker plus a little air
    const pad = {
      top: (legend ? legend.offsetTop + legend.offsetHeight : 0) + marker,
      bottom: 38 + marker,
      left: (small ? 12 : 28) + marker,
      right: (small ? 44 : 56) + marker,
    };
    // never ask for more padding than the map has room for
    const sx = Math.min(1, (W * 0.6) / (pad.left + pad.right));
    const sy = Math.min(1, (H * 0.6) / (pad.top + pad.bottom));
    m.fitBounds(b, {
      padding: { top: pad.top * sy, bottom: pad.bottom * sy, left: pad.left * sx, right: pad.right * sx },
      maxZoom: 16.5,
      duration: cb.current.reducedMotion ? 0 : 900,
    });
  }

  // ------------------------------------------------------------ replay the search
  useEffect(() => {
    const m = mapRef.current;
    const r = cb.current.route;
    if (!p.replay || !m || !r || !m.getLayer('t-explored')) return;
    const N = r.cleanest.explored.length;
    const setN = (n: number) => {
      shownRef.current = n;
      exploredFilter.current = ['<', ['get', 'i'], n];
      m.setFilter('t-explored', exploredFilter.current);
      m.setPaintProperty('t-explored', 'circle-opacity', frontierOpacity(n));
      cb.current.onReplayProgress(n);
    };
    if (cb.current.reducedMotion) {
      setN(N);
      cb.current.onReplayDone();
      return;
    }
    // about 2 ms per point, between 2.5 and 4.5 s
    const dur = Math.max(2500, Math.min(4500, N * 2.2));
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setN(Math.round(N * k));
      if (k < 1) anim.current = requestAnimationFrame(tick);
      else {
        anim.current = null;
        cb.current.onReplayDone();
      }
    };
    setN(0);
    anim.current = requestAnimationFrame(tick);
    return () => {
      if (anim.current) cancelAnimationFrame(anim.current);
    };
  }, [p.replay]);

  useEffect(() => {
    const m = mapRef.current;
    if (!p.clear || !m) return;
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
    shownRef.current = 0;
    exploredFilter.current = HIDE_ALL;
    if (m.getLayer('t-explored')) m.setFilter('t-explored', HIDE_ALL);
  }, [p.clear]);

  // ------------------------------------------------------------ markers
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    (['from', 'to'] as const).forEach((which) => {
      const pt = which === 'from' ? p.from : p.to;
      let mk = markers.current[which];
      if (!pt) {
        mk?.remove();
        markers.current[which] = null;
        return;
      }
      if (!mk) {
        mk = new Marker({ element: markerEl(which === 'from' ? 'A' : 'B'), draggable: true, anchor: 'center' });
        mk.on('dragend', () => {
          const ll = mk!.getLngLat();
          cb.current.onDrag(which, [ll.lat, ll.lng]);
        });
        markers.current[which] = mk;
        mk.setLngLat([pt.lon, pt.lat]).addTo(m);
      } else {
        mk.setLngLat([pt.lon, pt.lat]);
      }
    });
  }, [p.from, p.to]);

  return null;
}
