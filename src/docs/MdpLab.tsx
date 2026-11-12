import '../styles/lab-mdp.css';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { Action, ActivityId, PlanResponse } from '../api/types';
import { Chips, Slider } from '../components/controls';
import { ActionGlyph } from '../components/PolicyGrid';
import { CLASS_IDS, CLASS_LABEL, CLASS_LETTER, IDX, classPattern } from '../lib/classes';
import { hhmm, num, pct } from '../lib/format';
import { useWidth } from '../lib/hooks';
import { useTweenVec } from '../lib/motion';
import type { DocPlanParams } from './DocsPage';
import { Lab, LabButton } from './Lab';
import { backup, beliefQ, type Backup } from './mdpStep';

const TITLE = 'Backward induction, from the deadline to now';
/** one column of the backward sweep */
const COL_MS = 180;
/** rows top to bottom: high air on top */
const ROWS = [3, 2, 1, 0] as const;

const ACTIVITIES: { value: ActivityId; label: string; note?: string }[] = [
  { value: 'walk', label: 'Walk' },
  { value: 'run', label: 'Run' },
  { value: 'kids', label: 'With a child' },
  { value: 'errand', label: 'Errand', note: 'no skip' },
];
const ACTION_NOW: Record<Action, string> = { go: 'Go now', wait: 'Wait', skip: 'Skip today' };

/** Class colour, its pattern and its letter. */
function Swatch({ i }: { i: number }) {
  return (
    <span className="ml-sw" data-c={CLASS_IDS[i]} aria-hidden="true">
      <svg>
        <rect width="100%" height="100%" fill={classPattern(i)} />
      </svg>
      <span>{CLASS_LETTER[i]}</span>
    </span>
  );
}

const sub = (n: number | string) => <sub>{n}</sub>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function MdpLab({
  plan,
  loading,
  params,
  setParams,
}: {
  plan: PlanResponse | null;
  loading: boolean;
  params: DocPlanParams;
  setParams: (p: Partial<DocPlanParams>) => void;
}) {
  // the plan on screen may be for older settings while the new one is debounced or fetched
  const stale =
    loading ||
    (plan !== null &&
      (plan.inputs.activity !== params.activity ||
        Math.abs(plan.inputs.wait_cost - params.waitCost) > 1e-9 ||
        plan.inputs.deadline_hours !== params.deadline));

  const H = plan ? plan.hours.length - 1 : params.deadline;

  // backward sweep: `cursor` is the column being computed; columns t >= cursor are done; null = all done
  const [cursor, setCursor] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  const stop = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => stop, []);
  useEffect(() => {
    stop();
    setCursor(null);
  }, [plan]);

  const play = () => {
    if (!plan) return;
    stop();
    setCursor(H + 1);
    for (let k = 0; k <= H; k++) {
      timers.current.push(window.setTimeout(() => setCursor(H - k), COL_MS * (k + 1)));
    }
    timers.current.push(window.setTimeout(() => setCursor(null), COL_MS * (H + 1) + 520));
  };
  const playing = cursor !== null;

  // selected cell, default: the most likely class now at t = 0
  const [sel, setSel] = useState<{ t: number; s: number } | null>(null);
  const cell = plan ? (sel && sel.t <= H ? sel : { t: 0, s: plan.state_now }) : null;

  const d = plan?.decision;
  const qs = d ? [d.q_go, d.q_wait, d.q_skip] : [0, 0, 0];
  const runnerUp = d
    ? (['go', 'wait', 'skip'] as Action[])
        .map((a, k) => ({ a, q: qs[k] }))
        .filter((x) => x.a !== d.action && x.q !== null)
        .sort((x, y) => (y.q as number) - (x.q as number))[0]
    : undefined;
  const winQ = d ? qs[['go', 'wait', 'skip'].indexOf(d.action)] : null;

  return (
    <Lab
      title={TITLE}
      className="ml"
      tag={plan ? `${plan.source === 'snapshot' ? 'snapshot' : 'live'} · ${cap(plan.city)} ${hhmm(plan.now)}` : undefined}
      actions={
        <LabButton kind="solid" onClick={play} disabled={!plan || stale} title="Fill the grid from the deadline back to now">
          <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
            <path d="M1 1 L9 6 L1 11 Z" fill="currentColor" />
          </svg>
          {playing ? 'Replay' : 'Play'}
        </LabButton>
      }
      readout={
        d && winQ !== null ? (
          <div className={`ml-readout${stale ? ' is-stale' : ''}`}>
            <strong>{ACTION_NOW[d.action]}</strong>
            <span className="num">
              {num(winQ, 2)} vs {runnerUp?.a} {num(runnerUp?.q ?? null, 2)}
            </span>
            {d.action === 'wait' && d.best_time && (
              <span className="ml-readout__soft">probably out at {hhmm(d.best_time)}</span>
            )}
          </div>
        ) : (
          <span className="ml-readout__soft">Solving…</span>
        )
      }
    >
      <div className="ml-body">
        <div className="ml-controls">
          <Chips
            legend="Activity"
            name="ml-activity"
            value={params.activity}
            onChange={(v) => setParams({ activity: v })}
            options={ACTIVITIES}
          />
          <div className="ml-sliders">
            <Slider
              label="Waiting cost"
              value={params.waitCost}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(v) => setParams({ waitCost: Math.round(v * 100) / 100 })}
              display={`${num(params.waitCost, 2)} per hour`}
              ends={['0.1 flexible', '1.0 in a hurry']}
            />
            <Slider
              label="Deadline"
              value={params.deadline}
              min={1}
              max={12}
              step={1}
              onChange={(v) => setParams({ deadline: v })}
              display={`within ${params.deadline} h`}
              valueText={`within ${params.deadline} hours`}
              ends={['1 h', '12 h']}
            />
          </div>
        </div>

        <div className={`ml-out${stale ? ' is-stale' : ''}`} aria-busy={stale || undefined}>
          {plan && cell ? (
            <>
              <PolicyGrid plan={plan} cursor={cursor} cell={cell} onSelect={(t, s) => setSel({ t, s })} />
              <BackupCard plan={plan} b={backup(plan, cell.t, cell.s)} pending={cursor !== null && cell.t < cursor} />
              <Decision plan={plan} />
            </>
          ) : (
            <div className="ml-skel" aria-hidden="true">
              {ROWS.map((s) => (
                <div key={s} className="ml-skel__row" style={{ '--n': H + 1 } as CSSProperties}>
                  {Array.from({ length: H + 2 }, (_, k) => (
                    <span key={k} />
                  ))}
                </div>
              ))}
            </div>
          )}
          {!plan && (
            <p className="sr-only" role="status">
              Solving the plan…
            </p>
          )}
        </div>
      </div>
    </Lab>
  );
}

/* ------------------------------------------------------------------ policy grid */

function PolicyGrid({
  plan,
  cursor,
  cell,
  onSelect,
}: {
  plan: PlanResponse;
  cursor: number | null;
  cell: { t: number; s: number };
  onSelect: (t: number, s: number) => void;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const H = plan.hours.length - 1;
  const n = H + 1;
  const narrow = w > 0 && w < 470;
  const lw = narrow ? 30 : 104;
  // columns share the width, but never grow wider than 72 px (a short deadline would make huge cells)
  const colW = w > 0 ? Math.min(72, (w - lw) / n) : 40;
  const showV = colW >= 37;
  const cells = useRef(new Map<string, HTMLDivElement>());

  const go = (t: number, s: number) => {
    const tt = Math.max(0, Math.min(H, t));
    const ss = Math.max(0, Math.min(3, s));
    onSelect(tt, ss);
    cells.current.get(`${tt}-${ss}`)?.focus();
  };
  const onKey = (e: KeyboardEvent, t: number, s: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [t - 1, s],
      ArrowRight: [t + 1, s],
      ArrowUp: [t, s + 1], // higher class is the row above
      ArrowDown: [t, s - 1],
      Home: [0, s],
      End: [H, s],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    go(m[0], m[1]);
  };

  return (
    <div
      ref={ref}
      className={`ml-grid${narrow ? ' is-narrow' : ''}${cursor !== null ? ' is-playing' : ''}`}
      style={{ '--n': n, '--lw': `${lw}px`, '--cw': `${colW}px` } as CSSProperties}
    >
      <div
        role="grid"
        className="ml-grid__table"
        aria-label="Policy: the best action for each class of air (rows) at each hour t (columns). Arrow keys move between cells."
        aria-rowcount={5}
        aria-colcount={n + 1}
      >
        <div role="row" className="ml-row ml-row--head">
          <div role="columnheader" className="ml-corner">
            <span className="ml-corner__t f">t</span>
            <span className="ml-corner__c">{narrow ? '' : 'time'}</span>
          </div>
          {plan.hours.map((h) => (
            <div
              key={h.t}
              role="columnheader"
              className={`ml-colh${h.t === 0 ? ' is-now' : ''}${cursor === h.t ? ' is-cursor' : ''}${cell.t === h.t ? ' is-sel' : ''}`}
            >
              <span className="ml-colh__t num">{h.t}</span>
              <span className="ml-colh__c num">
                {h.t === 0 ? 'now' : narrow || colW < 44 ? hhmm(h.time).slice(0, 2) : hhmm(h.time)}
              </span>
            </div>
          ))}
        </div>
        {ROWS.map((s) => (
          <div key={s} role="row" className="ml-row">
            <div role="rowheader" className="ml-rowh" data-c={CLASS_IDS[s]}>
              <Swatch i={s} />
              {!narrow && <span className="ml-rowh__name">{CLASS_LABEL[s]}</span>}
              {narrow && <span className="sr-only">{CLASS_LABEL[s]}</span>}
            </div>
            {plan.hours.map((h) => {
              const a = h.policy[s];
              const v = h.value[s];
              const done = cursor === null || h.t >= cursor;
              const isSel = cell.t === h.t && cell.s === s;
              const isNow = h.t === 0 && s === plan.state_now;
              const feeds = cell.t < H && h.t === cell.t + 1;
              return (
                <div
                  key={h.t}
                  ref={(el) => {
                    if (el) cells.current.set(`${h.t}-${s}`, el);
                    else cells.current.delete(`${h.t}-${s}`);
                  }}
                  role="gridcell"
                  tabIndex={isSel ? 0 : -1}
                  aria-selected={isSel}
                  aria-label={`${h.t === 0 ? 'now' : hhmm(h.time)}, ${CLASS_LABEL[s]}: ${done ? `${a}, V ${num(v, 2)}` : 'not computed yet'}${isNow ? ', most likely class now' : ''}`}
                  className={`ml-cell ml-cell--${a}${done ? '' : ' is-pending'}${cursor === h.t ? ' is-computing' : ''}${isSel ? ' is-sel' : ''}${isNow ? ' is-now' : ''}${feeds ? ' is-feeds' : ''}`}
                  onClick={() => go(h.t, s)}
                  onFocus={() => {
                    if (!isSel) onSelect(h.t, s);
                  }}
                  onKeyDown={(e) => onKey(e, h.t, s)}
                >
                  <span className="ml-cell__box">
                    <ActionGlyph a={a} />
                    {showV && <span className="ml-cell__v num">{num(v, 2)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="ml-cursor-layer" aria-hidden="true">
          <div
            className={`ml-cursor${cursor !== null && cursor <= H ? ' is-on' : ''}`}
            style={{ transform: `translateX(${Math.min(cursor ?? 0, H) * colW}px)` }}
          />
        </div>
      </div>
      <div className="ml-legend" aria-hidden="true">
        <span>
          <ActionGlyph a="go" /> go
        </span>
        <span>
          <ActionGlyph a="wait" /> wait
        </span>
        {!plan.inputs.must && (
          <span>
            <ActionGlyph a="skip" /> skip
          </span>
        )}
        <span>
          <span className="ml-legend__now" /> most likely now
        </span>
        {cursor !== null && cursor <= H ? (
          <span className="ml-legend__play">
            <span className="f">t = {cursor}</span>
            {cursor === H ? (
              <>deadline: go or skip only</>
            ) : (
              <>
                <span className="f">
                  V{sub(cursor)}
                </span>{' '}
                from{' '}
                <span className="f">
                  V{sub(cursor + 1)}
                </span>
              </>
            )}
          </span>
        ) : (
          showV && <span className="ml-legend__v">numbers: V</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Bellman backup card */

function BackupCard({ plan, b, pending }: { plan: PlanResponse; b: Backup; pending: boolean }) {
  const i = plan.inputs;
  const H = plan.hours.length - 1;
  const s = b.s;
  const L = CLASS_LETTER[s];
  const clock = b.t === 0 ? 'now' : hhmm(plan.hours[b.t].time);
  const rows: { a: Action; q: number | null; body: ReactNode }[] = [
    {
      a: 'go',
      q: b.qGo,
      body: (
        <span className="ml-expr">
          <Term v={num(i.benefit, 0)} k="benefit" />
          <span className="ml-op">−</span>
          <Term v={num(i.harm[s], 0)} k={`harm ${L}`} />
          <span className="ml-op">×</span>
          <Term v={`${i.duration_min}/60`} k="hours" />
          <span className="ml-op">×</span>
          <Term v={num(i.intensity, 1)} k="intensity" />
          <span className="ml-op">×</span>
          <Term v={num(i.sensitivity, 0)} k="sensitivity" />
        </span>
      ),
    },
    {
      a: 'wait',
      q: b.qWait,
      body:
        b.terms && b.qWait !== null ? (
          <>
            <span className="ml-expr ml-expr--line">
              <span className="num">−{num(i.wait_cost, 2)}</span>
              <span className="ml-op">+</span>
              <span className="f">
                Σ<sub>s′</sub> T{sub(b.t)}[{L}][s′] · V{sub(b.t + 1)}(s′)
              </span>
              <span className="ml-expr__tail">
                <span className="ml-op">=</span>
                <span className="num">−{num(i.wait_cost, 2)}</span>
                <span className="ml-op">+</span>
                <span className="num">{num(b.expectedNext, 3)}</span>
              </span>
            </span>
            <table className="ml-terms">
              <caption className="sr-only">
                The four terms T{b.t}[{L}][s′] · V{b.t + 1}(s′)
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="f">s′</span>
                  </th>
                  <th scope="col" className="f">
                    T{sub(b.t)}[{L}][s′]
                  </th>
                  <th aria-hidden="true" />
                  <th scope="col" className="f">
                    V{sub(b.t + 1)}(s′)
                  </th>
                  <th aria-hidden="true" />
                  <th scope="col">product</th>
                </tr>
              </thead>
              <tbody>
                {b.terms.map((x, s2) => (
                  <tr key={s2} className={x.T < 0.0005 ? 'is-zero' : undefined}>
                    <th scope="row">
                      <Swatch i={s2} />
                      <span className="sr-only">{CLASS_LABEL[s2]}</span>
                    </th>
                    <td className="num">{num(x.T, 3)}</td>
                    <td className="ml-terms__op" aria-hidden="true">
                      ×
                    </td>
                    <td className="num">{num(x.V, 2)}</td>
                    <td className="ml-terms__op" aria-hidden="true">
                      =
                    </td>
                    <td className="num ml-terms__p">{num(x.product, 3)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={5} className="ml-terms__sum">
                    <span className="f">Σ</span>
                  </th>
                  <td className="num ml-terms__p">{num(b.expectedNext, 3)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        ) : (
          <span className="ml-expr ml-muted">not allowed at the deadline, t = {H}</span>
        ),
    },
  ];
  if (!i.must) rows.push({ a: 'skip', q: 0, body: <span className="ml-expr ml-muted">stay in, nothing gained or lost</span> });

  return (
    <section className={`ml-card${pending ? ' is-pending' : ''}`} aria-label="Bellman backup for the selected cell">
      <header className="ml-card__head">
        <span className="ml-card__k">Bellman backup</span>
        <span className="ml-card__cell" data-c={CLASS_IDS[s]}>
          <Swatch i={s} />
          <span>
            {CLASS_LABEL[s]} · {clock} <span className="f">t = {b.t}</span>
          </span>
        </span>
        <span className="ml-card__v" aria-live="polite">
          <span className="f">
            V{sub(b.t)}({L})
          </span>{' '}
          = <span className="f">max Q</span> = <strong className="num">{num(b.value, 2)}</strong>
          <span className={`ml-card__a ml-card__a--${b.action}`}>
            <ActionGlyph a={b.action} /> {b.action}
          </span>
        </span>
      </header>
      <div className="ml-card__rows">
        {rows.map((r) => (
          <div key={r.a} className={`ml-q${r.a === b.action ? ' is-best' : ''}${r.q === null ? ' is-off' : ''}`}>
            <span className="ml-q__a">
              <ActionGlyph a={r.a} />
              <span className="f">
                Q({r.a})
              </span>
            </span>
            <div className="ml-q__body">{r.body}</div>
            <span className="ml-q__v num">{r.q === null ? '—' : num(r.q, 2)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Term({ v, k }: { v: string; k: string }) {
  return (
    <span className="ml-term">
      <span className="num">{v}</span>
      <span className="ml-term__k">{k}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ decision now */

function Decision({ plan }: { plan: PlanResponse }) {
  const d = plan.decision;
  const h0 = plan.hours[0];
  const must = plan.inputs.must;
  const target = [d.q_go, d.q_wait ?? 0, d.q_skip ?? 0];
  const v = useTweenVec(target, 520);
  const lo = Math.min(0, ...v);
  const hi = Math.max(0, ...v);
  const span = hi - lo || 1;
  const x = (q: number) => ((q - lo) / span) * 100;
  const rows: { a: Action; q: number; qs: readonly number[] | null }[] = [
    { a: 'go', q: v[0], qs: h0.q_go },
    { a: 'wait', q: v[1], qs: h0.q_wait },
  ];
  if (!must) rows.push({ a: 'skip', q: v[2], qs: null });
  // check: the belief-weighted values recomputed here agree with the API's decision
  const goCheck = beliefQ(plan.belief_now, h0.q_go);
  return (
    <section className="ml-dec" aria-label="Decision now">
      <header className="ml-dec__head">
        <span className="ml-card__k">Decision now</span>
        <span className="f ml-dec__f">
          Q(b, a) = Σ<sub>s</sub> b[s] · Q<sub>0</sub>(s, a)
        </span>
      </header>
      <div className="ml-dec__b">
        <span className="f">b</span>
        {IDX.map((s) => (
          <span key={s} className="ml-dec__bi">
            <Swatch i={s} />
            <span className="num">{pct(plan.belief_now[s])}</span>
          </span>
        ))}
      </div>
      <div className="ml-dec__bars" style={{ '--zero': `${x(0)}%` } as CSSProperties}>
        {rows.map((r) => {
          const best = r.a === d.action;
          const a = x(Math.min(0, r.q));
          const b = x(Math.max(0, r.q));
          return (
            <div key={r.a} className={`ml-dec__row${best ? ' is-best' : ''}`}>
              <span className="ml-dec__a">
                <ActionGlyph a={r.a} /> {r.a}
              </span>
              <span className="ml-dec__track">
                <span className="ml-dec__bar" style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%` }} />
                <span className="ml-dec__zero" />
              </span>
              <span className="ml-dec__v num">{num(r.q, 2)}</span>
            </div>
          );
        })}
      </div>
      <span className="sr-only">
        {`Belief-weighted values: go ${num(goCheck, 2)}${d.q_wait !== null ? `, wait ${num(d.q_wait, 2)}` : ''}${must ? '' : ', skip 0'}. Best: ${d.action}.`}
      </span>
    </section>
  );
}
