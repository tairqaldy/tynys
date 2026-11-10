import { Fragment, type ReactNode } from 'react';
import type { PlanResponse } from '../api/types';
import { CLASS_IDS, CLASS_LABEL, CLASS_LETTER, IDX } from '../lib/classes';
import { hhmm, num } from '../lib/format';
import { Matrix } from './Matrix';

interface Row {
  op: string;
  expr: ReactNode;
  note?: ReactNode;
}

/** A worked sum set as aligned lines: left-hand side, then one term per line under an aligned "=" / "+". */
function Derivation({ lhs, rows, label }: { lhs: ReactNode; rows: Row[]; label: string }) {
  return (
    <div className="deriv" role="group" aria-label={label}>
      {rows.map((r, k) => (
        <Fragment key={k}>
          <span className="deriv__lhs">{k === 0 ? lhs : ''}</span>
          <span className="deriv__op">{r.op}</span>
          <span className="deriv__expr">{r.expr}</span>
          <span className="deriv__note">{r.note}</span>
        </Fragment>
      ))}
    </div>
  );
}

const product = (a: number, b: number, da = 3, db = 2) => (
  <>
    <span className="num">{num(a, da)}</span>
    <span className="op-inline">×</span>
    <span className="num">{num(b, db)}</span>
  </>
);

/** One product per class: a[s] × b[s], the first under "=" or "+" as given. */
function termRows(a: readonly number[], b: readonly number[], firstOp: string, noteFor: (s: number) => ReactNode): Row[] {
  return a.map((x, s) => ({ op: s === 0 ? firstOp : '+', expr: product(x, b[s]), note: noteFor(s) }));
}

export function MathMdp({ plan }: { plan: PlanResponse }) {
  const i = plan.inputs;
  const h0 = plan.hours[0];
  const bm = plan.decision.bellman;
  const d = plan.decision;
  const b = plan.belief_now;
  const hours = i.duration_min / 60;
  const H = i.deadline_hours;
  const qWait0 = h0.q_wait;
  return (
    <div className="math">
      <p>
        Each hour <span className="f">t = 0 … {H}</span> you can <strong>go</strong> (and the problem ends),{' '}
        <strong>wait</strong> an hour{i.must ? '' : <>, or <strong>skip</strong> it for today</>}. The state is the hour and
        the class of air, <span className="f">(t, s)</span>. Because the horizon is finite, the problem is solved exactly by{' '}
        <strong>backward induction</strong>: start at the last hour, where waiting is no longer allowed, and work back to
        now using the Bellman equation.
      </p>

      <h4>1 · Rewards for going</h4>
      <p>
        <span className="f">R<sub>go</sub>(s) = benefit − harm[s] · (duration / 60) · intensity · sensitivity</span>
        {i.must ? '. An errand has no skip.' : <>; skipping is worth 0.</>}
      </p>
      <div className="table-wrap">
        <table className="mtable">
          <caption className="sr-only">Reward for going in each class</caption>
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col" className="r">harm</th>
              <th scope="col">calculation</th>
              <th scope="col" className="r">
                <span className="f">R<sub>go</sub></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {IDX.map((s) => (
              <tr key={s} className={s === plan.state_now ? 'is-hi' : undefined}>
                <th scope="row">
                  <span className="mini-sq" data-c={CLASS_IDS[s]} aria-hidden="true">
                    {CLASS_LETTER[s]}
                  </span>{' '}
                  <span className="cls-name">{CLASS_LABEL[s]}</span>
                </th>
                <td className="r num">{num(i.harm[s], 0)}</td>
                <td className="num calc">
                  {num(i.benefit, 0)} − {num(i.harm[s], 0)} × {num(hours, 2)} × {num(i.intensity, 1)} × {num(i.sensitivity, 0)}
                </td>
                <td className="r num strong">{num(plan.reward_go[s], 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fineprint">
        Duration {i.duration_min} min, intensity {num(i.intensity, 1)}
        {i.activity === 'run' ? ' (running breathes about 2.5× more air: 3.0 vs 1.2 m³/h)' : ''}, sensitivity{' '}
        {num(i.sensitivity, 0)}, waiting costs <span className="num">{num(i.wait_cost, 2)}</span> per hour.
      </p>

      <h4>2 · How the air moves while you wait</h4>
      <p>
        <span className="f">T<sub>t</sub>[s][s′] ∝ A<sub>b(t)</sub>[s][s′] · B(r<sub>f</sub>(t+1))[s′][f<sub>t+1</sub>]</span>:
        the HMM's transition for this time of day, re-weighted by how well each next class explains the next forecast
        value, each row normalised. For now (<span className="num">{hhmm(h0.time)}</span>):
      </p>
      {h0.transition ? (
        <Matrix
          m={h0.transition}
          digits={3}
          highlightRow={bm?.state}
          caption={`Transition while waiting, from ${hhmm(h0.time)}`}
          name={
            <span className="f">
              T<sub>0</sub>
            </span>
          }
          colTitle="next hour →"
          rowTitle="↑ now"
        />
      ) : null}

      <h4>3 · One Bellman backup, worked through</h4>
      <p>
        <span className="f">
          Q<sub>t</sub>(s, wait) = −wait_cost + Σ<sub>s′</sub> T<sub>t</sub>[s][s′] · V<sub>t+1</sub>(s′)
        </span>
        ,{' '}
        <span className="f">
          V<sub>t</sub>(s) = max<sub>a</sub> Q<sub>t</sub>(s, a)
        </span>
        . Ties prefer go, then wait, then skip.
      </p>
      {bm ? (
        <div className="worked">
          <Derivation
            label={`Bellman backup for waiting in class ${CLASS_LABEL[bm.state]}`}
            lhs={
              <span className="f">
                Q<sub>0</sub>({CLASS_LETTER[bm.state]}, wait)
              </span>
            }
            rows={[
              { op: '=', expr: <>−<span className="num">{num(bm.wait_cost, 2)}</span></>, note: 'cost of waiting' },
              ...termRows(bm.transition_row, bm.next_values, '+', (s) => (
                <span className="f">
                  T[{CLASS_LETTER[bm.state]}][{CLASS_LETTER[s]}] · V<sub>1</sub>({CLASS_LETTER[s]})
                </span>
              )),
              {
                op: '=',
                expr: (
                  <>
                    −<span className="num">{num(bm.wait_cost, 2)}</span> + <span className="num">{num(bm.expected_next, 3)}</span>
                  </>
                ),
              },
              { op: '=', expr: <strong className="num">{num(bm.q_wait, 2)}</strong> },
            ]}
          />
          <p className="worked__line">
            <span className="f">
              Q<sub>0</sub>({CLASS_LETTER[bm.state]}, go)
            </span>{' '}
            = <span className="f">R<sub>go</sub>({CLASS_LETTER[bm.state]})</span> ={' '}
            <strong className="num">{num(bm.q_go, 2)}</strong>
            {!i.must && (
              <>
                {'  ·  '}
                <span className="f">
                  Q<sub>0</sub>({CLASS_LETTER[bm.state]}, skip)
                </span>{' '}
                = <strong className="num">0</strong>
              </>
            )}
          </p>
          <p className="worked__note">
            Here <span className="f">s = {CLASS_LETTER[bm.state]}</span> ({CLASS_LABEL[bm.state].toLowerCase()}), the most
            likely class now. The second numbers in each product are{' '}
            <span className="f">
              V<sub>1</sub>
            </span>{' '}
            for L, M, E, H — already computed, because the solver works backwards from hour {H}. If the air were surely{' '}
            {CLASS_LABEL[bm.state].toLowerCase()}, the plan would <strong>{h0.policy[bm.state]}</strong>.
          </p>
        </div>
      ) : (
        <p>With a one-hour horizon there is nothing to wait for.</p>
      )}

      <h4>4 · Acting when the class is uncertain (QMDP)</h4>
      <p>
        The class now is not known for sure, so each action is scored by its value averaged over the belief:{' '}
        <span className="f">
          Q(b, a) = Σ<sub>s</sub> b[s] · Q<sub>0</sub>(s, a)
        </span>
        .
      </p>
      <div className="worked">
        <Derivation
          label="Belief-weighted value of going now"
          lhs={<span className="f">Q(b, go)</span>}
          rows={[
            ...termRows(b, h0.q_go, '=', (s) => (
              <span className="f">
                b[{CLASS_LETTER[s]}] · Q<sub>0</sub>({CLASS_LETTER[s]}, go)
              </span>
            )),
            { op: '=', expr: <strong className="num">{num(d.q_go, 2)}</strong> },
          ]}
        />
        {qWait0 && (
          <Derivation
            label="Belief-weighted value of waiting"
            lhs={<span className="f">Q(b, wait)</span>}
            rows={[
              ...termRows(b, qWait0, '=', (s) => (
                <span className="f">
                  b[{CLASS_LETTER[s]}] · Q<sub>0</sub>({CLASS_LETTER[s]}, wait)
                </span>
              )),
              { op: '=', expr: <strong className="num">{num(d.q_wait, 2)}</strong> },
            ]}
          />
        )}
        {!i.must && (
          <p className="worked__line">
            <span className="f">Q(b, skip)</span> = <strong className="num">{num(d.q_skip ?? 0, 2)}</strong>
          </p>
        )}
        <p className="worked__note">
          The largest wins: <strong>{d.action}</strong>. Limitation: QMDP assumes that from the next hour on you will know
          the class exactly. Going now ends the problem, so its value is exact; the value of waiting is optimistic (an
          upper bound), which can tip close calls towards waiting.
        </p>
      </div>

      <h4>5 · When will you probably go?</h4>
      <p>
        Starting from the belief, push the class distribution forward hour by hour under the policy: the share that lands in
        a “go” cell goes then, the share in a “skip” cell stops, the rest keeps waiting and moves with{' '}
        <span className="f">T<sub>t</sub></span>. The median hour is the first at which the running total reaches 50%
        {d.best_time ? (
          <>
            {' '}
            — here <strong className="num">{hhmm(d.best_time)}</strong>.
          </>
        ) : (
          <> — here it never does within {H} h.</>
        )}{' '}
        This distribution uses only the next forecast at each step, so it differs a little from the HMM's own prediction
        in question 1; the two are not meant to be compared.
      </p>

      <h4>Assumptions</h4>
      <ul className="assumptions">
        <li>Harm per hour [{i.harm.join(', ')}], the benefits and the waiting cost are utility points chosen by hand.</li>
        <li>Sensitivity doubles harm for a child, asthma or old age; it is not a medical estimate.</li>
        <li>The QMDP action rule (uncertainty assumed to vanish after one step).</li>
        <li>Forecast trust falls with lead time as in the HMM.</li>
      </ul>
    </div>
  );
}
