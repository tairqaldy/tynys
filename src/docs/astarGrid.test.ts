// The /docs A* lab must behave like tynys/astar.py: the heuristic only saves work, it never changes
// the answer. Checked on the presets at every grid size the lab can use and on random cities.
import { describe, expect, it } from 'vitest';
import {
  BUILDING,
  FOOTPATH,
  H_FACTOR,
  KINDS,
  MAJOR,
  MAX_COLS,
  MIN_COLS,
  NEVER,
  PARK,
  STREET,
  compare,
  gridSize,
  heuristic,
  hFactor,
  lineCells,
  makeWorld,
  neighbours,
  passable,
  search,
  stepCost,
  type CostMode,
  type Grid,
  type World,
} from './astarGrid';

const MODES: CostMode[] = ['shortest', 'exposure'];

/** Small deterministic PRNG (mulberry32), so a failing case can be reproduced. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWorld(seed: number, cols = 24, rows = 16, wall = 0.28): World {
  const r = rng(seed);
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) {
    const x = r();
    cells[i] = x < wall ? BUILDING : x < wall + 0.1 ? MAJOR : x < wall + 0.18 ? PARK : x < wall + 0.24 ? FOOTPATH : STREET;
  }
  const start = Math.floor(r() * cells.length);
  let goal = Math.floor(r() * cells.length);
  if (goal === start) goal = (goal + 1) % cells.length;
  cells[start] = STREET;
  cells[goal] = STREET;
  return { grid: { cols, rows, cells }, start, goal };
}

/** Cost of a path recomputed from scratch, step by step. */
function pathCost(g: Grid, path: number[], mode: CostMode): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const step = neighbours(g, a).find(([n]) => n === b);
    expect(step, `step ${a} -> ${b} is not a legal move`).toBeDefined();
    s += stepCost(g, a, b, step![1], mode);
  }
  return s;
}

describe('kinds and heuristic match the backend', () => {
  it('uses the exposure indices of tynys/classes.py', () => {
    expect(KINDS[STREET]).toMatchObject({ label: 'Residential street', index: 1.0 });
    expect(KINDS[MAJOR]).toMatchObject({ label: 'Major road', index: 2.0 });
    expect(KINDS[FOOTPATH]).toMatchObject({ label: 'Footpath', index: 0.8 });
    expect(KINDS[PARK]).toMatchObject({ label: 'Path in a park', index: 0.6 });
    expect(KINDS[BUILDING].index).toBeNull();
  });

  it('H_FACTOR is the smallest index, 0.6', () => {
    expect(H_FACTOR).toBe(0.6);
    expect(hFactor('shortest')).toBe(1);
    expect(hFactor('exposure')).toBe(0.6);
  });

  it('the heuristic is consistent on every legal step of a random city', () => {
    for (const mode of MODES) {
      const w = randomWorld(7);
      const f = hFactor(mode);
      for (let c = 0; c < w.grid.cells.length; c++) {
        if (!passable(w.grid, c)) continue;
        for (const [n, len] of neighbours(w.grid, c)) {
          const hc = heuristic(w.grid, c, w.goal, f);
          const hn = heuristic(w.grid, n, w.goal, f);
          expect(hc).toBeLessThanOrEqual(stepCost(w.grid, c, n, len, mode) + hn + 1e-12);
        }
      }
    }
  });
});

describe('moves', () => {
  it('never steps into a building or cuts the corner of one', () => {
    // . #
    // . .   the diagonal from (0,0) to (1,1) would cut the corner of the building at (1,0)
    const g: Grid = { cols: 2, rows: 2, cells: Uint8Array.from([STREET, BUILDING, STREET, STREET]) };
    const fromTopLeft = neighbours(g, 0).map(([n]) => n);
    expect(fromTopLeft).toEqual([2]);
    const fromBottomRight = neighbours(g, 3).map(([n]) => n).sort();
    expect(fromBottomRight).toEqual([2]);
  });

  it('a diagonal step has length √2 and is allowed in the open', () => {
    const g: Grid = { cols: 2, rows: 2, cells: new Uint8Array(4) };
    expect(neighbours(g, 0)).toContainEqual([3, Math.SQRT2]);
  });

  it('exposure cost of a step is length × mean index of its two cells', () => {
    const g: Grid = { cols: 2, rows: 1, cells: Uint8Array.from([MAJOR, PARK]) };
    expect(stepCost(g, 0, 1, 1, 'exposure')).toBeCloseTo(1.3, 12);
    expect(stepCost(g, 0, 1, Math.SQRT2, 'exposure')).toBeCloseTo(1.3 * Math.SQRT2, 12);
    expect(stepCost(g, 0, 1, 1, 'shortest')).toBe(1);
  });
});

describe('A* against Dijkstra on random cities', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

  it.each(MODES)('%s: same cost, A* expands no more, paths are legal', (mode) => {
    let reachable = 0;
    for (const seed of seeds) {
      const w = randomWorld(seed);
      const { astar, dijkstra } = compare(w, mode);
      expect(astar.found).toBe(dijkstra.found);
      expect(astar.expanded).toBeLessThanOrEqual(dijkstra.expanded);
      if (!astar.found) continue;
      reachable++;
      expect(Math.abs(astar.cost - dijkstra.cost)).toBeLessThan(1e-9);
      for (const s of [astar, dijkstra]) {
        expect(s.path[0]).toBe(w.start);
        expect(s.path[s.path.length - 1]).toBe(w.goal);
        for (const c of s.path) expect(w.grid.cells[c]).not.toBe(BUILDING);
        expect(Math.abs(pathCost(w.grid, s.path, mode) - s.cost)).toBeLessThan(1e-9);
      }
    }
    expect(reachable).toBeGreaterThan(20); // the random cities are not all walled in
  });

  it('records a consistent expansion history', () => {
    const w = randomWorld(3, 24, 16, 0.15);
    const s = search(w, 'exposure', H_FACTOR);
    expect(s.order.length).toBe(s.expanded);
    s.order.forEach((c, i) => {
      expect(s.closedAt[c]).toBe(i);
      expect(s.openedAt[c]).toBeLessThan(i); // a cell is on the frontier before it is expanded
      expect(Number.isFinite(s.g[c])).toBe(true);
    });
    expect(s.openedAt[w.start]).toBe(-1);
    // f = g + h never decreases in expansion order (consistent heuristic)
    for (let i = 1; i < s.order.length; i++) {
      const f = (c: number) => s.g[c] + heuristic(w.grid, c, w.goal, H_FACTOR);
      expect(f(s.order[i])).toBeGreaterThanOrEqual(f(s.order[i - 1]) - 1e-9);
    }
  });
});

describe('unreachable goal', () => {
  it('both searches report no path and expand the whole reachable area', () => {
    // B is boxed in by buildings
    const cols = 9;
    const rows = 7;
    const cells = new Uint8Array(cols * rows);
    for (let y = 2; y <= 4; y++) for (let x = 5; x <= 7; x++) cells[y * cols + x] = BUILDING;
    const goal = 3 * cols + 6;
    cells[goal] = STREET;
    const w: World = { grid: { cols, rows, cells }, start: 3 * cols + 1, goal };
    for (const mode of MODES) {
      const { astar, dijkstra } = compare(w, mode);
      for (const s of [astar, dijkstra]) {
        expect(s.found).toBe(false);
        expect(s.path).toEqual([]);
        expect(s.cost).toBe(Infinity);
        expect(s.closedAt[goal]).toBe(NEVER);
        expect(s.expanded).toBe(cols * rows - 9);
      }
    }
  });
});

describe('presets at every grid size', () => {
  const sizes = Array.from({ length: MAX_COLS - MIN_COLS + 1 }, (_, i) => MIN_COLS + i).map((cols) => ({
    cols,
    rows: Math.round((cols * 2) / 3),
  }));

  it.each(sizes)('toy city $cols × $rows: shortest takes the major road, least exposure the park', ({ cols, rows }) => {
    const w = makeWorld('city', cols, rows);
    const share = (path: number[], kind: number) => path.filter((c) => w.grid.cells[c] === kind).length / path.length;

    const short = compare(w, 'shortest');
    expect(short.astar.found).toBe(true);
    expect(share(short.astar.path, MAJOR)).toBe(1);
    expect(short.astar.expanded).toBeLessThan(short.dijkstra.expanded * 0.2);

    const clean = compare(w, 'exposure');
    expect(Math.abs(clean.astar.cost - clean.dijkstra.cost)).toBeLessThan(1e-9);
    expect(share(clean.astar.path, PARK)).toBeGreaterThan(0.25);
    expect(clean.astar.path.filter((c) => w.grid.cells[c] === MAJOR).length).toBe(2); // only A and B
    expect(clean.astar.expanded).toBeLessThan(clean.dijkstra.expanded);
  });

  it.each(sizes)('open field $cols × $rows: A* walks almost straight to B', ({ cols, rows }) => {
    const w = makeWorld('field', cols, rows);
    const { astar, dijkstra } = compare(w, 'shortest');
    expect(astar.cost).toBeCloseTo(dijkstra.cost, 9);
    expect(astar.expanded).toBeLessThan(astar.path.length * 1.5);
    expect(dijkstra.expanded).toBeGreaterThan(astar.expanded * 5);
  });

  it('A and B start on walkable cells', () => {
    for (const { cols, rows } of sizes)
      for (const preset of ['city', 'field'] as const) {
        const w = makeWorld(preset, cols, rows);
        expect(passable(w.grid, w.start)).toBe(true);
        expect(passable(w.grid, w.goal)).toBe(true);
        expect(w.start).not.toBe(w.goal);
      }
  });

  it('grid size keeps cells at least 12.5 px wide down to the smallest grid', () => {
    expect(gridSize(300)).toEqual({ cols: 24, rows: 16 });
    expect(gridSize(250)).toEqual({ cols: MIN_COLS, rows: 13 });
    expect(gridSize(2000).cols).toBe(MAX_COLS);
  });
});

describe('painting helper', () => {
  it('lineCells covers every cell between two points without gaps', () => {
    const cols = 10;
    const cells = lineCells(cols, 0, 3 * cols + 7);
    expect(cells[0]).toBe(0);
    expect(cells[cells.length - 1]).toBe(3 * cols + 7);
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs((cells[i] % cols) - (cells[i - 1] % cols));
      const dy = Math.abs(Math.floor(cells[i] / cols) - Math.floor(cells[i - 1] / cols));
      expect(Math.max(dx, dy)).toBe(1);
    }
  });
});
