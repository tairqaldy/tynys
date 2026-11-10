import type { KindMeta, RouteInfo } from '../api/types';
import { km, num, pct } from '../lib/format';
import { useWidth } from '../lib/hooks';

/** Neutral tone per traffic exposure index: darker = closer to traffic. */
function kindTone(index: number): string {
  if (index >= 1.8) return 'var(--k-4)';
  if (index >= 1.4) return 'var(--k-3)';
  if (index >= 1.2) return 'var(--k-2)';
  if (index >= 0.9) return 'var(--k-1)';
  return 'var(--k-0)';
}

export function KindBar({ byKind, kinds }: { byKind: Record<string, number>; kinds: KindMeta[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const entries = Object.entries(byKind)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => {
      const k = kinds.find((x) => x.id === id);
      return { id, v, label: k?.label ?? id, index: k?.index ?? 1 };
    })
    .sort((a, b) => b.index - a.index);
  const total = entries.reduce((s, e) => s + e.v, 0) || 1;
  let acc = 0;
  return (
    <div className="kindbar" ref={ref}>
      {w > 0 && (
        <svg width={w} height={12} role="img" aria-label={`Share of length by street kind: ${entries.map((e) => `${e.label} ${pct(e.v)}`).join(', ')}`}>
          {entries.map((e) => {
            const x = (acc / total) * w;
            const bw = (e.v / total) * w;
            acc += e.v;
            return <rect key={e.id} x={x} y={0} width={Math.max(0, bw - 1)} height={12} fill={kindTone(e.index)} />;
          })}
        </svg>
      )}
      <ul className="kindbar__list">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="kindbar__sw" style={{ background: kindTone(e.index) }} aria-hidden="true" />
            {e.label} <span className="num">{pct(e.v)}</span>
            <span className="kindbar__idx num" title="Traffic exposure index">
              ×{num(e.index, 1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RouteCard({
  kind,
  r,
  kinds,
  highlight,
}: {
  kind: 'cleanest' | 'shortest';
  r: RouteInfo;
  kinds: KindMeta[];
  highlight: boolean;
}) {
  return (
    <article className={`route-card route-card--${kind}${highlight ? ' is-highlight' : ''}`} aria-label={kind === 'cleanest' ? 'Route with the least traffic exposure' : 'Shortest route'}>
      <h4 className="route-card__title">
        <span className={`route-swatch route-swatch--${kind}`} aria-hidden="true" />
        {kind === 'cleanest' ? 'Least traffic exposure' : 'Shortest'}
      </h4>
      <dl className="facts">
        <div>
          <dt>Distance</dt>
          <dd className="num">{km(r.distance_m)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="num">{Math.round(r.minutes)} min</dd>
        </div>
        <div>
          <dt>Mean exposure index</dt>
          <dd className="num">×{num(r.mean_index, 2)}</dd>
        </div>
        <div>
          <dt>
            Exposure score<sup aria-hidden="true">*</sup>
          </dt>
          <dd className="num">{num(r.exposure_score, 1)} µg</dd>
        </div>
      </dl>
      <KindBar byKind={r.by_kind} kinds={kinds} />
    </article>
  );
}
