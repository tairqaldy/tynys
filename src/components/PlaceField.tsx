import { useEffect, useId, useRef, useState } from 'react';
import { api, isAbort } from '../api/client';
import type { CityId, PlaceResult } from '../api/types';
import { useDebounced } from '../lib/hooks';

export interface RoutePoint {
  lat: number;
  lon: number;
  label: string;
}

interface Props {
  label: string;
  marker: 'A' | 'B';
  city: CityId;
  value: RoutePoint | null;
  onSelect: (p: RoutePoint | null) => void;
  onFocus: () => void;
  picking: boolean;
}

/** Place search as an ARIA 1.2 combobox; results come from /api/places (debounced, stale requests aborted). */
export function PlaceField({ label, marker, city, value, onSelect, onFocus, picking }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? '');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const lastValue = useRef(value?.label ?? '');

  // Keep the text in sync when the point is set elsewhere (map click, preset, swap).
  useEffect(() => {
    const l = value?.label ?? '';
    lastValue.current = l;
    setText(l);
    setOpen(false);
  }, [value]);

  const q = useDebounced(text, 260);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || query === lastValue.current) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ac = new AbortController();
    setStatus('loading');
    api.places(city, query, ac.signal).then(
      (r) => {
        setResults(r.results);
        setActive(-1);
        setStatus(r.results.length ? 'idle' : 'empty');
      },
      (e) => {
        if (isAbort(e)) return;
        setResults([]);
        setStatus('error');
      },
    );
    return () => ac.abort();
  }, [q, city]);

  const choose = (r: PlaceResult) => {
    onSelect({ lat: r.lat, lon: r.lon, label: r.name });
    setOpen(false);
  };

  const showList = open && (results.length > 0 || status === 'empty' || status === 'error');

  return (
    <div className={`place${picking ? ' is-picking' : ''}`}>
      <label htmlFor={id} className="place__label">
        <span className="place__marker" aria-hidden="true">
          {marker}
        </span>
        {label}
      </label>
      <div className="place__box">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search a place or click the map"
          value={text}
          onFocus={() => {
            onFocus();
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Enter') {
              if (showList && active >= 0 && results[active]) {
                e.preventDefault();
                choose(results[active]);
              } else if (showList && results.length === 1) {
                e.preventDefault();
                choose(results[0]);
              }
            } else if (e.key === 'Escape') {
              if (open) {
                e.preventDefault();
                setOpen(false);
              }
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="place__clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onSelect(null);
              setText('');
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {status === 'loading' && <span className="place__spin" aria-hidden="true" />}
      </div>
      <ul id={listId} role="listbox" className="place__list" hidden={!showList} aria-label={`${label} suggestions`}>
        {results.map((r, k) => (
          <li
            key={`${r.name}-${r.lat}-${r.lon}`}
            id={`${listId}-${k}`}
            role="option"
            aria-selected={k === active}
            className={k === active ? 'is-active' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(r)}
          >
            <span className="place__name">{r.name}</span>
            {r.detail && <span className="place__detail">{r.detail}</span>}
          </li>
        ))}
        {status === 'empty' && <li className="place__empty" role="option" aria-disabled="true" aria-selected="false">Nothing found inside the covered area.</li>}
        {status === 'error' && <li className="place__empty" role="option" aria-disabled="true" aria-selected="false">Search is not available right now. Click the map instead.</li>}
      </ul>
    </div>
  );
}
