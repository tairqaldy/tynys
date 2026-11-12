import type { ActivityId, ActivityMeta, PlanResponse } from '../api/types';
import { Assumption, ErrorState, LoadingNote, QuestionHead, Skeleton } from '../components/common';
import { Chips, Slider, Switch } from '../components/controls';
import { PGoBars } from '../components/PGoBars';
import { PolicyGrid } from '../components/PolicyGrid';
import { decisionSentence, planReason } from '../lib/copy';
import { hhmm, num } from '../lib/format';
import type { RequestState } from '../lib/hooks';
import { useTweenVec } from '../lib/motion';

export interface PlanControls {
  activity: ActivityId;
  duration: number;
  deadline: number;
  waitCost: number;
  sensitive: boolean;
}

interface Props {
  req: RequestState<PlanResponse>;
  plan: PlanResponse | null;
  activities: ActivityMeta[];
  controls: PlanControls;
  setControls: (patch: Partial<PlanControls>) => void;
}

const NOTES: Partial<Record<ActivityId, string>> = {
  run: 'breathes ~2.5× more air',
  kids: 'counts as sensitive',
  errand: 'cannot be skipped',
};

function addHours(t: string, h: number): string {
  const hh = (Number(t.slice(11, 13)) + h) % 24;
  return `${String(hh).padStart(2, '0')}:00`;
}

export function When({ req, plan, activities, controls, setControls }: Props) {
  const updating = req.loading && plan !== null;
  const act = activities.find((a) => a.id === controls.activity);
  const forcedSensitive = controls.activity === 'kids';
  return (
    <section className="q" aria-labelledby="q-when" id="when">
      <QuestionHead n={2} id="q-when" kicker="Markov decision process" title="When should I go out?" />

      <form className="plan-controls" onSubmit={(e) => e.preventDefault()} aria-label="Plan settings">
        <Chips
          legend="What are you going out for?"
          name="activity"
          value={controls.activity}
          options={activities.map((a) => ({ value: a.id, label: a.label, note: NOTES[a.id] }))}
          onChange={(v) => {
            const a = activities.find((x) => x.id === v);
            setControls({ activity: v, duration: a?.duration_min ?? controls.duration });
          }}
        />
        <div className="plan-controls__grid">
          <Slider
            label="For how long?"
            value={controls.duration}
            min={10}
            max={180}
            step={5}
            onChange={(v) => setControls({ duration: v })}
            display={`${controls.duration} min`}
            valueText={`${controls.duration} minutes`}
          />
          <Slider
            label="Within how many hours?"
            value={controls.deadline}
            min={1}
            max={12}
            step={1}
            onChange={(v) => setControls({ deadline: v })}
            display={plan ? `${controls.deadline} h · by ${addHours(plan.now, controls.deadline)}` : `${controls.deadline} h`}
            valueText={`${controls.deadline} hours`}
          />
          <Slider
            label="How much does waiting bother you?"
            value={controls.waitCost}
            min={0.1}
            max={1}
            step={0.1}
            onChange={(v) => setControls({ waitCost: Math.round(v * 10) / 10 })}
            display={`${num(controls.waitCost, 1)} / h`}
            valueText={`${num(controls.waitCost, 1)} points per hour`}
            ends={['flexible', 'in a hurry']}
          />
          <Switch
            label="Sensitive (child, asthma, elderly)"
            checked={controls.sensitive || forcedSensitive}
            disabled={forcedSensitive}
            onChange={(v) => setControls({ sensitive: v })}
            hint={forcedSensitive ? 'Always on when you are outside with a child.' : 'Doubles the harm of polluted air.'}
          />
        </div>
      </form>

      {!plan && req.loading && (
        <>
          <LoadingNote what="the plan" />
          <Skeleton hero lines={2} chart={120} />
        </>
      )}
      {!plan && req.error && <ErrorState title="The planner did not answer." message={req.error.message} onRetry={req.retry} />}

      {plan && (
        <div className={`q-body${updating ? ' is-updating' : ''}`} aria-busy={updating}>
          <Decision plan={plan} />
          {req.error && (
            <p className="inline-error" role="alert">
              Could not update: {req.error.message}{' '}
              <button type="button" className="link-btn" onClick={req.retry}>
                Try again
              </button>
            </p>
          )}
          <h3 className="sub">When you would probably go</h3>
          <PGoBars plan={plan} />
          <h3 className="sub">The plan for every case</h3>
          <PolicyGrid plan={plan} />
          <p className="fineprint">
            <Assumption>
              Benefit {num(plan.inputs.benefit, 0)} for {act?.label.toLowerCase() ?? 'the activity'}, harm per hour{' '}
              {plan.inputs.harm.join(' / ')} (low → high), waiting {num(plan.inputs.wait_cost, 1)} per hour: utility points set by hand.
            </Assumption>
          </p>
        </div>
      )}
    </section>
  );
}

function Decision({ plan }: { plan: PlanResponse }) {
  const d = decisionSentence(plan);
  const a = plan.decision;
  const rows: { label: string; v: number; win: boolean }[] = [
    { label: 'Go now', v: a.q_go, win: a.action === 'go' },
    { label: 'Wait an hour', v: a.q_wait, win: a.action === 'wait' },
  ];
  if (!plan.inputs.must) rows.push({ label: 'Skip', v: a.q_skip ?? 0, win: a.action === 'skip' });
  return (
    <div className="decision" aria-live="polite">
      <p className={`decision__head decision__head--${a.action}`}>{d.head}</p>
      <p className="decision__sub">{d.sub}</p>
      <QBars rows={rows} />
      <details className="why">
        <summary>Why</summary>
        <p>{planReason(plan)}</p>
        <p className="fineprint">
          Checked at {hhmm(plan.now)} for the next {plan.inputs.deadline_hours} h. Points are utility units set by hand.
        </p>
      </details>
    </div>
  );
}

/** Belief-weighted value of each action now, as bars from a shared zero. */
function QBars({ rows }: { rows: { label: string; v: number; win: boolean }[] }) {
  const vals = useTweenVec(rows.map((r) => r.v), 600);
  const lo = Math.min(0, ...rows.map((r) => r.v));
  const hi = Math.max(0, ...rows.map((r) => r.v));
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100;
  return (
    <div className="qbars" role="list" aria-label="Value of each action now, weighted by the belief">
      {rows.map((r, i) => {
        const v = vals[i] ?? r.v;
        const x0 = Math.min(zero, ((v - lo) / span) * 100);
        const w = Math.abs(((v - lo) / span) * 100 - zero);
        return (
          <div key={r.label} className={`qbar${r.win ? ' is-win' : ''}`} role="listitem">
            <span className="qbar__label">{r.label}</span>
            <span className="qbar__track">
              <span className="qbar__zero" style={{ left: `${zero}%` }} />
              <span className="qbar__fill" style={{ left: `${x0}%`, width: `${w}%` }} />
            </span>
            <span className="qbar__v num">{num(v, 2)}</span>
            {r.win && <span className="sr-only"> (best)</span>}
          </div>
        );
      })}
    </div>
  );
}
