import type { ReactNode } from 'react';
import { CLASS_IDS, CLASS_LABEL, CLASS_LETTER } from '../lib/classes';

/** Shared SVG patterns, one per class, overlaid on class fills (low = plain). Rendered once. */
export function ClassPatterns() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <pattern id="pat-low" width="6" height="6" patternUnits="userSpaceOnUse" />
        <pattern id="pat-moderate" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="0.9" fill="var(--pattern-ink)" />
        </pattern>
        <pattern id="pat-elevated" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--pattern-ink)" strokeWidth="1.1" />
        </pattern>
        <pattern id="pat-high" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4.5" stroke="var(--pattern-ink)" strokeWidth="1.1" />
          <line x1="0" y1="0" x2="4.5" y2="0" stroke="var(--pattern-ink)" strokeWidth="1.1" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Small class chip: coloured square with its letter. */
export function ClassChip({ i, withLabel = false }: { i: number; withLabel?: boolean }) {
  return (
    <span className="class-chip" data-c={CLASS_IDS[i]}>
      <span className="class-chip__sq" aria-hidden="true">
        {CLASS_LETTER[i]}
      </span>
      {withLabel ? <span className="class-chip__label">{CLASS_LABEL[i]}</span> : <span className="sr-only">{CLASS_LABEL[i]}</span>}
    </span>
  );
}

export function Badge({ kind, children, title }: { kind: 'mock' | 'snapshot' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${kind}`} title={title}>
      {children}
    </span>
  );
}

export function Skeleton({ lines = 3, hero = false, chart = 0 }: { lines?: number; hero?: boolean; chart?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {hero && <div className="skeleton__hero" />}
      {Array.from({ length: lines }, (_, k) => (
        <div key={k} className="skeleton__line" style={{ width: `${92 - k * 14}%` }} />
      ))}
      {chart > 0 && <div className="skeleton__chart" style={{ height: chart }} />}
    </div>
  );
}

export function LoadingNote({ what }: { what: string }) {
  return (
    <p className="sr-only" role="status">
      Loading {what}…
    </p>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p className="error-state__title">{title}</p>
      <p className="error-state__msg">{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** A table only screen readers see: the text version of a chart. */
export function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => (
          <tr key={k}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Section header on the page spine. */
export function QuestionHead({ n, kicker, title, id }: { n: number | string; kicker: string; title: string; id: string }) {
  return (
    <header className="q-head">
      <span className="q-head__n" aria-hidden="true">
        {n}
      </span>
      <p className="q-head__kicker">{kicker}</p>
      <h2 className="q-head__title" id={id}>
        {title}
      </h2>
    </header>
  );
}

export function Assumption({ children }: { children: ReactNode }) {
  return (
    <span className="assume">
      <span className="assume__tag">Assumption</span> {children}
    </span>
  );
}
