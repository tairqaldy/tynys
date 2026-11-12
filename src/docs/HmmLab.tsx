import '../styles/lab-hmm.css';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AirResponse, BlockId, ClassIdx, FilteredHour, Mat4, Vec4 } from '../api/types';
import { SrTable } from '../components/common';
import { Segmented } from '../components/controls';
import { CLASS_IDS, CLASS_LABEL, CLASS_LETTER, IDX, argmax, classFill, classOn, classPattern } from '../lib/classes';
import { dayMonth, hhmm, hourOf, num, pct } from '../lib/format';
import { useReducedMotion, useWidth } from '../lib/hooks';
import { useTweenVec } from '../lib/motion';
import { BLOCKS, blockOfHour, filterStep, type FilterStep } from './hmmStep';
import { Lab, LabButton } from './Lab';

const TITLE = 'Bayes filter, one reading at a time';
/** length of each of the three stages of one update */
const STAGE_MS = 460;
/** the bars glide a little faster than a stage, so each stage rests for a beat before the next */
const TWEEN_MS = 400;

type Phase = 'idle' | 'predict' | 'weigh' | 'normalise' | 'done';
const STAGE_INDEX: Record<Phase, number> = { idle: -1, predict: 0, weigh: 1, normalise: 2, done: 3 };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Class colour, its pattern and its letter. */
function Swatch({ i }: { i: number }) {
  return (
    <span className="hl-sw" data-c={CLASS_IDS[i]} aria-hidden="true">
      <svg>
        <rect width="100%" height="100%" fill={classPattern(i)} />
      </svg>
      <span>{CLASS_LETTER[i]}</span>
    </span>
  );
}

export function HmmLab({ air }: { air: AirResponse | null }) {
  if (!air) {
    return (
      <Lab title={TITLE} className="hl">
        <div className="hl-skel" aria-busy="true">
          <span className="sr-only" role="status">
            Loading the model…
          </span>
          {IDX.map((i) => (
            <div key={i} className="hl-skel__row" />
          ))}
        </div>
      </Lab>
    );
  }
  // a new city or a new hour starts the lab again from that hour's belief
  return <HmmLabLive key={`${air.city}|${air.now}|${air.hmm.reliability}`} air={air} />;
}

function HmmLabLive({ air }: { air: AirResponse }) {
  const h = air.hmm;
  const reduced = useReducedMotion();
  const nowBlock = blockOfHour(hourOf(air.now));
  const [block, setBlock] = useState<BlockId>(nowBlock);
  const [belief, setBelief] = useState<Vec4>(h.belief_now);
  const [fed, setFed] = useState<{ obs: ClassIdx; block: BlockId }[]>([]);
  const [step, setStep] = useState<FilterStep | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const feed = (obs: ClassIdx) => {
    clear();
    // `belief` is already the end of any update still animating, so a quick second click chains correctly
    const s = filterStep(belief, h.transitions[block], h.emission, obs, block);
    setBelief(s.posterior);
    setStep(s);
    setFed((f) => [...f, { obs, block }]);
    setRun((n) => n + 1);
    if (reduced) {
      setPhase('done');
      return;
    }
    setPhase('predict');
    (['weigh', 'normalise', 'done'] as Phase[]).forEach((p, k) => {
      timers.current.push(window.setTimeout(() => setPhase(p), STAGE_MS * (k + 1)));
    });
  };

  const reset = () => {
    clear();
    setBelief(h.belief_now);
    setFed([]);
    setStep(null);
    setPhase('idle');
  };

  const stage = STAGE_INDEX[phase];
  const running = stage >= 0 && stage < 3;
  const target: Vec4 =
    !step || phase === 'idle'
      ? belief
      : phase === 'predict'
        ? step.predicted
        : phase === 'weigh'
          ? step.unnormalised
          : step.posterior;
  const shown = useTweenVec(target, TWEEN_MS);
  const sum = shown.reduce((a, b) => a + b, 0);
  const top = argmax(target);
  // the settled belief: what the readout talks about, updated when an update has finished
  const settled = running && step ? step.from : belief;
  const settledTop = argmax(settled);
  const settledCount = fed.length - (running ? 1 : 0);

  const barsLabel =
    !step || phase === 'idle'
      ? `Belief at ${hhmm(air.now)}`
      : phase === 'predict'
        ? 'Prior, one hour on'
        : phase === 'weigh'
          ? 'Prior × likelihood'
          : 'Posterior';

  // rows of A that feed the prediction: the belief that went in (or goes in next, with this block)
  const feeding: Vec4 = step && step.block === block ? step.from : belief;
  const obsCol = step && stage >= 1 ? step.obs : null;
  const blockInfo = BLOCKS.find((b) => b.id === block)!;

  return (
    <Lab
      title={TITLE}
      className="hl"
      tag={`${air.source === 'snapshot' ? 'snapshot' : 'live'} · ${cap(air.city)} ${hhmm(air.now)}`}
      actions={
        <LabButton onClick={reset} disabled={fed.length === 0} title="Back to the belief from the model">
          Reset
        </LabButton>
      }
      readout={
        <div className="hl-readout">
          <span className="hl-readout__k">Fed</span>
          {fed.length === 0 ? (
            <span className="hl-readout__none">none yet</span>
          ) : (
            <ol className="hl-fed" aria-label={`Readings fed: ${fed.map((f) => CLASS_LABEL[f.obs]).join(', ')}`}>
              {fed.length > 12 && <li className="hl-fed__more num">+{fed.length - 12}</li>}
              {fed.slice(-12).map((f, k) => (
                <li key={fed.length - Math.min(12, fed.length) + k} title={`${CLASS_LABEL[f.obs]} reading · ${f.block} matrix`}>
                  <Swatch i={f.obs} />
                </li>
              ))}
            </ol>
          )}
          <span className="hl-readout__line">
            {settledCount === 0
              ? `From ${h.filtered.length} model readings`
              : `After ${settledCount} reading${settledCount === 1 ? '' : 's'}`}
            {' · '}most likely <strong>{CLASS_LABEL[settledTop]}</strong>{' '}
            <span className="num">{pct(settled[settledTop])}</span>
          </span>
        </div>
      }
    >
      <div className="hl-body">
        <div className="hl-controls">
          <div className="hl-ctl">
            <span className="hl-ctl__k" id="hl-feed-k">
              Feed a reading
            </span>
            <div className="hl-feed" role="group" aria-labelledby="hl-feed-k">
              {IDX.map((i) => (
                <button
                  key={i}
                  type="button"
                  className="hl-feed__btn"
                  onClick={() => feed(i)}
                  aria-label={`Feed a ${CLASS_LABEL[i].toLowerCase()} reading`}
                >
                  <Swatch i={i} />
                  <span className="hl-feed__name">{CLASS_LABEL[i]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="hl-ctl">
            <span className="hl-ctl__k">Transition block</span>
            <div className="hl-block">
              <Segmented
                label="Time-of-day block whose transition matrix the prediction uses"
                name="hl-block"
                value={block}
                onChange={setBlock}
                options={BLOCKS.map((b) => ({ value: b.id, label: cap(b.id) }))}
              />
              <span className="hl-block__hours num">
                {blockInfo.hours}
                {block === nowBlock && <span className="hl-block__now"> · now</span>}
              </span>
            </div>
          </div>
        </div>

        <ol className="hl-stages" aria-label="Stages of one update">
          {(
            [
              ['Predict', <>A<sup>⊤</sup>b</>],
              ['Weigh', <>× B[s, {step ? CLASS_LETTER[step.obs] : 'o'}]</>],
              ['Normalise', step ? <>÷ <span className="num">{num(step.evidence, 4)}</span></> : <>÷ Σ</>],
            ] as [string, ReactNode][]
          ).map(([name, f], k) => (
            <li key={name} className={`hl-stage${k < stage ? ' is-done' : ''}${k === stage ? ' is-on' : ''}`} aria-current={k === stage ? 'step' : undefined}>
              <span className="hl-stage__n num" aria-hidden="true">
                {k + 1}
              </span>
              <span className="hl-stage__name">{name}</span>
              <span className="hl-stage__f f">{f}</span>
              <span className="hl-stage__bar" aria-hidden="true">
                <i key={`${run}-${k === stage ? 'on' : 'off'}`} style={{ '--ms': `${STAGE_MS}ms` } as CSSProperties} />
              </span>
            </li>
          ))}
        </ol>

        <div className="hl-main">
          <div className="hl-bars" role="img" aria-label={`${barsLabel}: ${shown.map((p, i) => `${CLASS_LABEL[i]} ${pct(p, 1)}`).join(', ')}`}>
            <div className="hl-head">
              <span className="hl-head__k">{barsLabel}</span>
              <span className={`hl-head__sum num${Math.abs(sum - 1) > 0.002 ? ' is-off' : ''}`}>
                Σ {pct(sum, 1)}
                {phase === 'weigh' && <span className="hl-head__ev"> = evidence</span>}
              </span>
            </div>
            {IDX.map((i) => (
              <div key={i} className={`hl-bar${i === top ? ' is-top' : ''}`} data-c={CLASS_IDS[i]}>
                <Swatch i={i} />
                <span className="hl-bar__name">{CLASS_LABEL[i]}</span>
                <span className="hl-bar__track">
                  <span className="hl-bar__fill" style={{ width: `${Math.max(0, shown[i]) * 100}%` }}>
                    <svg>
                      <rect width="100%" height="100%" fill={classPattern(i)} />
                    </svg>
                  </span>
                  {step && <span className="hl-bar__ghost" style={{ left: `${step.from[i] * 100}%` }} />}
                </span>
                <span className="hl-bar__pct num">{pct(shown[i], 1)}</span>
              </div>
            ))}
          </div>
          <Ledger step={step} stage={stage} run={run} />
        </div>

        <div className="hl-mats">
          <Heat
            m={h.transitions[block]}
            kind="A"
            title={
              <>
                <span className="f">
                  A<sub>{block}</sub>
                </span>{' '}
                transition
              </>
            }
            axes={['from', 'to']}
            weights={feeding}
            live={phase === 'predict'}
            backed={new Set(h.backed_off.filter((b) => b.block === block).map((b) => b.row as number))}
            caption={`Transition matrix for the ${block} block (${blockInfo.hours}): rows the class this hour, columns the class next hour`}
          />
          <Heat
            m={h.emission}
            kind="B"
            title={
              <>
                <span className="f">B</span> emission · <span className="f">r</span> ={' '}
                <span className="num">{num(h.reliability, 2)}</span>
              </>
            }
            axes={['class', 'reading']}
            col={obsCol}
            live={phase === 'weigh'}
            caption={`Emission matrix with reading trust r = ${num(h.reliability, 2)}: rows the true class, columns the reading`}
          />
        </div>

        <ViterbiStrip filtered={h.filtered} />

        <p className="sr-only" aria-live="polite">
          {phase === 'done' && step
            ? `${CLASS_LABEL[step.obs]} reading: posterior ${step.posterior.map((p, i) => `${CLASS_LABEL[i]} ${pct(p)}`).join(', ')}.`
            : ''}
        </p>
      </div>
    </Lab>
  );
}

/** The numbers of the current update: prior, likelihood, product and posterior, filled in stage by stage. */
function Ledger({ step, stage, run }: { step: FilterStep | null; stage: number; run: number }) {
  const cols: { key: string; label: string; f: ReactNode; from: number; v: (s: FilterStep) => readonly number[]; d: number }[] = [
    { key: 'p', label: 'prior', f: <>A<sup>⊤</sup>b</>, from: 0, v: (s) => s.predicted, d: 3 },
    { key: 'l', label: '× lik.', f: <>B[s, {step ? CLASS_LETTER[step.obs] : 'o'}]</>, from: 1, v: (s) => s.likelihood, d: 2 },
    { key: 'u', label: '= product', f: <>P(s, o)</>, from: 1, v: (s) => s.unnormalised, d: 4 },
    {
      key: 'q',
      label: 'posterior',
      f: step ? <>÷ <span className="num">{num(step.evidence, 4)}</span></> : <>÷ Σ</>,
      from: 2,
      v: (s) => s.posterior,
      d: 3,
    },
  ];
  const active = (c: (typeof cols)[number]) => stage === c.from;
  return (
    <table className="hl-ledger">
      <caption className="sr-only">Numbers of the last update, one row per class</caption>
      <thead>
        <tr>
          <th scope="col" className="hl-ledger__rowh">
            <span className="sr-only">Class</span>
          </th>
          {cols.map((c) => (
            <th key={c.key} scope="col" className={active(c) ? 'is-on' : undefined}>
              <span className="hl-ledger__k">{c.label}</span>
              <span className="hl-ledger__f f">{c.f}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {IDX.map((i) => (
          <tr key={i}>
            <th scope="row" className="hl-ledger__rowh">
              <Swatch i={i} />
              <span className="sr-only">{CLASS_LABEL[i]}</span>
            </th>
            {cols.map((c) => {
              const shown = step !== null && stage >= c.from;
              const x = shown ? c.v(step!)[i] : 0;
              return (
                <td key={c.key} className={`num${active(c) ? ' is-on' : ''}${shown && x === 0 ? ' is-zero' : ''}`}>
                  {shown ? (
                    <span key={run} className="hl-ledger__v">
                      {num(x, c.d)}
                    </span>
                  ) : (
                    <span className="hl-ledger__dash">
                      <span className="sr-only">not computed yet</span>
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A 4×4 probability matrix shaded by value. `weights` dims the rows that do not feed the prediction;
 *  `col` dims every column but the reading's. */
function Heat({
  m,
  kind,
  title,
  axes,
  weights,
  col = null,
  live,
  backed,
  caption,
}: {
  m: Mat4;
  kind: 'A' | 'B';
  title: ReactNode;
  axes: [string, string];
  weights?: Vec4;
  col?: number | null;
  live: boolean;
  backed?: ReadonlySet<number>;
  caption: string;
}) {
  return (
    <figure className={`hl-heat hl-heat--${kind}${live ? ' is-live' : ''}`}>
      <figcaption className="hl-heat__title">
        <span>{title}</span>
        <span className="hl-heat__axes">
          {axes[0]} ↓ · {axes[1]} →
        </span>
      </figcaption>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {weights && (
              <th scope="col" className="hl-heat__wh">
                <span className="f" aria-hidden="true">
                  b
                </span>
                <span className="sr-only">belief weight of the row</span>
              </th>
            )}
            <th scope="col">
              <span className="sr-only">{axes[0]} \ {axes[1]}</span>
            </th>
            {IDX.map((j) => (
              <th key={j} scope="col" className={`hl-heat__ch${col === j ? ' is-on' : ''}`}>
                <Swatch i={j} />
                <span className="sr-only">{CLASS_LABEL[j]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.map((row, i) => {
            const feeds = !weights || weights[i] >= 0.005;
            return (
              <tr key={i} className={weights ? (feeds ? 'is-feed' : 'is-idle') : undefined}>
                {weights && <td className="hl-heat__w num">{num(weights[i], 2)}</td>}
                <th scope="row" className="hl-heat__rh">
                  <Swatch i={i} />
                  <span className="sr-only">{CLASS_LABEL[i]}</span>
                  {backed?.has(i) && (
                    <span className="hl-heat__dag" title="Fewer than 20 changes counted: this row uses the pooled all-day counts">
                      †
                    </span>
                  )}
                </th>
                {row.map((p, j) => (
                  <td
                    key={j}
                    className={`hl-heat__c num${p >= 0.5 ? ' is-dark' : ''}${p === 0 ? ' is-zero' : ''}${col !== null && col !== j ? ' is-dim' : ''}${col === j ? ' is-col' : ''}`}
                    style={{ '--p': p } as CSSProperties}
                  >
                    {num(p, 3)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

/** Reading band and Viterbi class for the last 24 model hours, cell under cell. */
function ViterbiStrip({ filtered }: { filtered: FilteredHour[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = filtered.length;
  const narrow = w < 440;
  const lw = narrow ? 56 : 66;
  const cw = n > 0 ? Math.max(4, (w - lw) / n) : 0;
  const rowH = narrow ? 18 : 20;
  const gap = 3;
  const y2 = rowH + gap;
  const axisY = y2 + rowH + 15;
  const H = axisY + 3;
  const letters = cw >= 15;
  const every = cw * 3 >= 40 ? 3 : 6;
  const diffs = filtered.filter((f) => f.obs !== f.viterbi);
  return (
    <figure className="hl-vit">
      <figcaption className="hl-vit__title">
        <span>
          Viterbi · most likely path, last {n} h
        </span>
        <span className="hl-vit__diff">
          {diffs.length === 0 ? (
            'same as the readings every hour'
          ) : (
            <>
              <span className="hl-vit__mark" aria-hidden="true" />
              {diffs.length === 1 ? '1 hour differs' : `${diffs.length} hours differ`}
            </>
          )}
        </span>
      </figcaption>
      <div ref={ref} className="hl-vit__plot">
        {w > 0 && n > 0 && (
          <svg width={w} height={H} aria-hidden="true">
            <text x={0} y={rowH / 2 + 4} className="hl-vit__lab">
              Reading
            </text>
            <text x={0} y={y2 + rowH / 2 + 4} className="hl-vit__lab">
              Viterbi
            </text>
            {filtered.map((f, k) => {
              const x = lw + k * cw;
              const hr = hourOf(f.time);
              const differs = f.obs !== f.viterbi;
              const isLast = k === n - 1;
              const tick = hr % every === 0 && k < n - 2;
              return (
                <g key={f.time}>
                  <title>{`${hhmm(f.time)} · reading ${CLASS_LABEL[f.obs]} · Viterbi ${CLASS_LABEL[f.viterbi]}`}</title>
                  {(
                    [
                      [0, f.obs],
                      [y2, f.viterbi],
                    ] as const
                  ).map(([y, c]) => (
                    <g key={y}>
                      <rect x={x + 0.5} y={y} width={Math.max(1, cw - 1)} height={rowH} rx={1.5} fill={classFill(c)} />
                      <rect x={x + 0.5} y={y} width={Math.max(1, cw - 1)} height={rowH} rx={1.5} fill={classPattern(c)} />
                      {letters && (
                        <text x={x + cw / 2} y={y + rowH / 2 + 3.8} textAnchor="middle" className="hl-vit__l" style={{ fill: classOn(c) }}>
                          {CLASS_LETTER[c]}
                        </text>
                      )}
                    </g>
                  ))}
                  {differs && (
                    <rect x={x - 1} y={-2.5} width={cw + 2} height={2 * rowH + gap + 5} rx={3} className="hl-vit__ring" />
                  )}
                  {(tick || isLast) && (
                    <>
                      <line x1={x + cw / 2} x2={x + cw / 2} y1={y2 + rowH + 2} y2={y2 + rowH + 5} className="hl-vit__tickline" />
                      <text
                        x={isLast ? x + cw : x + cw / 2}
                        y={axisY}
                        textAnchor={isLast ? 'end' : 'middle'}
                        className={`hl-vit__tick num${isLast ? ' is-now' : ''}`}
                      >
                        {isLast ? 'now' : hr === 0 ? dayMonth(f.time) : hhmm(f.time).slice(0, 2)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <SrTable
        caption="Last 24 hours: reading class and most likely class (Viterbi)"
        head={['Time', 'Reading class', 'Most likely class (Viterbi)']}
        rows={filtered.map((f) => [hhmm(f.time), CLASS_LABEL[f.obs], CLASS_LABEL[f.viterbi]])}
      />
    </figure>
  );
}
