import type { CityId } from '../api/types';
import type { Navigate, Page } from '../lib/route';
import { BrandMark } from './Brand';
import { Segmented } from './controls';

interface Props {
  page: Page;
  navigate: Navigate;
  city: CityId;
  setCity: (c: CityId) => void;
  cities: { id: CityId; name: string }[];
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  badges?: React.ReactNode;
}

const PAGES: { id: Page; label: string; short: string; href: string }[] = [
  { id: 'planner', label: 'Planner', short: 'Planner', href: '/' },
  { id: 'docs', label: 'How it works', short: 'Docs', href: '/docs' },
];

export function Header({ page, navigate, city, setCity, cities, theme, toggleTheme, badges }: Props) {
  const go = (e: React.MouseEvent<HTMLAnchorElement>, p: Page) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (p !== page) navigate(p);
    else window.scrollTo({ top: 0 });
  };
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <a className="topbar__brand" href="/" onClick={(e) => go(e, 'planner')} aria-label="Tynys, the planner">
        <BrandMark />
        <span className="wordmark">Tynys</span>
        <span className="wordmark__gloss" lang="kk">
          тыныс · breath
        </span>
      </a>
      <nav className="tabs" aria-label="Pages">
        {PAGES.map((p) => (
          <a
            key={p.id}
            href={p.href}
            className="tabs__a"
            aria-current={p.id === page ? 'page' : undefined}
            onClick={(e) => go(e, p.id)}
          >
            <span className="tabs__long">{p.label}</span>
            <span className="tabs__short">{p.short}</span>
          </a>
        ))}
      </nav>
      <div className="topbar__tools">
        {badges && <div className="topbar__badges">{badges}</div>}
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
