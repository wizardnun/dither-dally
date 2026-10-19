import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronIcon } from "./icons.tsx";

/** Collapsible inspector section with a disclosure chevron. */
export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="section">
      <button type="button" className="section-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <ChevronIcon size={12} className="chev" />
      </button>
      <div id={id} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Name and value field on one line, full-width slider underneath. */
export function SliderRow({
  id,
  label,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="value-field">
        <input
          aria-label={`${label} value`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  iconOnly,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <div className={`segmented${iconOnly ? " icon-only" : ""}`} role="radiogroup" aria-label={label} aria-disabled={disabled}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={iconOnly ? o.label : undefined}
          title={iconOnly ? o.label : undefined}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {!iconOnly && o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <input id={id} className="switch" type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  );
}

/** Inspector row: label on the left, any control on the right. */
export function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="row-ctl">
      <label htmlFor={htmlFor}>{label}</label>
      <div className="row-ctl-body">{children}</div>
    </div>
  );
}

/** A switch with its label on the left and optional help text underneath. */
export function SwitchRow({ id, label, help, checked, onChange }: { id: string; label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <label htmlFor={id}>{label}</label>
      <Switch id={id} checked={checked} onChange={onChange} />
      {help && <p className="hint">{help}</p>}
    </div>
  );
}
