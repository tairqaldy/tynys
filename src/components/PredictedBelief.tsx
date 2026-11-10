import type { PredictedHour } from '../api/types';
import { CLASS_LABEL, CLASS_LETTER, classFill, classInk } from '../lib/classes';
import { dayMonth, hhmm, hourOf, num, pct } from '../lib/format';
import { useWidth } from '../lib/hooks';
import { SrTable } from './common';

/** Predicted belief for the next hours as stacked columns (low at the bottom, high on top). */
export function PredictedBelief({ predicted }: { predicted: PredictedHour[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = predicted.length;
  const narrow = w < 480;
  const gl = narrow ? 50 : 64;
  const gr = 26;
  const y0 = 18;
  const colH = narrow ? 88 : 104;
  const rowY = y0 + colH + 8;
  const rowH = 9;
  const axisY = rowY + rowH + 15;
  const H = axisY + 6;
  const plotW = Math.max(10, w - gl - gr);
  const cw = plotW / Math.max(1, n);
  const gap = cw > 6 ? 1 : 0.5;
  const lastP = predicted[n - 1];
  const first = predicted[0];

  const segs = (b: number[]) => {
    let acc = 0;
    return b.map((p) => {
      const s = { from: acc, to: acc + p };
      acc += p;
      return s;
    });
  };
  const yOf = (v: number) => y0 + colH - v * colH;

  return (
    <figure className="chart predicted" ref={ref}>
      {w > 0 && n > 0 && (
        <svg width={w} height={H} aria-hidden="true">
          <text x={gl - 8} y={yOf(0) } textAnchor="end" className="tick num">
            0
          </text>
          <text x={gl - 8} y={yOf(1) + 9} textAnchor="end" className="tick num">
            100%
          </text>
          {predicted.map((h, k) => {
            const x = gl + k * cw;
            return (
              <g key={h.time}>
                {segs(h.belief).map((s, i) =>
                  s.to - s.from > 0.0005 ? (
                    <rect key={i} x={x} y={yOf(s.to)} width={Math.max(0.5, cw - gap)} height={(s.to - s.from) * colH} fill={classFill(i)} className="stack-seg" />
                  ) : null,
                )}
                <rect x={x} y={rowY} width={Math.max(0.5, cw - gap)} height={rowH} fill={classFill(h.forecast_band)} />
                {hourOf(h.time) === 0 && (
                  <g>
                    <line x1={x - gap / 2} x2={x - gap / 2} y1={y0 - 12} y2={rowY + rowH} className="dayline" />
                    <text x={x + 3} y={y0 - 5} className="tick">
                      {dayMonth(h.time)}
                    </text>
                  </g>
                )}
                {hourOf(h.time) % 6 === 0 && (
                  <text x={x + cw / 2} y={axisY} textAnchor="middle" className="tick num">
                    {narrow ? hhmm(h.time).slice(0, 2) : hhmm(h.time)}
                  </text>
                )}
              </g>
            );
          })}
          <text x={gl - 8} y={rowY + 8} textAnchor="end" className="axis-label">
            Forecast
          </text>
          {lastP &&
            segs(lastP.belief).map((s, i) =>
              s.to - s.from > 0.12 ? (
                <text key={i} x={gl + plotW + 5} y={yOf((s.from + s.to) / 2) + 4} className="seg-letter" style={{ fill: classInk(i) }}>
                  {CLASS_LETTER[i]}
                </text>
              ) : null,
            )}
        </svg>
      )}
      <figcaption>
        Where the model expects the class to be over the next {n} hours. Each column is a belief that sums to 100%; the
        thin row under it is the class of the forecast value, which the model trusts less the further ahead it is (from{' '}
        <span className="num">{first ? num(first.forecast_reliability, 3) : '–'}</span> down to{' '}
        <span className="num">{lastP ? num(lastP.forecast_reliability, 3) : '–'}</span>).
      </figcaption>
      <SrTable
        caption="Predicted belief by hour"
        head={['Time', 'Low', 'Moderate', 'Elevated', 'High', 'Forecast class', 'Expected PM2.5']}
        rows={predicted.map((h) => [
          `${dayMonth(h.time)} ${hhmm(h.time)}`,
          ...h.belief.map((p) => pct(p)),
          CLASS_LABEL[h.forecast_band],
          num(h.expected_pm25, 1),
        ])}
      />
    </figure>
  );
}
