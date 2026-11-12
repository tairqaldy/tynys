import type { FilteredHour, HourReading } from '../api/types';
import { CLASS_LABEL, CLASS_LETTER, classFill, classOn, classPattern } from '../lib/classes';
import { dayMonth, hhmm, hourOf, num } from '../lib/format';
import { useWidth } from '../lib/hooks';
import { SrTable } from './common';

/**
 * The last 24 model hours: PM2.5 as a thin line over faint class bands, and under it two rows of
 * cells — the reading's band (what the model value says) and the Viterbi class (the most likely
 * sequence of hidden classes).
 */
export function Strip24({ readings, filtered }: { readings: HourReading[]; filtered: FilteredHour[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const byTime = new Map(readings.map((r) => [r.time, r]));
  const hours = filtered.map((f) => ({ ...f, pm25: byTime.get(f.time)?.pm25 ?? null }));
  const n = hours.length;
  const narrow = w < 480;
  const gl = narrow ? 50 : 64;
  const gr = 26;
  const lineH = narrow ? 84 : 100;
  const rowH = 16;
  const y0 = 8;
  const rowY1 = y0 + lineH + 12;
  const rowY2 = rowY1 + rowH + 5;
  const axisY = rowY2 + rowH + 15;
  const H = axisY + 6;
  const plotW = Math.max(10, w - gl - gr);
  const cw = plotW / Math.max(1, n);
  const pms = hours.map((h) => h.pm25 ?? 0);
  const maxPm = Math.max(28, ...pms) * 1.12;
  const y = (pm: number) => y0 + lineH - (Math.min(pm, maxPm) / maxPm) * lineH;
  const cx = (k: number) => gl + k * cw + cw / 2;
  const bands: [number, number][] = [
    [0, 5],
    [5, 15],
    [15, 25],
    [25, maxPm],
  ];
  const pts = hours
    .map((h, k) => (h.pm25 === null ? null : `${cx(k).toFixed(1)},${y(h.pm25).toFixed(1)}`))
    .filter(Boolean);
  const step = cw * 3 >= 38 ? 3 : 6;
  const last = hours[n - 1];
  const showLetters = cw >= 13;

  return (
    <figure className="chart strip" ref={ref}>
      {w > 0 && n > 0 && (
        <svg width={w} height={H} aria-hidden="true">
          {bands.map(([a, b], i) =>
            a < maxPm ? (
              <rect key={i} x={gl} width={plotW} y={y(b)} height={y(a) - y(b)} fill={classFill(i)} className="band-bg" />
            ) : null,
          )}
          {[5, 15, 25].map((t) =>
            t < maxPm ? (
              <g key={t}>
                <line x1={gl} x2={gl + plotW} y1={y(t)} y2={y(t)} className="gridline" />
                <text x={gl + plotW + 4} y={y(t) + 3.5} className="tick num">
                  {t}
                </text>
              </g>
            ) : null,
          )}
          <text x={gl - 8} y={y0 + 9} textAnchor="end" className="axis-label">
            PM2.5
          </text>
          <text x={gl - 8} y={y0 + 21} textAnchor="end" className="axis-label axis-label--unit">
            µg/m³
          </text>
          <polyline points={pts.join(' ')} className="pm-line" />
          {last && last.pm25 !== null && (
            <g>
              <circle cx={cx(n - 1)} cy={y(last.pm25)} r="3.5" className="pm-dot" />
              <text x={cx(n - 1) - 7} y={y(last.pm25) - 8} textAnchor="end" className="num value-label">
                {num(last.pm25, 1)}
              </text>
            </g>
          )}

          <text x={gl - 8} y={rowY1 + 12} textAnchor="end" className="axis-label">
            Reading
          </text>
          <text x={gl - 8} y={rowY2 + 12} textAnchor="end" className="axis-label">
            Viterbi
          </text>
          {hours.map((h, k) => (
            <g key={h.time}>
              {[
                [rowY1, h.obs],
                [rowY2, h.viterbi],
              ].map(([ry, c], j) => (
                <g key={j}>
                  <rect x={gl + k * cw + 0.5} y={ry} width={Math.max(1, cw - 1)} height={rowH} fill={classFill(c)} />
                  <rect x={gl + k * cw + 0.5} y={ry} width={Math.max(1, cw - 1)} height={rowH} fill={classPattern(c)} />
                  {showLetters && (
                    <text x={cx(k)} y={ry + 11.5} textAnchor="middle" className="cell-letter" style={{ fill: classOn(c) }}>
                      {CLASS_LETTER[c]}
                    </text>
                  )}
                </g>
              ))}
              {hourOf(h.time) % step === 0 && (
                <text x={cx(k)} y={axisY} textAnchor="middle" className="tick num">
                  {hourOf(h.time) === 0 ? dayMonth(h.time) : hhmm(h.time)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      <figcaption>
        <em>Reading</em>: the class of each hourly value. <em>Viterbi</em>: the most likely sequence of true classes.
      </figcaption>
      <SrTable
        caption="Last 24 hours: model PM2.5, reading class and most likely class"
        head={['Time', 'PM2.5 (µg/m³)', 'Reading class', 'Most likely class (Viterbi)']}
        rows={hours.map((h) => [
          hhmm(h.time),
          h.pm25 === null ? '–' : num(h.pm25, 1),
          CLASS_LABEL[h.obs],
          CLASS_LABEL[h.viterbi],
        ])}
      />
    </figure>
  );
}
