import type { Control, ParamValue } from "@dither-dally/core";
import { Row, Segmented, SliderRow, SwitchRow } from "./ui.tsx";

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
    case "select": {
      const current = String(value ?? control.default);
      return (
        <Row label={control.label} htmlFor={control.options.length > 4 ? id : undefined}>
          {control.options.length <= 4 ? (
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
