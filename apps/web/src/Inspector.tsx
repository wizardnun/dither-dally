import { FAMILY_LABELS, PIXEL_SIZE_RANGE, type AlgorithmDefinition, type ColorSettings, type Params } from "@dither-dally/core";
import { Canvas } from "./Canvas.tsx";
import { ControlField } from "./ControlField.tsx";
import { ChevronIcon, DiceIcon, DocIcon, FolderIcon, LinkIcon } from "./icons.tsx";
import { PalettePicker } from "./PalettePicker.tsx";
import { Row, Section, Segmented, SliderRow } from "./ui.tsx";

interface Props {
  algorithm: AlgorithmDefinition;
  thumbnail: ImageData | null;
  onOpenStyles: () => void;
  params: Params;
  onParam: (id: string, value: Params[string]) => void;
  paletteId: string;
  onPalette: (id: string) => void;
  color: ColorSettings;
  onColor: (c: ColorSettings) => void;
  pixelSize: number;
  onPixelSize: (n: number) => void;
  seed: number;
  onSeed: (n: number) => void;
  onCopyLink: () => void;
  onSavePreset: () => void;
  onLoadPreset: () => void;
}

export function Inspector(p: Props) {
  const { algorithm } = p;
  const diffusion = algorithm.family === "error-diffusion";
  return (
    <div className="inspector-scroll">
      <header className="inspector-head">
        <button type="button" className="style-picker" onClick={p.onOpenStyles} title="Browse styles (Ctrl K)">
          <span className="style-picker-thumb">
            <Canvas image={p.thumbnail} label="" />
          </span>
          <span className="style-picker-text">
            <span className="style-picker-family">{FAMILY_LABELS[algorithm.family]}</span>
            <span className="style-picker-name">{algorithm.name}</span>
          </span>
          <ChevronIcon size={14} className="style-picker-chev" />
        </button>
        <p>{algorithm.summary}</p>
        {algorithm.reference && (
          <p className="ref">
            {algorithm.reference.author}, {algorithm.reference.year}
          </p>
        )}
      </header>

      <Section title="Settings">
        {algorithm.controls.length ? (
          algorithm.controls.map((c) => (
            <ControlField key={`${algorithm.id}:${c.id}`} control={c} value={p.params[c.id]} onChange={(v) => p.onParam(c.id, v)} />
          ))
        ) : (
          <p className="hint">This algorithm has no settings of its own.</p>
        )}
      </Section>

      <Section title="Palette">
        <PalettePicker value={p.paletteId} onChange={p.onPalette} />
      </Section>

      <Section title="Colour">
        <Row label="Matching">
          <Segmented
            label="Colour matching"
            value={p.color.metric}
            options={[
              { value: "srgb", label: "sRGB" },
              { value: "oklab", label: "OKLab" },
            ]}
            onChange={(metric) => p.onColor({ ...p.color, metric })}
          />
        </Row>
        <Row label="Diffuse in">
          <Segmented
            label="Diffuse error in"
            value={p.color.space}
            disabled={!diffusion}
            options={[
              { value: "srgb", label: "sRGB" },
              { value: "linear", label: "Linear" },
            ]}
            onChange={(space) => p.onColor({ ...p.color, space })}
          />
        </Row>
        <p className="hint">
          OKLab picks colours the way your eye sees them.{" "}
          {diffusion
            ? "Linear keeps true brightness; midtones come out darker than the classic look."
            : "Diffusion space only applies to error-diffusion algorithms."}
        </p>
      </Section>

      <Section title="Output">
        <SliderRow
          id="pixel-size"
          label="Pixel size"
          min={PIXEL_SIZE_RANGE.min}
          max={PIXEL_SIZE_RANGE.max}
          step={1}
          value={p.pixelSize}
          unit="×"
          onChange={p.onPixelSize}
        />
        <Row label="Seed" htmlFor="seed">
          <div className="seed">
            <input
              id="seed"
              className="text-field"
              type="number"
              value={p.seed}
              onChange={(e) => p.onSeed(Math.trunc(Number(e.target.value)) >>> 0)}
            />
            <button type="button" className="icon-btn" aria-label="Random seed" title="Random seed" onClick={() => p.onSeed(Math.floor(Math.random() * 1e6))}>
              <DiceIcon size={16} />
            </button>
          </div>
        </Row>
      </Section>

      <Section title="Preset">
        <div className="button-row">
          <button type="button" className="push" onClick={p.onCopyLink}>
            <LinkIcon size={14} /> Copy link
          </button>
          <button type="button" className="push" onClick={p.onSavePreset}>
            <DocIcon size={14} /> Save
          </button>
          <button type="button" className="push" onClick={p.onLoadPreset}>
            <FolderIcon size={14} /> Load
          </button>
        </div>
        <p className="hint">Links and presets hold your settings, never your image.</p>
      </Section>
    </div>
  );
}
