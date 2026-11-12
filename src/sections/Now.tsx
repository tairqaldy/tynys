import type { AirResponse } from '../api/types';
import { BeliefBars } from '../components/BeliefBars';
import { Assumption, ErrorState, LoadingNote, QuestionHead, Skeleton } from '../components/common';
import { Slider } from '../components/controls';
import { PredictedBelief } from '../components/PredictedBelief';
import { Strip24 } from '../components/Strip24';
import { hhmm, num } from '../lib/format';
import type { RequestState } from '../lib/hooks';

interface Props {
  req: RequestState<AirResponse>;
  air: AirResponse | null;
  cityName: string;
  reliability: number;
  setReliability: (v: number) => void;
}

export function Now({ req, air, reliability, setReliability }: Props) {
  const updating = req.loading && air !== null;
  return (
    <section className="q" aria-labelledby="q-now" id="now">
      <QuestionHead n={1} id="q-now" kicker="Hidden Markov model" title="How is the air right now?" />

      {!air && req.loading && (
        <>
          <LoadingNote what="the air model" />
          <Skeleton hero lines={2} chart={140} />
        </>
      )}
      {!air && req.error && (
        <ErrorState title="The air model did not answer." message={req.error.message} onRetry={req.retry} />
      )}

      {air && (
        <div className={`q-body${updating ? ' is-updating' : ''}`} aria-busy={updating}>
          <BeliefBars
            belief={air.hmm.belief_now}
            caption={`Belief at ${hhmm(air.now)}, after the latest reading`}
          />

          {req.error && (
            <p className="inline-error" role="alert">
              Could not update: {req.error.message}{' '}
              <button type="button" className="link-btn" onClick={req.retry}>
                Try again
              </button>
            </p>
          )}

          <h3 className="sub">The last 24 hours</h3>
          <Strip24 readings={air.readings} filtered={air.hmm.filtered} />

          <h3 className="sub">The next {air.hmm.predicted.length} hours</h3>
          <PredictedBelief predicted={air.hmm.predicted} />

          <div className="control-block">
            <Slider
              label="How much do you trust the grid value for your street?"
              value={reliability}
              min={0.55}
              max={0.95}
              step={0.05}
              onChange={setReliability}
              display={`r = ${num(reliability, 2)}`}
              valueText={`${Math.round(reliability * 100)} percent`}
              ends={['it often differs', 'it is usually right']}
              hint={<Assumption>r = chance the city-wide class matches your street. Lower it to lean on the time-of-day pattern.</Assumption>}
            />
          </div>
        </div>
      )}
    </section>
  );
}
