import type { ReactNode } from 'react';
import { CLASS_LABEL, CLASS_LETTER } from '../lib/classes';
import { num } from '../lib/format';

const L = CLASS_LETTER as readonly string[];

interface MatrixProps {
  m: readonly (readonly number[])[];
  name?: ReactNode;
  digits?: number;
  integer?: boolean;
  rowLabels?: readonly string[];
  colLabels?: readonly string[];
  /** rows to mark with a dagger, e.g. backed-off transition rows */
  marked?: ReadonlySet<number>;
  highlightRow?: number;
  caption: string;
  /** label shown above the column labels */
  colTitle?: string;
  rowTitle?: string;
}

/**
 * A matrix typeset like a textbook: bracketed, row and column labels outside the brackets,
 * tabular figures. A visually hidden table carries the same numbers for screen readers.
 */
export function Matrix({
  m,
  name,
  digits = 3,
  integer = false,
  rowLabels = L,
  colLabels = L,
  marked,
  highlightRow,
  caption,
  colTitle,
  rowTitle,
}: MatrixProps) {
  const fmt = (x: number) => (integer ? String(Math.round(x)) : num(x, digits));
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  return (
    <figure className="mx">
      {name && <div className="mx__name">{name}</div>}
      {colTitle && (
        <div className="mx__coltitle" aria-hidden="true">
          {colTitle}
        </div>
      )}
      <div
        className="mx__grid"
        aria-hidden="true"
        style={{ gridTemplateColumns: `auto 7px repeat(${cols}, auto) 7px auto`, gridTemplateRows: `auto repeat(${rows}, auto)` }}
      >
        {colLabels.slice(0, cols).map((c, j) => (
          <span key={`c${j}`} className="mx__col" style={{ gridColumn: 3 + j, gridRow: 1 }}>
            {c}
          </span>
        ))}
        <span className="mx__br mx__br--l" style={{ gridColumn: 2, gridRow: `2 / span ${rows}` }} />
        <span className="mx__br mx__br--r" style={{ gridColumn: 3 + cols, gridRow: `2 / span ${rows}` }} />
        {m.map((row, i) => (
          <Row
            key={i}
            i={i}
            row={row}
            fmt={fmt}
            label={rowLabels[i]}
            cols={cols}
            marked={marked?.has(i) ?? false}
            hi={highlightRow === i}
          />
        ))}
      </div>
      {rowTitle && <div className="mx__rowtitle" aria-hidden="true">{rowTitle}</div>}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">from \ to</th>
            {colLabels.slice(0, cols).map((c, j) => (
              <th key={j} scope="col">
                {expand(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.map((row, i) => (
            <tr key={i}>
              <th scope="row">
                {expand(rowLabels[i])}
                {marked?.has(i) ? ' (backed off to pooled counts)' : ''}
              </th>
              {row.map((x, j) => (
                <td key={j}>{fmt(x)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function expand(l: string): string {
  const k = L.indexOf(l);
  return k >= 0 ? CLASS_LABEL[k] : l;
}

function Row({
  i,
  row,
  fmt,
  label,
  cols,
  marked,
  hi,
}: {
  i: number;
  row: readonly number[];
  fmt: (x: number) => string;
  label: string;
  cols: number;
  marked: boolean;
  hi: boolean;
}) {
  const r = 2 + i;
  return (
    <>
      <span className={`mx__row${hi ? ' is-hi' : ''}`} style={{ gridColumn: 1, gridRow: r }}>
        {label}
      </span>
      {row.map((x, j) => (
        <span key={j} className={`mx__cell${hi ? ' is-hi' : ''}${x === 0 ? ' is-zero' : ''}`} style={{ gridColumn: 3 + j, gridRow: r }}>
          {fmt(x)}
        </span>
      ))}
      <span className="mx__mark" style={{ gridColumn: 4 + cols, gridRow: r }}>
        {marked ? '†' : ''}
      </span>
    </>
  );
}

/** A column vector, used in the Bayes step. */
export function Vec({ v, digits = 3, name, hi }: { v: readonly number[]; digits?: number; name: ReactNode; hi?: number }) {
  return (
    <div className="vec">
      <div className="vec__name">{name}</div>
      <div className="vec__body">
        <span className="mx__br mx__br--l" />
        <span className="vec__cells">
          {v.map((x, i) => (
            <span key={i} className={`mx__cell${hi === i ? ' is-hi' : ''}`}>
              {num(x, digits)}
            </span>
          ))}
        </span>
        <span className="mx__br mx__br--r" />
      </div>
    </div>
  );
}

export function VecLabels() {
  return (
    <div className="vec vec--labels" aria-hidden="true">
      <div className="vec__name">&nbsp;</div>
      <div className="vec__body">
        <span className="vec__cells">
          {L.map((l) => (
            <span key={l} className="mx__row">
              {l}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
