import type { CityMeta, MetaResponse } from '../api/types';
import type { Navigate } from '../lib/route';

/** End of the planner: where the method is explained, who made it, where the data comes from. */
export function About({ city, navigate }: { meta: MetaResponse | null; city: CityMeta | null; navigate: Navigate }) {
  const toDocs = (e: React.MouseEvent<HTMLAnchorElement>, hash?: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate('docs', hash);
  };
  return (
    <section className="q q--about" aria-labelledby="q-about" id="about">
      <a className="docs-card" href="/docs" onClick={(e) => toDocs(e)}>
        <span className="docs-card__k">How it works</span>
        <span className="docs-card__t" id="q-about">
          Step through the Bayes filter, watch backward induction fill the policy, race A* against Dijkstra.
        </span>
        <span className="docs-card__go" aria-hidden="true">
          →
        </span>
      </a>

      <ul className="limits-mini" aria-label="Limits">
        <li>PM2.5 is CAMS model output on a ~40 km grid, not a sensor on your street.</li>
        <li>Street exposure is a traffic proxy from road kinds, not a measurement.</li>
        {city && <li>Routes cover central {city.name}: the dashed outline on the map.</li>}
        <li>Not medical advice.</li>
      </ul>

      <footer className="colophon">
        <p className="colophon__team">
          <span>AIF1303 AI Fundamentals · final project · QAIRU 2026</span>
          <span>
            <a href="https://github.com/tairqaldy">Tair Kaldybayev</a> · <a href="https://github.com/dameo111">Dameli Kalikhanova</a>
          </span>
        </p>
        <p>
          Data: <a href="https://open-meteo.com/">Open-Meteo</a> (CAMS, CC BY 4.0) · ©{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · search by{' '}
          <a href="https://photon.komoot.io/">Photon</a> · tiles by <a href="https://openfreemap.org/">OpenFreeMap</a>.{' '}
          <a href="https://github.com/tairqaldy/tynys">Source code</a> ·{' '}
          <a href="/docs#limits" onClick={(e) => toDocs(e, 'limits')}>
            all assumptions
          </a>
        </p>
      </footer>
    </section>
  );
}
