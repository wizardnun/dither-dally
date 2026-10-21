import { getAlgorithm, getEffect, type Control, type Layer, type ParamValue, type Params } from "@dither-dally/core";
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

/** A layer's own controls, hiding any that don't apply to its current settings. */
export function SettingsList({ layer, onParam }: { layer: Layer; onParam: (layerId: string, key: string, value: ParamValue) => void }) {
  const controls = layer.kind === "dither" ? getAlgorithm(layer.algorithm).controls : getEffect(layer.effect).controls;
  if (!controls.length) return <p className="hint">This {layer.kind === "dither" ? "style" : "effect"} has no settings of its own.</p>;
  return (
    <>
      {controls
        .filter((c) => isVisible(c, controls, layer.params))
        .map((c) => (
          <ControlField key={`${layer.id}:${c.id}`} control={c} value={layer.params[c.id]} onChange={(v) => onParam(layer.id, c.id, v)} />
        ))}
    </>
  );
}

/** Whether a control applies with the current settings (unset values count as their default). */
function isVisible(control: Control, controls: readonly Control[], params: Params): boolean {
  const when = control.visibleWhen;
  if (!when) return true;
  const value = params[when.control] ?? controls.find((c) => c.id === when.control)?.default;
  return value !== undefined && when.is.includes(value);
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="link-btn" onClick={onClick}>
      Reset to defaults
    </button>
  );
}
