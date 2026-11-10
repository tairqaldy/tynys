import { useState } from 'react';
import type { AirResponse, BlockId } from '../api/types';
import { Segmented } from '../components/controls';
import { CLASS_LABEL, CLASS_LETTER } from '../lib/classes';
import { hhmm, hourOf, num, pct } from '../lib/format';
import { Matrix, Vec, VecLabels } from './Matrix';

const BLOCKS: { id: BlockId; hours: string }[] = [
  { id: 'night', hours: '00–05' },
  { id: 'morning', hours: '06–11' },
  { id: 'day', hours: '12–17' },
  { id: 'evening', hours: '18–23' },
];
const blockOfHour = (h: number): BlockId => BLOCKS[Math.floor(h / 6)].id;

export function MathHmm({ air }: { air: AirResponse }) {
  const h = air.hmm;
  const [mode, setMode] = useState<'p' | 'n'>('p');
  const step = h.bayes_step;
  const usedBlock = blockOfHour((hourOf(step.time) + 23) % 24);
  const o = step.obs;
  return (
    <div className="math">
      <p>
        The <strong>hidden state</strong> is the true class of air where you are; the <strong>reading</strong> is the class
        of the model value for the whole grid cell. The model keeps a <em>belief</em> — four probabilities — and updates it
        every hour with Bayes' rule: first predict how the air usually changes at this time of day, then weigh that
        prediction by how well each class explains the new reading.
      </p>

      <h4>1 · What it learned from {h.history_hours.toLocaleString('en-US')} hours of history</h4>
      <p>
        Prior <span className="f">π</span> = band frequencies with add-one smoothing:{' '}
        <span className="num">({h.prior.map((x) => num(x, 3)).join(', ')})</span>. Representative PM2.5 per class (median of
        history hours in that band): <span className="num">{h.rep_pm25.map((x) => num(x, 1)).join(' / ')}</span> µg/m³.
      </p>
      <p>
        Transitions <span className="f">A<sub>b</sub>[i][j] = (N<sub>b</sub>[i][j] + 1) / (Σ<sub>j</sub> N<sub>b</sub>[i][j] + 4)</span>,
        one matrix per time-of-day block of the hour the change starts in. Rows are “from”, columns “to”; each row sums
        to 1. A row with fewer than 20 counted changes falls back to the pooled all-day row (marked †).
      </p>
      <Segmented
        label="Show transition probabilities or raw counts"
        name="hmm-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'p', label: 'Probabilities' },
          { value: 'n', label: 'Raw counts' },
        ]}
      />
      <div className="mx-grid">
        {BLOCKS.map((b) => {
          const marked = new Set(h.backed_off.filter((x) => x.block === b.id).map((x) => x.row as number));
          return (
            <Matrix
              key={b.id}
              m={mode === 'p' ? h.transitions[b.id] : h.transition_counts[b.id]}
              integer={mode === 'n'}
              digits={3}
              marked={mode === 'p' ? marked : undefined}
              caption={`${mode === 'p' ? 'Transition probabilities' : 'Transition counts'}, ${b.id} ${b.hours}`}
              name={
                <>
                  <span className="f">
                    {mode === 'p' ? 'A' : 'N'}
                    <sub>{b.id}</sub>
                  </span>{' '}
                  <span className="mx__hours num">{b.hours}</span>
                  {b.id === usedBlock && <span className="mx__used">used in step 3</span>}
                </>
              }
            />
          );
        })}
        {mode === 'n' && (
          <Matrix
            m={h.transition_counts.all}
            integer
            caption="Pooled all-day transition counts"
            name={
              <>
                <span className="f">
                  N<sub>all</sub>
                </span>{' '}
                <span className="mx__hours">pooled</span>
              </>
            }
          />
        )}
      </div>
      {h.backed_off.length > 0 ? (
        <ul className="footnotes">
          {h.backed_off.map((b) => (
            <li key={`${b.block}-${b.row}`}>
              † {b.block}, from {CLASS_LABEL[b.row].toLowerCase()}: only <span className="num">{b.count}</span> changes
              counted, so this row uses the pooled all-day counts.
            </li>
          ))}
        </ul>
      ) : (
        <p className="footnotes">No row needed to back off: every row had at least 20 counted changes.</p>
      )}

      <h4>2 · How much a reading is trusted</h4>
      <p>
        Emission <span className="f">B(r)[i][j] = P(reading j | true class i)</span>: <span className="num">r = {num(h.reliability, 2)}</span>{' '}
        on the diagonal, the rest split between the neighbouring classes, zero elsewhere — a reading can be off by at most
        one class.
      </p>
      <Matrix
        m={h.emission}
        digits={3}
        caption="Emission matrix B(r): rows true class, columns reading"
        name={
          <span className="f">
            B(<span className="num">{num(h.reliability, 2)}</span>)
          </span>
        }
        colTitle="reading →"
        rowTitle="↑ true class"
      />

      <h4>3 · The last update, at {hhmm(step.time)}, as one Bayes step</h4>
      <p>
        The reading at {hhmm(step.time)} was <strong>{CLASS_LABEL[o].toLowerCase()}</strong> ({CLASS_LETTER[o]}). The
        prediction comes from the belief an hour earlier pushed through <span className="f">A<sub>{usedBlock}</sub></span>;
        the likelihood is column {CLASS_LETTER[o]} of <span className="f">B</span>.
      </p>
      <div className="bayes" role="group" aria-label={`Bayes step at ${hhmm(step.time)}`}>
        <VecLabels />
        <Vec v={step.predicted} name={<>prior<br /><span className="f">A<sup>⊤</sup>α<sub>t−1</sub></span></>} />
        <span className="op" aria-hidden="true">×</span>
        <Vec v={step.likelihood} name={<>likelihood<br /><span className="f">B[:, {CLASS_LETTER[o]}]</span></>} hi={o} />
        <span className="op" aria-hidden="true">=</span>
        <Vec v={step.unnormalised} digits={4} name={<>product<br />&nbsp;</>} />
        <span className="op op--div" aria-hidden="true">
          ÷ <span className="num">{num(step.evidence, 4)}</span>
        </span>
        <Vec v={step.posterior} name={<>posterior<br /><span className="f">α<sub>t</sub></span></>} hi={h.state_now} />
      </div>
      <p className="sr-only">
        Prior {step.predicted.map((x, i) => `${CLASS_LABEL[i]} ${num(x, 3)}`).join(', ')}. Likelihood{' '}
        {step.likelihood.map((x, i) => `${CLASS_LABEL[i]} ${num(x, 3)}`).join(', ')}. Products{' '}
        {step.unnormalised.map((x, i) => `${CLASS_LABEL[i]} ${num(x, 4)}`).join(', ')}. Divided by the evidence{' '}
        {num(step.evidence, 4)} gives the posterior {step.posterior.map((x, i) => `${CLASS_LABEL[i]} ${num(x, 3)}`).join(', ')}.
      </p>
      <p>
        The divisor <span className="num">{num(step.evidence, 4)}</span> is the evidence, <span className="f">P(reading = {CLASS_LETTER[o]})</span> —
        the sum of the products. Dividing by it makes the posterior sum to 1. This step is the forward filter{' '}
        <span className="f">α<sub>t</sub> ∝ B[:, o<sub>t</sub>] ⊙ (A<sub>b(t−1)</sub><sup>⊤</sup> α<sub>t−1</sub>)</span>,
        repeated over the last {h.filtered.length} readings.
      </p>

      <h4>4 · The most likely history (Viterbi)</h4>
      <p>
        Filtering answers “what is the class now?”. Viterbi answers a different question — “which single sequence of
        classes best explains all {h.filtered.length} readings?” — by dynamic programming in log space (zeros in{' '}
        <span className="f">B</span> become −∞ and simply rule a path out). That sequence is the Viterbi row under the
        24-hour strip.
      </p>
      <p>
        Over the history, the filter's most likely class equalled the reading's own class{' '}
        <strong className="num">{pct(h.agreement)}</strong> of the time. That is high on purpose: with{' '}
        <span className="num">r = {num(h.reliability, 2)}</span> the filter mostly follows the readings and only smooths out
        isolated one-hour jumps.
      </p>

      <h4>5 · Looking ahead</h4>
      <p>
        For each future hour <span className="f">k</span>, predict with the transition matrix, then weigh by the forecast
        value's class as a weaker reading: <span className="f">r<sub>f</sub>(k) = max(0.5, 0.75 − 0.005·k)</span>. The
        expected concentration is <span className="f">E[pm]<sub>k</sub> = Σ<sub>s</sub> belief<sub>k</sub>[s] · rep[s]</span>; it
        is used later to score the routes.
      </p>

      <h4>Assumptions</h4>
      <ul className="assumptions">
        <li>The class cut-points 5 / 15 / 25 µg/m³ come from WHO daily and annual guidelines; WHO has no hourly guideline.</li>
        <li>
          The reading trust <span className="num">r</span> and the forecast trust <span className="f">r<sub>f</sub>(k)</span> are
          settings, not estimated from data.
        </li>
        <li>Transitions are learned from model readings: the reading's class stands in for the hidden class.</li>
        <li>The air's next hour depends only on this hour and the time of day (the Markov assumption).</li>
      </ul>
    </div>
  );
}
