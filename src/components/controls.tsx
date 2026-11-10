import { useId, type ReactNode } from 'react';

export function Slider(props: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  hint?: ReactNode;
  ends?: [string, string];
  valueText?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="field slider">
      <div className="field__row">
        <label htmlFor={id} className="field__label">
          {props.label}
        </label>
        <output htmlFor={id} className="field__value num">
          {props.display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-describedby={props.hint ? hintId : undefined}
        aria-valuetext={props.valueText ?? props.display}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.ends && (
        <div className="slider__ends" aria-hidden="true">
          <span>{props.ends[0]}</span>
          <span>{props.ends[1]}</span>
        </div>
      )}
      {props.hint && (
        <p className="field__hint" id={hintId}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

export function Chips<T extends string>(props: {
  legend: string;
  name: string;
  options: { value: T; label: string; note?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="field chips">
      <legend className="field__label">{props.legend}</legend>
      <div className="chips__row">
        {props.options.map((o) => (
          <label key={o.value} className="chip">
            <input
              type="radio"
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            <span className="chip__face">
              {o.label}
              {o.note && <span className="chip__note">{o.note}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Switch(props: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field switch">
      <label className="switch__label" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={props.checked}
          disabled={props.disabled}
          aria-describedby={props.hint ? `${id}-hint` : undefined}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span className="switch__text">{props.label}</span>
      </label>
      {props.hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <fieldset className="segmented">
      <legend className="sr-only">{props.label}</legend>
      {props.options.map((o) => (
        <label key={o.value} className="segmented__opt">
          <input
            type="radio"
            name={props.name}
            value={o.value}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
