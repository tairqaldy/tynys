// A toy version of tynys/astar.py for the /docs lab: the same A* (closed cells are never reopened,
// the heuristic is consistent) on a small grid city whose cells carry the real exposure indices of
// tynys/classes.py. Pure logic, no React, so it can be tested on its own.

/* ------------------------------------------------------------------ cells */

export const STREET = 0;
export const MAJOR = 1;
export const FOOTPATH = 2;
export const PARK = 3;
export const BUILDING = 4;
export type Kind = typeof STREET | typeof MAJOR | typeof FOOTPATH | typeof PARK | typeof BUILDING;

export interface KindMeta {
  label: string;
  /** traffic exposure index (tynys/classes.py KINDS); null = impassable */
  index: number | null;
}

/** Indexed by Kind. Labels and indices are the backend's ("street", "major", "path", "park"). */
export const KINDS: readonly KindMeta[] = [
  { label: 'Residential street', index: 1.0 },
  { label: 'Major road', index: 2.0 },
  { label: 'Footpath', index: 0.8 },
  { label: 'Path in a park', index: 0.6 },
  { label: 'Building', index: null },
];

const INDEX = KINDS.map((k) => k.index ?? Infinity);

/** The smallest index, as H_FACTOR in tynys/classes.py: no step costs less than 0.6 × its length. */
export const H_FACTOR = Math.min(...INDEX);

export type CostMode = 'shortest' | 'exposure';

export interface Grid {
  cols: number;
  rows: number;
  /** one Kind per cell, row by row: cell id = y * cols + x */
  cells: Uint8Array;
}

export interface World {
  grid: Grid;
  start: number;
  goal: number;
}

export const passable = (g: Grid, c: number) => g.cells[c] !== BUILDING;

/**
 * Cost of one step between neighbouring cells a and b of the given length (1 or √2).
 * shortest: the length; exposure: length × the mean index of the two cells.
 */
export function stepCost(g: Grid, a: number, b: number, len: number, mode: CostMode): number {
  if (mode === 'shortest') return len;
  return (len * (INDEX[g.cells[a]] + INDEX[g.cells[b]])) / 2;
}

/** The heuristic's factor: 1 for the shortest route, H_FACTOR for the exposure route. */
export const hFactor = (mode: CostMode) => (mode === 'shortest' ? 1 : H_FACTOR);

/** Straight-line distance in cells × factor. Never more than the cheapest possible way to the goal. */
export function heuristic(g: Grid, c: number, goal: number, factor: number): number {
  const dx = (c % g.cols) - (goal % g.cols);
  const dy = Math.floor(c / g.cols) - Math.floor(goal / g.cols);
  return Math.hypot(dx, dy) * factor;
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Walkable neighbours of a cell: 8-connected, diagonals cost √2. A diagonal step is allowed only
 * when both cells it passes between are walkable, so a route never cuts the corner of a building.
 */
export function neighbours(g: Grid, c: number): [number, number][] {
  const { cols, rows } = g;
  const x = c % cols;
  const y = Math.floor(c / cols);
  const out: [number, number][] = [];
  for (const [dx, dy, len] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const n = ny * cols + nx;
    if (!passable(g, n)) continue;
    if (dx !== 0 && dy !== 0 && (!passable(g, y * cols + nx) || !passable(g, ny * cols + x))) continue;
    out.push([n, len]);
  }
  return out;
}

/* ------------------------------------------------------------------ search */

/** Marks a cell that was never opened or never expanded. */
export const NEVER = 0x7fffffff;

export interface Search {
  found: boolean;
  /** cell ids from start to goal; empty when the goal cannot be reached */
  path: number[];
  /** g(goal); Infinity when unreachable */
  cost: number;
  /** path length in cells (a diagonal step counts √2) */
  length: number;
  expanded: number;
  /** cells in the order they were expanded */
  order: number[];
  /** for every cell: its position in `order`, or NEVER */
  closedAt: Int32Array;
  /** for every cell: the expansion that first put it on the frontier (-1 for the start), or NEVER */
  openedAt: Int32Array;
  /** g of every expanded cell (its optimal cost from the start); Infinity for the rest */
  g: Float64Array;
  /** factor of the heuristic: 0 for Dijkstra */
  factor: number;
}

interface Entry {
  f: number;
  h: number;
  seq: number;
  node: number;
}

const EPS = 1e-9;

/** Smaller f first; on a tie the smaller h (the deeper node), then first in, first out. */
function before(a: Entry, b: Entry): boolean {
  if (a.f < b.f - EPS) return true;
  if (a.f > b.f + EPS) return false;
  if (a.h < b.h - EPS) return true;
  if (a.h > b.h + EPS) return false;
  return a.seq < b.seq;
}

class Heap {
  private a: Entry[] = [];
  get size() {
    return this.a.length;
  }
  push(e: Entry) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Entry {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l], a[m])) m = l;
        if (r < a.length && before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* from world.start to world.goal: always expand the open cell with the smallest f = g + h.
 * With `factor` = 0 the heuristic is 0 and this is Dijkstra (uniform-cost search).
 * Like the backend, a cell is closed when it is expanded and never reopened; that is correct because
 * h is consistent: h(n) ≤ factor·d(n, m) + h(m) ≤ cost(n, m) + h(m).
 */
export function search(world: World, mode: CostMode, factor: number): Search {
  const { grid, start, goal } = world;
  const n = grid.cols * grid.rows;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closedAt = new Int32Array(n).fill(NEVER);
  const openedAt = new Int32Array(n).fill(NEVER);
  const order: number[] = [];
  const heap = new Heap();
  let seq = 0;

  g[start] = 0;
  openedAt[start] = -1;
  const h0 = heuristic(grid, start, goal, factor);
  heap.push({ f: h0, h: h0, seq: seq++, node: start });

  while (heap.size > 0) {
    const { node } = heap.pop();
    if (closedAt[node] !== NEVER) continue; // an older, worse entry for a cell already expanded
    closedAt[node] = order.length;
    order.push(node);
    if (node === goal) break;
    for (const [m, len] of neighbours(grid, node)) {
      if (closedAt[m] !== NEVER) continue;
      const ng = g[node] + stepCost(grid, node, m, len, mode);
      if (ng < g[m] - EPS) {
        g[m] = ng;
        parent[m] = node;
        if (openedAt[m] === NEVER) openedAt[m] = order.length - 1;
        const h = heuristic(grid, m, goal, factor);
        heap.push({ f: ng + h, h, seq: seq++, node: m });
      }
    }
  }

  // g of cells still on the frontier is only a tentative value: keep it for expanded cells only
  for (let c = 0; c < n; c++) if (closedAt[c] === NEVER) g[c] = Infinity;

  const found = closedAt[goal] !== NEVER;
  const path: number[] = [];
  let length = 0;
  if (found) {
    for (let c = goal; c !== -1; c = parent[c]) path.push(c);
    path.reverse();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      length += a % grid.cols !== b % grid.cols && Math.floor(a / grid.cols) !== Math.floor(b / grid.cols) ? Math.SQRT2 : 1;
    }
  }
  return {
    found,
    path,
    cost: found ? g[goal] : Infinity,
    length,
    expanded: order.length,
    order,
    closedAt,
    openedAt,
    g,
    factor,
  };
}

/** Both searches the lab compares, on the same world and cost function. */
export function compare(world: World, mode: CostMode): { astar: Search; dijkstra: Search } {
  return { astar: search(world, mode, hFactor(mode)), dijkstra: search(world, mode, 0) };
}

/* ------------------------------------------------------------------ presets */

export type PresetId = 'city' | 'field';

export const MIN_COLS = 20;
export const MAX_COLS = 36;

/** Grid size for a panel of the given CSS width: cells of at least ~12.5 px, rows = 2/3 of columns. */
export function gridSize(panelWidth: number): { cols: number; rows: number } {
  const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(panelWidth / 12.5)));
  return { cols, rows: Math.round((cols * 2) / 3) };
}

function blank(cols: number, rows: number, kind: Kind = STREET): Grid {
  return { cols, rows, cells: new Uint8Array(cols * rows).fill(kind) };
}

function fill(g: Grid, x0: number, y0: number, x1: number, y1: number, kind: Kind) {
  for (let y = Math.max(0, y0); y <= Math.min(g.rows - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(g.cols - 1, x1); x++) g.cells[y * g.cols + x] = kind;
}

/**
 * "Toy city": building blocks between streets, a two-lane major road across the city, a park
 * north of it reached by footpaths. A and B sit on the major road, so the shortest route runs
 * straight along it, while the least-exposure route climbs to the park and comes back down.
 */
function toyCity(cols: number, rows: number): World {
  const g = blank(cols, rows, BUILDING);
  const road = Math.round(rows * 0.6); // the road takes rows road and road + 1
  const parkTop = Math.max(2, Math.round(rows * 0.17));
  const parkBottom = road - 4;

  // street lattice: the outer ring, avenues every ~6 columns, cross streets above and below the park
  const n = Math.max(3, Math.round(cols / 6));
  const xs = Array.from({ length: n + 1 }, (_, i) => Math.round((i * (cols - 1)) / n));
  for (const x of xs) fill(g, x, 0, x, rows - 1, STREET);
  for (const y of [0, parkTop - 1, parkBottom + 1, rows - 1]) fill(g, 0, y, cols - 1, y, STREET);
  const lower = Math.round((road + 2 + rows - 1) / 2);
  if (rows - 1 - (road + 2) >= 4) fill(g, 0, lower, cols - 1, lower, STREET);

  // the park spans the inner avenues
  const parkL = xs[1];
  const parkR = xs[n - 1];
  fill(g, parkL, parkTop, parkR, parkBottom, PARK);

  // footpaths: passages from the road up to the park (A and B sit at their feet), alleys through the blocks south of it
  const pass1 = Math.round((xs[0] + xs[1]) / 2);
  const pass2 = Math.round((xs[n - 1] + xs[n]) / 2);
  fill(g, pass1, parkBottom + 2, pass1, road - 1, FOOTPATH);
  fill(g, pass2, parkBottom + 2, pass2, road - 1, FOOTPATH);
  for (let i = 1; i < n - 1; i++) {
    const x = Math.round((xs[i] + xs[i + 1]) / 2);
    fill(g, x, road + 2, x, rows - 2, FOOTPATH);
  }

  // the major road last, across everything
  fill(g, 0, road, cols - 1, road + 1, MAJOR);

  return { grid: g, start: road * cols + pass1, goal: road * cols + pass2 };
}

/**
 * "Open field": streets almost everywhere, a few small obstacles and a small park off the direct
 * line. A* walks almost straight to B; Dijkstra floods the field in every direction.
 */
function openField(cols: number, rows: number): World {
  const g = blank(cols, rows, STREET);
  const at = (fx: number, fy: number, w: number, h: number, k: Kind) => {
    const x = Math.round(cols * fx);
    const y = Math.round(rows * fy);
    fill(g, x, y, x + w - 1, y + h - 1, k);
  };
  at(0.3, 0.16, 2, 2, BUILDING);
  at(0.62, 0.7, 3, 2, BUILDING);
  at(0.42, 0.62, 4, 3, PARK);
  const mid = Math.floor(rows / 2);
  return { grid: g, start: mid * cols + 2, goal: mid * cols + cols - 3 };
}

export function makeWorld(preset: PresetId, cols: number, rows: number): World {
  return preset === 'city' ? toyCity(cols, rows) : openField(cols, rows);
}

/** Cells on the straight line between two cells (Bresenham), both ends included. */
export function lineCells(cols: number, a: number, b: number): number[] {
  let x0 = a % cols;
  let y0 = Math.floor(a / cols);
  const x1 = b % cols;
  const y1 = Math.floor(b / cols);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: number[] = [];
  for (;;) {
    out.push(y0 * cols + x0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}
