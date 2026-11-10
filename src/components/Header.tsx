import type { CityId } from '../api/types';
import { Segmented } from './controls';

interface Props {
  city: CityId;
  setCity: (c: CityId) => void;
  cities: { id: CityId; name: string }[];
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  badges: React.ReactNode;
}

export function Header({ city, setCity, cities, theme, toggleTheme, badges }: Props) {
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="topbar__brand">
        <span className="wordmark">Tynys</span>
        <span className="wordmark__gloss" lang="kk">
          тыныс · breath
        </span>
      </div>
      <nav className="topbar__nav" aria-label="Sections">
        <a href="#now">Now</a>
        <a href="#when">When</a>
        <a href="#which">Which way</a>
        <a href="#math">Math</a>
        <a href="#about">About</a>
      </nav>
      <div className="topbar__tools">
        <div className="topbar__badges">{badges}</div>
        <Segmented
          label="City"
          name="city"
          value={city}
          onChange={setCity}
          options={cities.map((c) => ({ value: c.id, label: c.name }))}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <circle cx="9" cy="9" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              {Array.from({ length: 8 }, (_, k) => {
                const a = (k * Math.PI) / 4;
                return (
                  <line
                    key={k}
                    x1={9 + Math.cos(a) * 5.8}
                    y1={9 + Math.sin(a) * 5.8}
                    x2={9 + Math.cos(a) * 7.6}
                    y2={9 + Math.sin(a) * 7.6}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M14.5 11.2A6 6 0 0 1 6.8 3.5a6 6 0 1 0 7.7 7.7Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
