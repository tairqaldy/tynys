import type { KindMeta, RouteResponse } from '../api/types';
import { intl, num, pct } from '../lib/format';

export function MathAstar({ kinds, route }: { kinds: KindMeta[]; route: RouteResponse | null }) {
  const sorted = [...kinds].sort((a, b) => b.index - a.index);
  const hFactor = kinds.length ? Math.min(...kinds.map((k) => k.index)) : 0.6;
  const rows = route
    ? ([
        ['Shortest', 'length', 'haversine(n, goal)', route.shortest],
        ['Least exposure', 'length × index', `haversine(n, goal) × ${num(hFactor, 1)}`, route.cleanest],
      ] as const)
    : null;
  return (
    <div className="math">
      <p>
        The streets are a graph: every OpenStreetMap node is a vertex, every walkable segment an edge with its length.
        A* explores from the start, always expanding the node with the smallest{' '}
        <span className="f">f(n) = g(n) + h(n)</span> — the cost so far plus an estimate of the cost still to go. It runs
        twice with different edge costs.
      </p>

      <h4>1 · Two cost functions</h4>
      <ul className="plain">
        <li>
          <strong>Shortest:</strong> <span className="f">cost(e) = length</span>,{' '}
          <span className="f">h(n) = haversine(n, goal)</span>.
        </li>
        <li>
          <strong>Least traffic exposure:</strong> <span className="f">cost(e) = length × index(e)</span>,{' '}
          <span className="f">h(n) = haversine(n, goal) × {num(hFactor, 1)}</span>.
        </li>
      </ul>
      <div className="table-wrap">
        <table className="mtable mtable--kinds">
          <caption>Traffic exposure index per street kind</caption>
          <thead>
            <tr>
              <th scope="col">Street kind</th>
              <th scope="col" className="r">
                index
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((k) => (
              <tr key={k.id} className={k.index === hFactor ? 'is-hi' : undefined}>
                <th scope="row">{k.label}</th>
                <td className="r num">×{num(k.index, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fineprint">
        Precedence, never multiplied: roadside (a path or street within 25 m of a major or secondary road) beats park, park
        beats the base kind.
      </p>

      <h4>2 · Why the heuristic never overestimates</h4>
      <p>
        A straight line is the shortest possible way between two points, so no walk from <span className="f">n</span> to
        the goal is shorter than <span className="f">haversine(n, goal)</span>. The cheapest index is{' '}
        <span className="num">{num(hFactor, 1)}</span> (a park path), so no edge costs less than{' '}
        <span className="num">{num(hFactor, 1)}</span> × its straight length. Together:
      </p>
      <p className="display-f">
        <span className="f">
          h(n) = {num(hFactor, 1)} · haversine(n, goal) ≤ {num(hFactor, 1)} · (length of any path to the goal) ≤ cost of that
          path
        </span>
      </p>
      <p>
        So <span className="f">h</span> is <strong>admissible</strong>, and A* returns an optimal path. It is also{' '}
        <strong>consistent</strong> — for an edge from <span className="f">n</span> to <span className="f">m</span>, the
        triangle inequality gives{' '}
        <span className="f">h(n) ≤ {num(hFactor, 1)}·d(n, m) + h(m) ≤ cost(n, m) + h(m)</span> — so a node never needs to be
        expanded twice. Edge lengths use the same Earth radius as the heuristic and are rounded up, so rounding cannot break
        this.
      </p>

      <h4>3 · What the heuristic saves</h4>
      <p>
        Each request also runs the same search with <span className="f">h = 0</span> (Dijkstra's uniform-cost search), and
        checks that both give the same cost.
      </p>
      {rows ? (
        <div className="table-wrap">
          <table className="mtable">
            <caption className="sr-only">Node expansions, A* against Dijkstra, for this route</caption>
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col" className="r">
                  A*
                </th>
                <th scope="col" className="r">
                  Dijkstra
                </th>
                <th scope="col" className="r">
                  saved
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, , , r]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td className="r num">{intl(r.expanded)}</td>
                  <td className="r num">{intl(r.expanded_dijkstra)}</td>
                  <td className="r num strong">{r.expanded_dijkstra > 0 ? pct(1 - r.expanded / r.expanded_dijkstra) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-note">Pick two points under “Which way” to see the counts for a real route.</p>
      )}
      {rows && (
        <p className="fineprint">
          The exposure heuristic is weaker (it is multiplied by {num(hFactor, 1)}), so it usually saves less than the
          distance heuristic does. Weighted cost: shortest <span className="num">{intl(Math.round(route!.shortest.weighted_cost))}</span>,
          least-exposure <span className="num">{intl(Math.round(route!.cleanest.weighted_cost))}</span> (metres × index).
        </p>
      )}

      <h4>Assumptions</h4>
      <ul className="assumptions">
        <li>
          The traffic exposure index is a proxy for pollutants that are highest right next to busy roads (NO₂, soot, ultrafine
          particles). The city-wide PM2.5 model cannot see differences between streets.
        </li>
        <li>The 25 m roadside rule and the park rule are applied once, when the graph is built.</li>
        <li>Breathing 1.2 m³/h walking and 3.0 m³/h running (US EPA Exposure Factors Handbook, 2011); 80 and 160 m/min.</li>
        <li>Only the central area inside the dashed outline is covered; the graph keeps its largest connected part.</li>
      </ul>
    </div>
  );
}
