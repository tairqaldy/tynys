import '../styles/lab-astar.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Segmented } from '../components/controls';
import { intl, num, pct } from '../lib/format';
import { useReducedMotion, useWidth } from '../lib/hooks';
import { useInView } from '../lib/motion';
import {
  BUILDING,
  FOOTPATH,
  H_FACTOR,
  KINDS,
  MAJOR,
  NEVER,
  PARK,
  STREET,
  compare,
  gridSize,
  heuristic,
  lineCells,
  makeWorld,
  passable,
  type CostMode,
  type Kind,
  type PresetId,
  type Search,
  type World,
} from './astarGrid';
import { Lab, LabButton } from './Lab';

const TITLE = 'A* against Dijkstra on a toy city';
const GAP = 16; // between the two panels, matches the CSS
const SIDE_BY_SIDE = 500; // lab body width from which the panels sit side by side (cells stay ≥ 12 px)
const CELL_IN_MS = 220; // a newly expanded cell fades in
const PATH_DELAY_MS = 90; // pause between the end of a search and its route drawing itself
const START_DELAY_MS = 350;

type Side = 'astar' | 'dijkstra';
type Brush = 'building' | 'park' | 'major' | 'erase';

const BRUSHES: { id: Brush; kind: Kind; label: string }[] = [
  { id: 'building', kind: BUILDING, label: 'Building' },
  { id: 'park', kind: PARK, label: 'Park' },
  { id: 'major', kind: MAJOR, label: 'Major road' },
  { id: 'erase', kind: STREET, label: 'Erase' },
];

const MODES: { value: CostMode; label: string }[] = [
  { value: 'shortest', label: 'Shortest' },
  { value: 'exposure', label: 'Least exposure' },
];

const PRESETS: { value: PresetId; label: string }[] = [
  { value: 'city', label: 'Toy city' },
  { value: 'field', label: 'Open field' },
];

const KIND_SHORT = ['Street', 'Major road', 'Footpath', 'Park', 'Building'];

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const fmtIndex = (k: Kind) => `×${num(KINDS[k].index ?? 0, 1)}`;

/* ------------------------------------------------------------------ colours from the tokens */

type RGBA = [number, number, number, number];

function parseColor(s: string): RGBA {
  const v = s.trim();
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    return [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]), a];
  }
  return [128, 128, 128, 1];
}

const css = (c: RGBA, alpha = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3] * alpha})`;
/** c2 laid over c1 at weight t, opaque */
const mix = (c1: RGBA, c2: RGBA, t: number): RGBA => [
  c1[0] + (c2[0] - c1[0]) * t,
  c1[1] + (c2[1] - c1[1]) * t,
  c1[2] + (c2[2] - c1[2]) * t,
  1,
];

interface Palette {
  bg: string;
  grid: string;
  building: string;
  buildingEdge: string;
  major: string;
  lane: string;
  park: string;
  tree: string;
  footpath: string;
  accent: RGBA;
  ink: string;
  goal: string;
  letter: string;
  font: string;
}

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => parseColor(cs.getPropertyValue(n) || '#888');
  const raised = v('--raised');
  const ink = v('--ink');
  const k4 = v('--k-4');
  const k2 = v('--k-2');
  return {
    bg: css(raised),
    grid: css(mix(raised, ink, 0.06)),
    building: css(mix(raised, ink, 0.1)),
    buildingEdge: css(mix(raised, ink, 0.2)),
    major: css(mix(raised, k4, 0.3)),
    lane: css(raised, 0.95),
    park: css(mix(raised, ink, 0.035)),
    tree: css(mix(raised, k2, 0.42)),
    footpath: css(k2),
    accent: v('--accent'),
    ink: css(ink),
    goal: css(v('--accent')),
    letter: css(v('--paper')),
    font: cs.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
  };
}

/* ------------------------------------------------------------------ drawing */

interface PanelFrame {
  shown: number; // expansions shown so far
  pathT: number; // 0..1 of the route drawn
  /** time since each expansion appeared is measured from here; null = no fade-in */
  clock: { now: number; t0: number; rate: number } | null;
}

interface Scene {
  world: World;
  search: Search;
  P: Palette;
  inspect: number | null;
}

/** small deterministic jitter so the trees in a park do not sit on a rigid lattice */
const jitter = (c: number, k: number) => {
  const x = Math.sin(c * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
};

function drawPanel(cv: HTMLCanvasElement, sc: Scene, fr: PanelFrame, dpr: number) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const { world, search: s, P } = sc;
  const { cols, rows, cells } = world.grid;
  const W = cv.width;
  const H = cv.height;
  const cw = W / cols; // device px per cell
  const X = (i: number) => Math.round(i * cw);
  const Y = (j: number) => Math.round((j * H) / rows);
  const cx = (c: number) => ((c % cols) + 0.5) * cw;
  const cy = (c: number) => (Math.floor(c / cols) + 0.5) * (H / rows);
  const rect = (c: number) => {
    const x = c % cols;
    const y = Math.floor(c / cols);
    return [X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y)] as const;
  };
  const hair = Math.max(1, Math.round(dpr));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  // ground: roads and parks under the grid lines
  for (let c = 0; c < cells.length; c++) {
    const k = cells[c];
    if (k === MAJOR || k === PARK) {
      ctx.fillStyle = k === MAJOR ? P.major : P.park;
      ctx.fillRect(...rect(c));
    }
  }
  ctx.fillStyle = P.grid;
  for (let i = 1; i < cols; i++) ctx.fillRect(X(i), 0, hair, H);
  for (let j = 1; j < rows; j++) ctx.fillRect(0, Y(j), W, hair);

  // lane marking along the middle of a two-lane road
  ctx.fillStyle = P.lane;
  const isMajor = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === MAJOR;
  const dash = Math.max(1, Math.round(1.25 * dpr));
  for (let y = 0; y < rows - 1; y++)
    for (let x = 0; x < cols; x++)
      if (isMajor(x, y) && isMajor(x, y + 1) && !isMajor(x, y - 1) && !isMajor(x, y + 2)) {
        const x0 = X(x) + (X(x + 1) - X(x)) * 0.22;
        ctx.fillRect(Math.round(x0), Y(y + 1) - Math.floor(dash / 2), Math.round((X(x + 1) - X(x)) * 0.56), dash);
      }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols - 1; x++)
      if (isMajor(x, y) && isMajor(x + 1, y) && !isMajor(x - 1, y) && !isMajor(x + 2, y)) {
        const y0 = Y(y) + (Y(y + 1) - Y(y)) * 0.22;
        ctx.fillRect(X(x + 1) - Math.floor(dash / 2), Math.round(y0), dash, Math.round((Y(y + 1) - Y(y)) * 0.56));
      }

  // buildings: solid blocks with a hairline edge
  const isB = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === BUILDING;
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== BUILDING) continue;
    const [x0, y0, w, h] = rect(c);
    ctx.fillStyle = P.building;
    ctx.fillRect(x0, y0, w, h);
    const x = c % cols;
    const y = Math.floor(c / cols);
    ctx.fillStyle = P.buildingEdge;
    if (!isB(x, y - 1)) ctx.fillRect(x0, y0, w, hair);
    if (!isB(x, y + 1)) ctx.fillRect(x0, y0 + h - hair, w, hair);
    if (!isB(x - 1, y)) ctx.fillRect(x0, y0, hair, h);
    if (!isB(x + 1, y)) ctx.fillRect(x0 + w - hair, y0, hair, h);
  }

  // trees in parks
  ctx.fillStyle = P.tree;
  const tr = Math.max(1.2 * dpr, cw * 0.12);
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== PARK) continue;
    ctx.beginPath();
    ctx.arc(cx(c) + jitter(c, 1) * cw * 0.36, cy(c) + jitter(c, 2) * cw * 0.36, tr, 0, Math.PI * 2);
    ctx.fill();
  }

  // footpaths: a dashed line joining neighbouring footpath cells
  const isF = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x] === FOOTPATH;
  ctx.strokeStyle = P.footpath;
  ctx.lineWidth = Math.max(1, 1.25 * dpr);
  ctx.setLineDash([Math.max(2, cw * 0.18), Math.max(2, cw * 0.16)]);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== FOOTPATH) continue;
    const x = c % cols;
    const y = Math.floor(c / cols);
    const right = isF(x + 1, y);
    const down = isF(x, y + 1);
    if (right) {
      ctx.moveTo(cx(c), cy(c));
      ctx.lineTo(cx(c + 1), cy(c));
    }
    if (down) {
      ctx.moveTo(cx(c), cy(c));
      ctx.lineTo(cx(c), cy(c + cols));
    }
    // ends of a run reach the edge of the cell, so a path visibly joins the street it leads to
    if (!isF(x, y - 1) && (down || !right)) {
      ctx.moveTo(cx(c), cy(c));
      ctx.lineTo(cx(c), Y(y));
    }
    if (!isF(x, y + 1) && !right && !isF(x - 1, y)) {
      ctx.moveTo(cx(c), cy(c));
      ctx.lineTo(cx(c), Y(y + 1));
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // the search, as tiles inside the cells: expanded cells ramp from faint (early) to strong (recent),
  // the frontier is the darkest edge of the wave
  const shown = Math.min(fr.shown, s.expanded);
  const A = P.accent;
  const pad = Math.max(hair, Math.round(cw * 0.1));
  const rad = Math.min(3 * dpr, cw * 0.22);
  const tile = (c: number) => {
    const [x0, y0, w, h] = rect(c);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0 + pad, y0 + pad, w - 2 * pad, h - 2 * pad, rad);
    else ctx.rect(x0 + pad, y0 + pad, w - 2 * pad, h - 2 * pad);
    ctx.fill();
  };
  const appear = (step: number) => {
    if (!fr.clock) return 1;
    const born = fr.clock.t0 + (step * 1000) / fr.clock.rate;
    return easeOut(clamp01((fr.clock.now - born) / CELL_IN_MS));
  };
  for (let i = 0; i < shown; i++) {
    const rank = shown <= 1 ? 1 : i / (shown - 1);
    const a = (0.11 + 0.33 * rank * rank) * appear(i);
    if (a <= 0.004) continue;
    ctx.fillStyle = css(A, a);
    tile(s.order[i]);
  }
  // frontier: outlined, it is known but not expanded yet (its g can still improve); quieter once done
  const searching = !!fr.clock && shown < s.expanded;
  const lw = Math.max(1, Math.round(1.25 * dpr));
  ctx.lineWidth = lw;
  for (let c = 0; c < cells.length; c++) {
    const o = s.openedAt[c];
    if (o === NEVER || o >= shown || s.closedAt[c] < shown) continue;
    const k = appear(o + 1);
    const [x0, y0, w, h] = rect(c);
    ctx.beginPath();
    const ix = x0 + pad + lw / 2;
    const iy = y0 + pad + lw / 2;
    if (ctx.roundRect) ctx.roundRect(ix, iy, w - 2 * pad - lw, h - 2 * pad - lw, rad);
    else ctx.rect(ix, iy, w - 2 * pad - lw, h - 2 * pad - lw);
    ctx.fillStyle = css(A, 0.08 * k);
    ctx.fill();
    ctx.strokeStyle = css(A, (searching ? 0.8 : 0.5) * k);
    ctx.stroke();
  }

  // the route draws itself from A to B
  if (s.found && fr.pathT > 0 && s.path.length > 1) {
    const pts = s.path.map((c) => [cx(c), cy(c)] as const);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let left = total * fr.pathT;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const d = Math.hypot(x1 - x0, y1 - y0);
      const t = Math.min(1, left / d);
      ctx.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      left -= d;
    }
    const w = Math.max(2.5 * dpr, cw * 0.2);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.bg;
    ctx.lineWidth = w + 3 * dpr;
    ctx.stroke();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  // the cell under the pointer or the keyboard cursor
  if (sc.inspect !== null) {
    const [x0, y0, w, h] = rect(sc.inspect);
    const l = Math.max(1, Math.round(1.5 * dpr));
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = l;
    ctx.strokeRect(x0 + l / 2, y0 + l / 2, w - l, h - l);
  }

  // A and B on top of everything
  const r = Math.max(7.5 * dpr, cw * 0.62);
  ctx.font = `600 ${Math.round(r * 1.05)}px ${P.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [c, fill, label] of [
    [world.start, P.ink, 'A'],
    [world.goal, P.goal, 'B'],
  ] as const) {
    const x = cx(c);
    const y = cy(c);
    ctx.beginPath();
    ctx.arc(x, y, r + 2 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = P.bg;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = P.letter;
    ctx.fillText(label, x, y + r * 0.06);
  }
}

/* ------------------------------------------------------------------ component */

interface Progress {
  a: number;
  d: number;
  /** an expansion animation is running */
  live: boolean;
}

interface Anim {
  t0: number;
  rate: number; // expansions per second, the same for both searches
}

/** Expansions per second: Dijkstra's whole search takes about 1.6–3.6 s at normal speed. */
function rateFor(n: number, slow: boolean) {
  const seconds = Math.min(3.6, Math.max(1.6, 1.1 + n / 250));
  return (n / seconds) * (slow ? 0.28 : 1);
}

const pathMs = (s: Search) => Math.min(720, 300 + s.path.length * 14);

export function AstarLab() {
  const reduced = useReducedMotion();
  const uid = useId();
  const [bodyRef, bodyW] = useWidth<HTMLDivElement>();
  const [viewRef, seen] = useInView<HTMLDivElement>();

  // grid size follows the panel width; a little hysteresis so a few pixels do not rebuild the city
  const side = bodyW >= SIDE_BY_SIDE;
  const panelW = bodyW > 0 ? (side ? (bodyW - GAP) / 2 : bodyW) : 0;
  const colsRef = useRef(0);
  if (panelW > 0) {
    const keep = colsRef.current > 0 && panelW / colsRef.current >= 11.5 && panelW / colsRef.current <= 17;
    if (!keep) colsRef.current = gridSize(panelW).cols;
  }
  const cols = colsRef.current;
  const rows = Math.round((cols * 2) / 3);
  const cellCss = cols ? panelW / cols : 0;

  const [preset, setPreset] = useState<PresetId>('city');
  const [mode, setMode] = useState<CostMode>('shortest');
  const [slow, setSlow] = useState(false);
  const [brush, setBrush] = useState<Brush | null>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? null : 'building',
  );
  const [world, setWorld] = useState<World | null>(null);
  const [inspect, setInspect] = useState<{ side: Side; cell: number; keyboard: boolean } | null>(null);
  const [replayN, setReplayN] = useState(0);
  const [progress, setProgress] = useState<Progress>({ a: 0, d: 0, live: false });

  /** the next result animates its search (first view, preset, mode, replay); edits show the end state */
  const wantAnim = useRef(true);

  useEffect(() => {
    if (!cols) return;
    wantAnim.current = true;
    setWorld(makeWorld(preset, cols, rows));
  }, [preset, cols, rows]);

  const result = useMemo(() => (world ? compare(world, mode) : null), [world, mode]);

  /* -------------------------------------------------------------- painting loop */
  const canvases = useRef<Record<Side, HTMLCanvasElement | null>>({ astar: null, dijkstra: null });
  const palette = useRef<Palette | null>(null);
  const anim = useRef<Anim | null>(null);
  const pre = useRef(true); // before the lab is first seen: city only, no search
  const raf = useRef(0);
  const live = useRef({ world, result, inspect, slow });
  live.current = { world, result, inspect, slow };
  const lastProgress = useRef<Progress>(progress);

  const frame = useCallback((now: number) => {
    raf.current = 0;
    const { world: w, result: r, inspect: ins } = live.current;
    const P = palette.current;
    if (!w || !r || !P) return;
    const dpr = window.devicePixelRatio || 1;
    let running = false;
    const sides: Record<Side, PanelFrame> = {
      astar: { shown: r.astar.expanded, pathT: 1, clock: null },
      dijkstra: { shown: r.dijkstra.expanded, pathT: 1, clock: null },
    };
    if (pre.current) {
      sides.astar = { shown: 0, pathT: 0, clock: null };
      sides.dijkstra = { shown: 0, pathT: 0, clock: null };
    } else if (anim.current) {
      const { t0, rate } = anim.current;
      const k = Math.max(0, ((now - t0) * rate) / 1000);
      for (const sd of ['astar', 'dijkstra'] as const) {
        const s = r[sd];
        const done = t0 + (s.expanded * 1000) / rate;
        const pathT = s.found ? easeOut(clamp01((now - done - PATH_DELAY_MS) / pathMs(s))) : 0;
        sides[sd] = { shown: Math.min(s.expanded, Math.floor(k)), pathT, clock: { now, t0, rate } };
        if (now < done + CELL_IN_MS || (s.found && pathT < 1)) running = true;
      }
      if (!running) anim.current = null;
    }
    for (const sd of ['astar', 'dijkstra'] as const) {
      const cv = canvases.current[sd];
      if (!cv) continue;
      drawPanel(cv, { world: w, search: r[sd], P, inspect: ins?.cell ?? null }, sides[sd], dpr);
    }
    const p: Progress = { a: sides.astar.shown, d: sides.dijkstra.shown, live: running || pre.current };
    const lp = lastProgress.current;
    if (p.a !== lp.a || p.d !== lp.d || p.live !== lp.live) {
      lastProgress.current = p;
      setProgress(p);
    }
    if (running) raf.current = requestAnimationFrame(frame);
  }, []);

  const paint = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // colours come from the design tokens; read them again whenever the theme changes
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const read = () => {
      palette.current = readPalette(el);
      paint();
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-air'] });
    // the A and B letters use the page font: draw again once it has loaded
    document.fonts?.ready.then(read);
    return () => mo.disconnect();
  }, [bodyRef, paint]);

  // canvas backing stores follow the CSS size and the device pixel ratio
  useEffect(() => {
    if (!cellCss) return;
    const dpr = window.devicePixelRatio || 1;
    for (const sd of ['astar', 'dijkstra'] as const) {
      const cv = canvases.current[sd];
      if (!cv) continue;
      const w = Math.round(panelW * dpr);
      const h = Math.round(cellCss * rows * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
    }
    paint();
  }, [panelW, cellCss, rows, side, paint]);

  // a new result: animate it or show its end state
  useEffect(() => {
    if (!result) return;
    if (!seen) {
      pre.current = true;
      paint();
      return;
    }
    const firstView = pre.current;
    pre.current = false;
    if (wantAnim.current && !reduced) {
      const n = Math.max(result.astar.expanded, result.dijkstra.expanded);
      anim.current = { t0: performance.now() + (firstView ? START_DELAY_MS + 250 : START_DELAY_MS), rate: rateFor(n, live.current.slow) };
    } else {
      anim.current = null;
    }
    wantAnim.current = false;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    paint();
  }, [result, seen, replayN, reduced, paint]);

  // hover and keyboard cursor only need a repaint
  useEffect(() => {
    paint();
  }, [inspect, paint]);

  /* -------------------------------------------------------------- controls */
  const replay = () => {
    wantAnim.current = true;
    setReplayN((n) => n + 1);
  };
  const chooseMode = (m: CostMode) => {
    wantAnim.current = true;
    setMode(m);
  };
  const choosePreset = (p: PresetId) => {
    wantAnim.current = true;
    if (p === preset && cols) setWorld(makeWorld(p, cols, rows));
    else setPreset(p);
  };
  const toggleSlow = () => {
    const next = !slow;
    setSlow(next);
    const a = anim.current;
    if (a && result) {
      // keep the current position of the animation, change only its speed from here on
      const now = performance.now();
      const k = Math.max(0, ((now - a.t0) * a.rate) / 1000);
      const rate = rateFor(Math.max(result.astar.expanded, result.dijkstra.expanded), next);
      anim.current = { t0: now - (k * 1000) / rate, rate };
    }
  };

  /** Any edit stops a running animation and shows the end state of the new search. */
  const edit = (next: World) => {
    wantAnim.current = false;
    setWorld(next);
  };

  /* -------------------------------------------------------------- pointer: drag A/B, paint */
  const drag = useRef<{ what: 'start' | 'goal' | 'paint'; last: number } | null>(null);

  const cellAt = (e: { clientX: number; clientY: number }, cv: HTMLCanvasElement) => {
    const b = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - b.left) / b.width) * cols);
    const y = Math.floor(((e.clientY - b.top) / b.height) * rows);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
    return y * cols + x;
  };

  /** A or B when the pointer is close enough to grab it (a finger gets a bigger target). */
  const grabAt = (e: { clientX: number; clientY: number }, cv: HTMLCanvasElement, coarse: boolean) => {
    const w = live.current.world;
    if (!w) return null;
    const b = cv.getBoundingClientRect();
    const cell = b.width / cols;
    const px = e.clientX - b.left;
    const py = e.clientY - b.top;
    const reach = (coarse ? 1.5 : 0.85) * cell;
    let best: 'start' | 'goal' | null = null;
    let bestD = Infinity;
    for (const what of ['start', 'goal'] as const) {
      const c = w[what];
      const d = Math.hypot(px - ((c % cols) + 0.5) * cell, py - (Math.floor(c / cols) + 0.5) * cell);
      if (d <= reach && d < bestD) {
        best = what;
        bestD = d;
      }
    }
    return best;
  };

  const brushRef = useRef(brush);
  brushRef.current = brush;

  const applyPaint = (from: number, to: number) => {
    const w = live.current.world;
    const b = brushRef.current;
    if (!w || !b) return;
    const kind = BRUSHES.find((x) => x.id === b)!.kind;
    let cells: Uint8Array | null = null;
    for (const c of lineCells(cols, from, to)) {
      if (c === w.start || c === w.goal || w.grid.cells[c] === kind) continue;
      cells ??= w.grid.cells.slice();
      cells[c] = kind;
    }
    if (cells) {
      const next = { ...w, grid: { ...w.grid, cells } };
      live.current.world = next;
      edit(next);
    }
  };

  const moveMarker = (what: 'start' | 'goal', c: number) => {
    const w = live.current.world;
    if (!w || c < 0 || w[what] === c || !passable(w.grid, c)) return;
    if (c === (what === 'start' ? w.goal : w.start)) return;
    const next = { ...w, [what]: c };
    live.current.world = next;
    edit(next);
  };

  const onPointerDown = (sd: Side) => (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const cv = e.currentTarget;
    const c = cellAt(e, cv);
    if (c < 0) return;
    const grab = grabAt(e, cv, e.pointerType !== 'mouse');
    if (grab) {
      drag.current = { what: grab, last: c };
      cv.dataset.drag = 'true';
    } else if (brushRef.current) {
      drag.current = { what: 'paint', last: c };
      applyPaint(c, c);
    } else return;
    cv.setPointerCapture(e.pointerId);
    setInspect(e.pointerType === 'mouse' ? { side: sd, cell: c, keyboard: false } : null);
  };

  const onPointerMove = (sd: Side) => (e: PointerEvent<HTMLCanvasElement>) => {
    const cv = e.currentTarget;
    const c = cellAt(e, cv);
    const d = drag.current;
    if (d && c >= 0 && c !== d.last) {
      if (d.what === 'paint') applyPaint(d.last, c);
      else moveMarker(d.what, c);
      d.last = c;
    }
    if (e.pointerType === 'mouse') {
      setInspect((old) => (c < 0 ? null : old && old.cell === c && old.side === sd ? old : { side: sd, cell: c, keyboard: false }));
      cv.dataset.grab = !d && grabAt(e, cv, false) ? 'true' : 'false';
    }
  };

  const endDrag = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    delete e.currentTarget.dataset.drag;
  };

  // on touch, a finger on A, B or with a brush must not scroll the page
  useEffect(() => {
    const els = Object.values(canvases.current).filter(Boolean) as HTMLCanvasElement[];
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      const cv = e.currentTarget as HTMLCanvasElement;
      if (!t) return;
      if (brushRef.current || grabAt(t, cv, true)) e.preventDefault();
    };
    for (const el of els) el.addEventListener('touchstart', onTouch, { passive: false });
    return () => {
      for (const el of els) el.removeEventListener('touchstart', onTouch);
    };
    // grabAt reads the grid size: bind again when it changes
  }, [cols, rows, side]);

  /* -------------------------------------------------------------- keyboard: inspect cells, move A and B */
  const onKeyDown = (sd: Side) => (e: KeyboardEvent<HTMLCanvasElement>) => {
    const w = live.current.world;
    if (!w) return;
    const cur = inspect && inspect.side === sd ? inspect.cell : w.start;
    let x = cur % cols;
    let y = Math.floor(cur / cols);
    const step = e.shiftKey ? 4 : 1;
    switch (e.key) {
      case 'ArrowLeft':
        x = Math.max(0, x - step);
        break;
      case 'ArrowRight':
        x = Math.min(cols - 1, x + step);
        break;
      case 'ArrowUp':
        y = Math.max(0, y - step);
        break;
      case 'ArrowDown':
        y = Math.min(rows - 1, y + step);
        break;
      case 'a':
      case 'A':
        moveMarker('start', cur);
        e.preventDefault();
        return;
      case 'b':
      case 'B':
        moveMarker('goal', cur);
        e.preventDefault();
        return;
      case 'Escape':
        setInspect(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    setInspect({ side: sd, cell: y * cols + x, keyboard: true });
  };

  /* -------------------------------------------------------------- text */
  const a = result?.astar;
  const d = result?.dijkstra;
  const found = !!a?.found;
  const doneA = !!a && progress.a >= a.expanded && !pre.current;
  const doneD = !!d && progress.d >= d.expanded && !pre.current;
  const maxExpanded = Math.max(1, a?.expanded ?? 1, d?.expanded ?? 1);

  let readout: ReactNode = null;
  if (inspect && result && world) {
    const s = result[inspect.side];
    const c = inspect.cell;
    const k = world.grid.cells[c] as Kind;
    const who = inspect.side === 'astar' ? 'A*' : 'Dijkstra';
    const what = (
      <>
        {who} · {c === world.start ? 'A · ' : c === world.goal ? 'B · ' : ''}
        {KIND_SHORT[k]}
        {k !== BUILDING && <span className="al-x"> {fmtIndex(k)}</span>}
      </>
    );
    if (k === BUILDING) readout = <>{what} · not walkable</>;
    else if (s.closedAt[c] === NEVER || pre.current) readout = <>{what} · not expanded</>;
    else {
      const g = s.g[c];
      const h = heuristic(world.grid, c, world.goal, s.factor);
      readout = (
        <>
          {what} ·{' '}
          <span className="al-gh">
            <i>g</i> {num(g, 1)} + <i>h</i> {num(h, 1)} = <i>f</i> <b>{num(g + h, 1)}</b>
          </span>
        </>
      );
    }
  } else if (!a || !d) readout = null;
  else if (!found)
    readout = (
      <>
        B can't be reached · both searches expanded all <b>{intl(d.expanded)}</b> reachable nodes
      </>
    );
  else if (!doneA && !doneD)
    readout = (
      <>
        A* expands the smallest <span className="f">g + h</span>, Dijkstra the smallest <span className="f">g</span>
      </>
    );
  else if (doneA && !doneD)
    readout = (
      <>
        A* reached B after <b>{intl(a.expanded)}</b> nodes · Dijkstra is still searching
      </>
    );
  else if (a.expanded < d.expanded)
    readout = (
      <>
        A* expanded <b>{pct(1 - a.expanded / d.expanded)} fewer nodes</b> · same cost, {num(a.cost, 1)}
      </>
    );
  else readout = <>A* expanded as many nodes as Dijkstra here · same cost, {num(a.cost, 1)}</>;

  // screen readers hear the end state once it settles, not every frame or every painted cell
  const [srText, setSrText] = useState('');
  const finalText =
    a && d
      ? found
        ? `${mode === 'shortest' ? 'Shortest' : 'Least exposure'} route. A* expanded ${a.expanded} nodes, Dijkstra ${d.expanded}; both found cost ${num(a.cost, 1)} over ${num(a.length, 1)} cells.`
        : `B can't be reached; both searches expanded ${d.expanded} nodes.`
      : '';
  useEffect(() => {
    if (progress.live) return;
    const id = window.setTimeout(() => setSrText(finalText), 600);
    return () => window.clearTimeout(id);
  }, [finalText, progress.live]);

  const hint = `${uid}-hint`;

  return (
    <Lab
      title={TITLE}
      className="al"
      tag={cols ? `${cols} × ${rows} grid` : undefined}
      actions={
        <>
          <LabButton onClick={toggleSlow} active={slow} title="Play the search at about a quarter of the speed">
            Slow
          </LabButton>
          <LabButton onClick={replay} title="Run both searches again from the start">
            <svg className="al-ico" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
              <path d="M12.5 1.8v2.6H9.9" />
            </svg>
            Replay
          </LabButton>
        </>
      }
      readout={
        <span className={`al-readout${inspect ? ' is-inspect' : ''}`} aria-hidden="true">
          {readout ?? '\u00a0'}
        </span>
      }
    >
      <div className="al-controls">
        <Segmented label="Cost of a step" name={`${uid}-mode`} options={MODES} value={mode} onChange={chooseMode} />
        <Segmented label="Map" name={`${uid}-preset`} options={PRESETS} value={preset} onChange={choosePreset} />
      </div>
      <p className="al-def">
        {mode === 'shortest' ? (
          <>
            step cost <span className="f">= length</span>, 1 or √2
          </>
        ) : (
          <>
            step cost <span className="f">= length × mean index of its two cells</span>
          </>
        )}
      </p>

      <div ref={bodyRef} className="al-measure">
        <div ref={viewRef} className={`al-panels${side ? ' al-panels--side' : ''}`}>
          {(['astar', 'dijkstra'] as const).map((sd) => {
            const s = result?.[sd];
            const shown = sd === 'astar' ? progress.a : progress.d;
            const done = sd === 'astar' ? doneA : doneD;
            return (
              <Panel
                key={sd}
                side={sd}
                mode={mode}
                search={s ?? null}
                shown={shown}
                done={done}
                live={progress.live}
                maxExpanded={maxExpanded}
                height={cellCss * rows}
                brush={!!brush}
                hintId={hint}
                canvasRef={(el) => {
                  canvases.current[sd] = el;
                }}
                onPointerDown={onPointerDown(sd)}
                onPointerMove={onPointerMove(sd)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={() => setInspect((old) => (old && !old.keyboard ? null : old))}
                onKeyDown={onKeyDown(sd)}
                onFocus={(e) => {
                  // a keyboard user lands on A, with its g, h and f in the readout
                  if (world && e.currentTarget.matches(':focus-visible')) setInspect({ side: sd, cell: world.start, keyboard: true });
                }}
                onBlur={() => setInspect((old) => (old?.keyboard ? null : old))}
              />
            );
          })}
        </div>
      </div>

      <div className="al-tools">
        <div className="al-brushes" role="group" aria-label="Paint on the map">
          <span className="al-tools__k" aria-hidden="true">
            Paint
          </span>
          {BRUSHES.map((b) => (
            <LabButton
              key={b.id}
              active={brush === b.id}
              onClick={() => setBrush((old) => (old === b.id ? null : b.id))}
              title={b.id === 'erase' ? 'Turn cells back into residential street (×1.0)' : `Paint ${KINDS[b.kind].label.toLowerCase()}`}
            >
              {b.id === 'erase' ? (
                <svg className="al-ico" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6.2 13.5h7.3M2.9 10.1l6.6-6.6a1.4 1.4 0 0 1 2 0l1.9 1.9a1.4 1.4 0 0 1 0 2l-6.1 6.1H5.7l-2.8-2.8a.4.4 0 0 1 0-.6Z" />
                  <path d="m6.4 6.6 3.9 3.9" />
                </svg>
              ) : (
                <span className={`al-sw al-sw--${b.id}`} aria-hidden="true" />
              )}
              {b.label}
              {KINDS[b.kind].index !== null && b.id !== 'erase' && <span className="al-x">{fmtIndex(b.kind)}</span>}
            </LabButton>
          ))}
        </div>
        <ul className="al-legend" aria-label="Legend">
          <li>
            <span className="al-sw al-sw--street" aria-hidden="true" />
            Street <span className="al-x">×1.0</span>
          </li>
          <li>
            <span className="al-sw al-sw--footpath" aria-hidden="true" />
            Footpath <span className="al-x">×0.8</span>
          </li>
          <li>
            <span className="al-sw al-sw--closed" aria-hidden="true" />
            expanded
          </li>
          <li>
            <span className="al-sw al-sw--frontier" aria-hidden="true" />
            frontier
          </li>
        </ul>
      </div>

      <p id={hint} className="sr-only">
        Drag A or B to move them, or paint with a brush. With the keyboard, arrow keys move a cell cursor and read out g, h
        and f; press A or B to move the start or the goal to the cursor.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {srText}
      </p>
    </Lab>
  );
}

/* ------------------------------------------------------------------ one panel: heading, canvas, counters */

/**
 * The expanded count: follows the animation frame by frame while a search plays, and glides
 * (ease-out, 450 ms) to a new value after an edit. Jumps when motion is reduced.
 */
function useCounter(value: number, glide: boolean): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    if (!glide || reduced) {
      cur.current = value;
      setV(value);
      return;
    }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = clamp01((now - start) / 450);
      cur.current = from + (value - from) * easeOut(k);
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, glide, reduced]);
  return v;
}

function Panel(p: {
  side: Side;
  mode: CostMode;
  search: Search | null;
  shown: number;
  done: boolean;
  live: boolean;
  maxExpanded: number;
  height: number;
  brush: boolean;
  hintId: string;
  canvasRef: (el: HTMLCanvasElement | null) => void;
  onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLCanvasElement>) => void;
  onFocus: (e: FocusEvent<HTMLCanvasElement>) => void;
  onBlur: () => void;
}) {
  const s = p.search;
  const isA = p.side === 'astar';
  const expanded = useCounter(p.shown, !p.live);
  const name = isA ? 'A*' : 'Dijkstra';
  const h = isA ? (p.mode === 'shortest' ? 'h = straight-line distance' : `h = ${num(H_FACTOR, 1)} × straight-line distance`) : 'h = 0';
  const showResult = !!s && p.done && s.found;
  const label = s
    ? `${name} search on the toy city. ${s.expanded} nodes expanded${s.found ? `, route cost ${num(s.cost, 1)}` : ', no route'}.`
    : `${name} search`;
  return (
    <section className={`al-panel al-panel--${p.side}`} aria-label={name}>
      <header className="al-panel__head">
        <span className="al-panel__name">{name}</span>
        <span className="al-panel__h f">{h}</span>
      </header>
      <canvas
        ref={p.canvasRef}
        className={`al-canvas${p.brush ? ' has-brush' : ''}`}
        style={{ height: p.height || undefined }}
        role="img"
        tabIndex={0}
        aria-label={label}
        aria-describedby={p.hintId}
        onPointerDown={p.onPointerDown}
        onPointerMove={p.onPointerMove}
        onPointerUp={p.onPointerUp}
        onPointerCancel={p.onPointerCancel}
        onPointerLeave={p.onPointerLeave}
        onKeyDown={p.onKeyDown}
        onFocus={p.onFocus}
        onBlur={p.onBlur}
      />
      <dl className="al-stats">
        <div className="al-stat al-stat--main">
          <dt>expanded</dt>
          <dd>{intl(Math.round(expanded))}</dd>
        </div>
        <div className="al-stat">
          <dt>cost</dt>
          <dd className={showResult ? 'is-on' : undefined}>{showResult ? num(s!.cost, 1) : '–'}</dd>
        </div>
        <div className="al-stat">
          <dt>length</dt>
          <dd className={showResult ? 'is-on' : undefined}>{showResult ? num(s!.length, 1) : '–'}</dd>
        </div>
      </dl>
      <div className="al-meter" aria-hidden="true">
        <span className={p.live ? 'is-live' : undefined} style={{ transform: `scaleX(${Math.min(1, p.shown / p.maxExpanded)})` }} />
      </div>
    </section>
  );
}
