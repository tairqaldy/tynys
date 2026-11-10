import type { AirResponse } from '../api/types';
import { BeliefBars } from '../components/BeliefBars';
import { Assumption, ClassChip, ErrorState, LoadingNote, QuestionHead, Skeleton } from '../components/common';
import { Slider } from '../components/controls';
import { PredictedBelief } from '../components/PredictedBelief';
import { Strip24 } from '../components/Strip24';
import { CLASS_LABEL, CLASS_RANGE } from '../lib/classes';
import { nowSentence } from '../lib/copy';
import { hhmm, num } from '../lib/format';
import type { RequestState } from '../lib/hooks';

interface Props {
  req: RequestState<AirResponse>;
  air: AirResponse | null;
  cityName: string;
  reliability: number;
  setReliability: (v: number) => void;
}

export function Now({ req, air, cityName, reliability, setReliability }: Props) {
  const updating = req.loading && air !== null;
  return (
    <section className="q" aria-labelledby="q-now" id="now">
      <QuestionHead n={1} id="q-now" kicker="Hidden Markov model · filtering and Viterbi" title="How is the air right now?" />

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
          <NowHero air={air} cityName={cityName} />

          <BeliefBars
            belief={air.hmm.belief_now}
            caption={`What the model believes about the air where you are at ${hhmm(air.now)}, after the last reading`}
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
              hint={
                <Assumption>
                  r is the chance that the class of the city-wide model value matches the air where you are. It is a
                  setting, not estimated from data. Lower it and the model leans more on what usually happens at this
                  time of day than on the latest reading.
                </Assumption>
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}

function NowHero({ air, cityName }: { air: AirResponse; cityName: string }) {
  const s = nowSentence(cityName, air.hmm.belief_now);
  const c = air.current;
  return (
    <div className="hero">
      <p className="hero__sentence">
        {s.lead}
        <em className="hero__word">{s.word}</em>
        {s.tail}
      </p>
      {s.hedge && <p className="hero__hedge">{s.hedge}</p>}
      <p className="hero__reading">
        <span className="hero__reading-k">Model reading at {hhmm(air.now)}</span>
        <span className="num hero__pm">
          {num(c.pm25, 1)} <span className="unit">µg/m³ PM2.5</span>
        </span>
        <span className="hero__band">
          <ClassChip i={c.band} /> {CLASS_LABEL[c.band].toLowerCase()} band, {CLASS_RANGE[c.band]}
        </span>
        <span className="hero__extra">
          {c.pm10 !== null && Number.isFinite(c.pm10) && (
            <>
              PM10 <span className="num">{num(c.pm10, 1)}</span>
            </>
          )}
          {air.weather && (
            <>
              {c.pm10 !== null && Number.isFinite(c.pm10) ? ' · ' : ''}wind <span className="num">{num(air.weather.wind_kmh, 0)}</span> km/h{' · '}
              <span className="num">{num(air.weather.temp_c, 0)}</span> °C
            </>
          )}
        </span>
      </p>
      <p className="hero__note">
        A value from the CAMS atmospheric model for a grid cell about 40 km across — not a sensor on your street.
      </p>
    </div>
  );
}
