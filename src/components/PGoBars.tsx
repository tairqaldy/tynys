import type { PlanResponse } from '../api/types';
import { hhmm, pct } from '../lib/format';
import { useWidth } from '../lib/hooks';
import { SrTable } from './common';

/**
 * P(you go at hour t) under the plan, as columns on a 0–100% scale, with the running total as a
 * thin step line. The median hour is where the running total first reaches 50%.
 */
export function PGoBars({ plan }: { plan: PlanResponse }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const hours = plan.hours;
  const showSkip = !plan.inputs.must;
  const cols = hours.length + (showSkip ? 1 : 0);
  const gl = 40;
  const gr = 8;
  const y0 = 34;
  const ph = 120;
  const axisY = y0 + ph + 16;
  const H = axisY + 8;
  const plotW = Math.max(10, w - gl - gr);
  const cw = plotW / Math.max(1, cols);
  const bw = Math.min(34, cw * 0.62);
  const y = (p: number) => y0 + ph - p * ph;
  const best = plan.decision.best_t;
  const labelEvery = cw >= 30 ? 1 : cw >= 17 ? 2 : 3;
  const cx = (k: number) => gl + k * cw + cw / 2;

  // running total as a step line
  let d = '';
  hours.forEach((h, k) => {
    const x0 = gl + k * cw;
    const prev = k === 0 ? 0 : hours[k - 1].p_go_cumulative;
    d += k === 0 ? `M${x0},${y(prev)}` : `L${x0},${y(prev)}`;
    d += ` L${x0},${y(h.p_go_cumulative)} L${x0 + cw},${y(h.p_go_cumulative)} `;
  });

  return (
    <figure className="chart pgo" ref={ref}>
      {w > 0 && (
        <svg width={w} height={H} aria-hidden="true">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={gl} x2={gl + plotW} y1={y(t)} y2={y(t)} className={t === 0.5 ? 'gridline gridline--half' : 'gridline'} />
              <text x={gl - 6} y={y(t) + 3.5} textAnchor="end" className="tick num">
                {t * 100}%
              </text>
            </g>
          ))}
          <path d={d} className="cum-line" />
          {hours.map((h, k) => {
            const isBest = best === h.t;
            const bh = h.p_go * ph;
            return (
              <g key={h.t}>
                <rect
                  x={cx(k) - bw / 2}
                  y={y(h.p_go)}
                  width={bw}
                  height={Math.max(h.p_go > 0 ? 1 : 0, bh)}
                  className={isBest ? 'pgo-bar is-best' : 'pgo-bar'}
                />
                {(h.p_go >= 0.005 && (cw >= 26 || isBest)) && (
                  <text x={cx(k)} y={y(h.p_go) - 5} textAnchor="middle" className={`num bar-label${isBest ? ' is-best' : ''}`}>
                    {pct(h.p_go)}
                  </text>
                )}
                {(k % labelEvery === 0 || isBest) && (
                  <text x={cx(k)} y={axisY} textAnchor="middle" className={`tick num${isBest ? ' is-best' : ''}`}>
                    {k === 0 ? 'now' : hhmm(h.time).slice(0, 2)}
                  </text>
                )}
              </g>
            );
          })}
          {best !== null && (
            <text x={cx(best)} y={10} textAnchor="middle" className="median-label">
              median
            </text>
          )}
          {showSkip && (
            <g>
              <rect x={cx(hours.length) - bw / 2} y={y(plan.p_skip)} width={bw} height={Math.max(plan.p_skip > 0 ? 1 : 0, plan.p_skip * ph)} className="pgo-bar pgo-bar--skip" />
              {plan.p_skip >= 0.005 && cw >= 22 && (
                <text x={cx(hours.length)} y={y(plan.p_skip) - 5} textAnchor="middle" className="num bar-label">
                  {pct(plan.p_skip)}
                </text>
              )}
              <text x={cx(hours.length)} y={axisY} textAnchor="middle" className="tick">
                skip
              </text>
            </g>
          )}
        </svg>
      )}
      <figcaption>
        Chance you set off at each hour if you follow the plan; the step line is the running total.
        {showSkip && ' Last column: the plan ends in skipping.'}
      </figcaption>
      <SrTable
        caption="Probability of going at each hour"
        head={['Hour', 'Chance of going then', 'Running total']}
        rows={[
          ...hours.map((h) => [h.t === 0 ? `now (${hhmm(h.time)})` : hhmm(h.time), pct(h.p_go), pct(h.p_go_cumulative)]),
          ...(showSkip ? [['skip', pct(plan.p_skip), '']] : []),
        ]}
      />
    </figure>
  );
}
