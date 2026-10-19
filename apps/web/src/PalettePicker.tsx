import { PALETTES, toHex } from "@dither-dally/core";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function PalettePicker({ value, onChange }: Props) {
  return (
    <div className="palettes" role="radiogroup" aria-label="Palette">
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
  );
}
