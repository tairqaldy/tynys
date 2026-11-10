import type { CityMeta, MetaResponse } from '../api/types';
import { QuestionHead } from '../components/common';
import { num } from '../lib/format';

export function About({ meta, city }: { meta: MetaResponse | null; city: CityMeta | null }) {
  return (
    <section className="q q--about" aria-labelledby="q-about" id="about">
      <QuestionHead n="i" id="q-about" kicker="Sources, assumptions, limits" title="About Tynys" />
      <p className="lede">
        <em>Tynys</em> (тыныс) means “breath” in Kazakh. It is a student project that puts three classic AI algorithms to
        work on one everyday question: when and where to breathe a little easier in Astana and Almaty.
      </p>

      <div className="about-grid">
        <div>
          <h3 className="sub">Limits</h3>
          <ul className="plain">
            <li>
              The PM2.5 values are <strong>model output, not measurements</strong>: the CAMS global atmospheric model on a grid
              about 40 km across, served by Open-Meteo. Its “past” hours are earlier model runs. It smooths out peaks, so
              Tynys is about timing and relative exposure, not exact levels.
            </li>
            <li>The street-level differences come from a traffic exposure index, not from any measurement on those streets.</li>
            {city && (
              <li>
                Routes cover central {city.name} only: latitude {num(city.bbox[0], 3)}–{num(city.bbox[2], 3)}, longitude{' '}
                {num(city.bbox[1], 3)}–{num(city.bbox[3], 3)} (the dashed outline on the map).
              </li>
            )}
            <li>
              <strong>This is not medical advice.</strong> If you have a health condition, follow your doctor and official
              air-quality alerts.
            </li>
          </ul>
        </div>

        <div>
          <h3 className="sub">Assumptions</h3>
          <ul className="plain">
            {(meta?.assumptions ?? []).map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="sub">Data and credits</h3>
          <ul className="plain">
            <li>
              Air quality and weather: <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0), using the{' '}
              <a href="https://atmosphere.copernicus.eu/">Copernicus Atmosphere Monitoring Service (CAMS)</a> model.
            </li>
            <li>
              Streets, parks and place search: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
              , search by <a href="https://photon.komoot.io/">Photon</a>.
            </li>
            <li>
              Map tiles: <a href="https://openfreemap.org/">OpenFreeMap</a>, rendered with MapLibre GL JS.
            </li>
            <li>Breathing rates: US EPA Exposure Factors Handbook (2011), chapter 6. Class cut-points: WHO air quality guidelines (2021).</li>
          </ul>
        </div>
      </div>

      <footer className="colophon">
        <p>AIF1303 AI Fundamentals final project — Tair Kaldybayev, QAIRU, 2026</p>
        <p>
          Source code: <a href="https://github.com/tairqaldy/tynys">github.com/tairqaldy/tynys</a>
        </p>
      </footer>
    </section>
  );
}
