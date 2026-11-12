import type { AirResponse, PlanResponse } from '../api/types';
import { CLASS_IDS, CLASS_LABEL } from '../lib/classes';
import { pct, relTime } from '../lib/format';
import { useInView } from '../lib/motion';

/**
 * The three algorithms as one pipeline: what goes in, what each one hands to the next,
 * and what it answered just now (live values when the API has answered).
 */
export function Flow({ air, plan }: { air: AirResponse | null; plan: PlanResponse | null }) {
  const [ref, seen] = useInView<HTMLOListElement>('0px');
  const k = air ? air.hmm.state_now : null;
  const hmmOut = air && k !== null ? `${CLASS_LABEL[k]} · ${pct(air.hmm.belief_now[k])}` : '…';
  const d = plan?.decision;
  const mdpOut = !plan || !d ? '…' : d.action === 'go' ? 'Go now' : d.action === 'skip' ? 'Skip today' : d.best_time ? `Wait · ${relTime(d.best_time, plan.now)}` : 'Wait';

  return (
    <ol ref={ref} className={`flow${seen ? ' is-in' : ''}`} aria-label="How the three algorithms connect">
      <li className="flow__node" style={{ ['--i' as string]: 0 }}>
        <span className="flow__src">Open-Meteo · hourly PM2.5</span>
        <span className="flow__n">1</span>
        <span className="flow__name">Hidden Markov model</span>
        <span className="flow__does">reads a noisy 40 km model value as a belief over four classes</span>
        <span className="flow__out" data-c={k !== null ? CLASS_IDS[k] : undefined}>
          <span className="flow__out-k">now</span> {hmmOut}
        </span>
      </li>
      <li className="flow__link" aria-hidden="true" style={{ ['--i' as string]: 1 }}>
        <span className="flow__wire" />
        <span className="flow__label">belief + transition tables</span>
      </li>
      <li className="flow__node" style={{ ['--i' as string]: 2 }}>
        <span className="flow__src">your activity, deadline, patience</span>
        <span className="flow__n">2</span>
        <span className="flow__name">Markov decision process</span>
        <span className="flow__does">weighs going now against waiting for cleaner air, hour by hour</span>
        <span className="flow__out">
          <span className="flow__out-k">answer</span> {mdpOut}
        </span>
      </li>
      <li className="flow__link" aria-hidden="true" style={{ ['--i' as string]: 3 }}>
        <span className="flow__wire" />
        <span className="flow__label">the hour to go + PM2.5 then</span>
      </li>
      <li className="flow__node" style={{ ['--i' as string]: 4 }}>
        <span className="flow__src">OpenStreetMap · street graph</span>
        <span className="flow__n">3</span>
        <span className="flow__name">A* search</span>
        <span className="flow__does">finds the shortest walk and the one along quieter streets</span>
        <span className="flow__out">
          <span className="flow__out-k">avg of 60 trips</span> −20% exposure
        </span>
      </li>
    </ol>
  );
}
