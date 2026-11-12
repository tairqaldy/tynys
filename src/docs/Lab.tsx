import { useId, type ReactNode } from 'react';

/**
 * Frame shared by the three interactive labs on /docs: a title bar with controls on the right,
 * the figure, and an optional one-line readout under it. Labs put their own content inside.
 */
export function Lab({
  title,
  tag,
  actions,
  children,
  readout,
  className = '',
}: {
  title: string;
  /** short label in the corner, e.g. "live · Almaty 14:00" */
  tag?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  readout?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <figure className={`lab ${className}`} aria-labelledby={id}>
      <div className="lab__bar">
        <p className="lab__title">
          <span id={id}>{title}</span>
          {tag && <span className="lab__tag">{tag}</span>}
        </p>
        {actions && <div className="lab__actions">{actions}</div>}
      </div>
      <div className="lab__body">{children}</div>
      {readout && <div className="lab__readout">{readout}</div>}
    </figure>
  );
}

/** Small pill button used inside labs. `active` marks the pressed state. */
export function LabButton({
  children,
  onClick,
  active,
  disabled,
  title,
  kind = 'ghost',
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  kind?: 'ghost' | 'solid';
}) {
  return (
    <button
      type="button"
      className={`lab-btn lab-btn--${kind}`}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
