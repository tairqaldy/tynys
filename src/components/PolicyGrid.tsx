import type { Action, PlanResponse } from '../api/types';
import { CLASS_IDS, CLASS_LABEL, CLASS_LETTER } from '../lib/classes';
import { hhmm, num } from '../lib/format';

export function ActionGlyph({ a }: { a: Action }) {
  // go = filled disc, wait = open ring with a tail, skip = cross. Shape alone tells them apart.
  return (
    <svg className={`glyph glyph--${a}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {a === 'go' && <circle cx="7" cy="7" r="5" />}
      {a === 'wait' && (
        <>
          <circle cx="7" cy="7" r="4.4" fill="none" strokeWidth="1.6" />
          <path d="M7 4.6 V7 H9" fill="none" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {a === 'skip' && <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" fill="none" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

/** Policy: the best action for each (hour, class). A real table so it reads well with a screen reader. */
export function PolicyGrid({ plan }: { plan: PlanResponse }) {
  const rows = [3, 2, 1, 0];
  const best = plan.decision.best_t;
  return (
    <figure className="policy">
      <div className="policy__scroll">
        <table className="policy__table">
          <caption className="sr-only">
            Best action for each class of air (rows) at each hour (columns). Go, wait or skip.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="policy__corner">
                <span className="sr-only">Class</span>
              </th>
              {plan.hours.map((h) => (
                <th key={h.t} scope="col" className={best === h.t ? 'is-best' : undefined}>
                  <span className="num">{h.t === 0 ? 'now' : hhmm(h.time).slice(0, 2)}</span>
                  <span className="sr-only"> {hhmm(h.time)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s} data-c={CLASS_IDS[s]}>
                <th scope="row">
                  <span className="policy__rowlabel">
                    <span className="policy__sq" aria-hidden="true">
                      {CLASS_LETTER[s]}
                    </span>
                    <span className="policy__name">{CLASS_LABEL[s]}</span>
                  </span>
                </th>
                {plan.hours.map((h) => {
                  const a = h.policy[s];
                  const isNow = h.t === 0 && s === plan.state_now;
                  return (
                    <td
                      key={h.t}
                      className={`cell cell--${a}${isNow ? ' is-now' : ''}`}
                      title={`${CLASS_LABEL[s]}, ${hhmm(h.time)}: ${a} (V = ${num(h.value[s], 2)})`}
                    >
                      <ActionGlyph a={a} />
                      <span className="sr-only">{a}{isNow ? ' (most likely class now)' : ''}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="policy__foot">
                Reading / forecast
              </th>
              {plan.hours.map((h) => {
                const fromReading = (h.band_source ?? (h.t === 0 ? 'reading' : 'forecast')) === 'reading';
                return (
                  <td
                    key={h.t}
                    className={`policy__fc${fromReading ? ' is-reading' : ''}`}
                    data-c={CLASS_IDS[h.forecast_band]}
                    title={fromReading ? 'Class of the latest model reading' : 'Class of the forecast value'}
                  >
                    <span aria-hidden="true">{CLASS_LETTER[h.forecast_band]}{fromReading ? <sup>R</sup> : null}</span>
                    <span className="sr-only">
                      {CLASS_LABEL[h.forecast_band]} ({fromReading ? 'reading' : 'forecast'})
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <figcaption className="policy__legend">
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
          <span className="legend-now" aria-hidden="true" /> most likely class now
        </span>
        <span className="policy__legend-note">
          The best action for every class and hour. Bottom row: the class fed in — the reading now (R), then the forecast.
        </span>
      </figcaption>
    </figure>
  );
}
