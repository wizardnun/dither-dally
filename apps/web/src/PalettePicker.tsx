import { useState } from "react";
import { PALETTES, toHex, type PaletteRef } from "@dither-dally/core";
import { SliderRow } from "./ui.tsx";

interface Props {
  value: PaletteRef;
  onChange: (ref: PaletteRef) => void;
  /** Builds a palette from the current image with this many colours. */
  onExtract: (count: number) => void;
}

export function PalettePicker({ value, onChange, onExtract }: Props) {
  const [count, setCount] = useState(6);
  const custom = typeof value === "string" ? null : value;
  return (
    <div className="palette-picker">
      <div className="palettes" role="radiogroup" aria-label="Palette">
        {custom && (
          <button type="button" role="radio" aria-checked className="palette-card custom" title="Custom palette, saved with this preset">
            <span className="strip" aria-hidden="true">
              {custom.colors.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="palette-name">{custom.name}</span>
            <span className="palette-count">{custom.colors.length}</span>
          </button>
        )}
        {PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === value}
            className="palette-card"
            title={p.source}
            onClick={() => onChange(p.id)}
          >
            <span className="strip" aria-hidden="true">
              {p.colors.map((c, i) => (
                <span key={i} style={{ background: toHex(c) }} />
              ))}
            </span>
            <span className="palette-name">{p.name}</span>
            <span className="palette-count">{p.colors.length}</span>
          </button>
        ))}
      </div>
      <div className="extract">
        <SliderRow id="extract-count" label="Colours from image" min={2} max={16} step={1} value={count} onChange={setCount} />
        <button type="button" className="push" onClick={() => onExtract(count)}>
          Make palette from image
        </button>
      </div>
    </div>
  );
}
