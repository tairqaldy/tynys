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
  type TransformStyleFunction,
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
  reducedMotion: boolean;
  cooperative: boolean;
  onReplayDone: () => void;
  onFail: (msg: string) => void;
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
const quiet: TransformStyleFunction = (_prev, next) => ({
  ...next,
  layers: next.layers.filter((l) => !/shield/i.test(l.id)),
});

const HIDE_ALL: FilterSpecification = ['<', ['get', 'i'], -1];

export function MapView(p: Props) {
  const mapRef = useRef<MlMap | null>(null);
  const data = useRef({ mask: EMPTY, coverage: EMPTY, short: EMPTY, clean: EMPTY, explored: EMPTY });
  const exploredFilter = useRef<FilterSpecification>(HIDE_ALL);
  const markers = useRef<{ from: Marker | null; to: Marker | null }>({ from: null, to: null });
  const cb = useRef(p);
  cb.current = p;
  const anim = useRef<number | null>(null);

  // ------------------------------------------------------------ create once
  useEffect(() => {
    let map: MlMap;
    try {
      map = new MlMap({
        container: p.container,
        style: MAP_STYLES[p.theme],
        transformStyle: quiet,
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
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 16, 3.5], 'circle-color': cssVar('--accent'), 'circle-opacity': 0.45 },
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
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    mapRef.current?.setStyle(MAP_STYLES[p.theme], { transformStyle: quiet });
  }, [p.theme]);

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
    // the first fit (and a jump between cities) is instant; the cities are 1,000 km apart
    m?.fitBounds([[w, s], [e, n]], { padding: 24, duration: 0 });
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
    exploredFilter.current = HIDE_ALL;
    mapRef.current?.getLayer('t-explored') && mapRef.current.setFilter('t-explored', HIDE_ALL);
    if (!r) {
      setData('short', EMPTY);
      setData('clean', EMPTY);
      setData('explored', EMPTY);
      return;
    }
    setData('clean', line(r.cleanest.coords));
    setData('short', r.comparison.same_route ? EMPTY : line(r.shortest.coords));
    setData('explored', {
      type: 'FeatureCollection',
      features: r.cleanest.explored.map(([la, lo], i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [lo, la] } })),
    });
    const b = new LngLatBounds();
    [...r.cleanest.coords, ...r.shortest.coords].forEach(([la, lo]) => b.extend([lo, la]));
    if (!b.isEmpty()) mapRef.current?.fitBounds(b, { padding: { top: 84, bottom: 44, left: 44, right: 60 }, maxZoom: 16, duration: cb.current.reducedMotion ? 0 : 800 });
  }, [p.route]);

  // ------------------------------------------------------------ replay the search
  useEffect(() => {
    const m = mapRef.current;
    const r = cb.current.route;
    if (!p.replay || !m || !r || !m.getLayer('t-explored')) return;
    const N = r.cleanest.explored.length;
    const setN = (n: number) => {
      exploredFilter.current = ['<', ['get', 'i'], n];
      m.setFilter('t-explored', exploredFilter.current);
    };
    if (cb.current.reducedMotion) {
      setN(N);
      cb.current.onReplayDone();
      return;
    }
    const dur = 2800;
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
