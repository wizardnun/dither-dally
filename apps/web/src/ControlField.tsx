import type { Control, ParamValue } from "@dither-dally/core";
import { HexField, Row, Segmented, SliderRow, SwitchRow } from "./ui.tsx";

interface Props {
  control: Control;
  value: ParamValue | undefined;
  onChange: (value: ParamValue) => void;
}

/** Renders one algorithm control from its schema, in inspector style. */
export function ControlField({ control, value, onChange }: Props) {
  const id = `ctl-${control.id}`;
  switch (control.kind) {
    case "slider":
      return (
        <SliderRow
          id={id}
          label={control.label}
          min={control.min}
          max={control.max}
          step={control.step}
          value={Number(value ?? control.default)}
          unit={control.unit}
          onChange={onChange}
        />
      );
    case "toggle":
      return (
        <SwitchRow id={id} label={control.label} help={control.help} checked={Boolean(value ?? control.default)} onChange={onChange} />
      );
    case "text":
      return (
        <div className="field-stack">
          <label htmlFor={id}>{control.label}</label>
          <input
            id={id}
            className="text-field mono"
            value={String(value ?? control.default)}
            maxLength={control.maxLength}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          {control.help && <p className="hint">{control.help}</p>}
        </div>
      );
    case "color": {
      const hex = String(value ?? control.default);
      return (
        <Row label={control.label} htmlFor={id}>
          <span className="color-field">
            <input id={id} type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
            <HexField label={`${control.label} hex`} value={hex} onChange={onChange} />
          </span>
        </Row>
      );
    }
    case "select": {
      const current = String(value ?? control.default);
      // A segmented control only when every option fits side by side in the inspector.
      const segmented = control.options.length <= 4 && control.options.reduce((n, o) => n + o.label.length, 0) <= 18;
      return (
        <Row label={control.label} htmlFor={segmented ? undefined : id}>
          {segmented ? (
            <Segmented label={control.label} value={current} options={control.options} onChange={onChange} />
          ) : (
            <select id={id} className="popup" value={current} onChange={(e) => onChange(e.target.value)}>
              {control.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {control.help && <p className="hint">{control.help}</p>}
        </Row>
      );
    }
  }
}
