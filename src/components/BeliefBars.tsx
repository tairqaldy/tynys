import type { Vec4 } from '../api/types';
import { CLASS_LABEL, CLASS_LETTER, CLASS_RANGE, argmax, classFill, classInk, classOn, classPattern } from '../lib/classes';
import { pct } from '../lib/format';
import { useWidth } from '../lib/hooks';
import { useInView, useTweenVec } from '../lib/motion';

/** The belief over the four classes as horizontal bars with direct percentage labels. */
export function BeliefBars({ belief, caption }: { belief: Vec4; caption: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [viewRef, seen] = useInView<HTMLDivElement>('0px');
  const shown = useTweenVec(seen ? belief : [0, 0, 0, 0], 800);
  const rowH = 36;
  const labelW = 132;
  const pctW = 52;
  const trackX = labelW;
  const trackW = Math.max(40, w - labelW - pctW);
  const top = argmax(belief);
  const summary = `${caption}: ${belief.map((p, i) => `${CLASS_LABEL[i]} ${pct(p)}`).join(', ')}.`;
  return (
    <figure className="chart belief" ref={ref}>
      <div ref={viewRef} />
      {w > 0 && (
        <svg width={w} height={rowH * 4} role="img" aria-label={summary}>
          {belief.map((p, i) => {
            const y = i * rowH;
            const bw = Math.max(p > 0 ? 1.5 : 0, (shown[i] ?? p) * trackW);
            return (
              <g key={i} transform={`translate(0 ${y})`} className={i === top ? 'is-top' : undefined}>
                <rect x="0" y="7" width="20" height="20" rx="3" fill={classFill(i)} />
                <rect x="0" y="7" width="20" height="20" rx="3" fill={classPattern(i)} />
                <text x="10" y="21.5" textAnchor="middle" className="chip-letter" style={{ fill: classOn(i) }}>
                  {CLASS_LETTER[i]}
                </text>
                <text x="30" y="17" className="belief__label">
                  {CLASS_LABEL[i]}
                </text>
                <text x="30" y="31" className="belief__range">
                  {CLASS_RANGE[i]} µg/m³
                </text>
                <rect x={trackX} y="12" width={trackW} height="12" rx="2" className="track" />
                {bw > 0 && (
                  <>
                    <rect x={trackX} y="12" width={bw} height="12" rx="2" fill={classFill(i)} />
                    <rect x={trackX} y="12" width={bw} height="12" rx="2" fill={classPattern(i)} stroke={classInk(i)} strokeWidth="1" />
                  </>
                )}
                <text x={w} y="23" textAnchor="end" className="num belief__pct">
                  {pct(p)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
