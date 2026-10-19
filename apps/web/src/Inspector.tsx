import {
  EFFECT_CATEGORY_LABELS,
  FAMILY_LABELS,
  PIXEL_SIZE_RANGE,
  getAlgorithm,
  getEffect,
  glyph,
  usableChars,
  type ColorSettings,
  type Layer,
  type PaletteRef,
  type Params,
} from "@dither-dally/core";
import { Canvas } from "./Canvas.tsx";
import { ControlField } from "./ControlField.tsx";
import { ChevronIcon, DiceIcon, DocIcon, FolderIcon, LinkIcon } from "./icons.tsx";
import { PalettePicker } from "./PalettePicker.tsx";
import { Row, Section, Segmented, SliderRow } from "./ui.tsx";

export type TextAction = "copy" | "txt" | "html";

interface Props {
  layer: Layer;
  /** Width of the working image, for warning when characters would be too small to read. */
  workingWidth: number;
  onTextAction: (action: TextAction) => void;
  thumbnail: ImageData | null;
  onOpenStyles: () => void;
  onParam: (layerId: string, key: string, value: Params[string]) => void;
  onResetLayer: (layerId: string) => void;
  palette: PaletteRef;
  onPalette: (ref: PaletteRef) => void;
  onExtract: (count: number) => void;
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

/** Shows the selected layer's settings, then document-wide output and preset controls. */
export function Inspector(p: Props) {
  const { layer } = p;
  return (
    <div className="inspector-scroll">
      {layer.kind === "dither" ? <DitherSections {...p} layer={layer} /> : <EffectSections {...p} layer={layer} />}

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
        <p className="hint">The seed drives everything random: noise styles, grain, glitches and Voronoi layouts.</p>
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
        <p className="hint">Links and presets hold all your layers and settings, never your image.</p>
      </Section>
    </div>
  );
}

function SettingsList({ layer, onParam }: { layer: Layer; onParam: Props["onParam"] }) {
  const controls = layer.kind === "dither" ? getAlgorithm(layer.algorithm).controls : getEffect(layer.effect).controls;
  if (!controls.length) return <p className="hint">This {layer.kind === "dither" ? "style" : "effect"} has no settings of its own.</p>;
  return (
    <>
      {controls.map((c) => (
        <ControlField key={`${layer.id}:${c.id}`} control={c} value={layer.params[c.id]} onChange={(v) => onParam(layer.id, c.id, v)} />
      ))}
    </>
  );
}

function DitherSections(p: Props & { layer: Extract<Layer, { kind: "dither" }> }) {
  const algorithm = getAlgorithm(p.layer.algorithm);
  const diffusion = algorithm.family === "error-diffusion";
  return (
    <>
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
        <SettingsList layer={p.layer} onParam={p.onParam} />
        <ResetButton onClick={() => p.onResetLayer(p.layer.id)} />
      </Section>

      {algorithm.family === "text" && <TextSection {...p} layer={p.layer} />}

      <Section title="Palette">
        <PalettePicker value={p.palette} onChange={p.onPalette} onExtract={p.onExtract} />
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
            : "Diffusion space only applies to error-diffusion styles."}
        </p>
      </Section>
    </>
  );
}

function EffectSections(p: Props & { layer: Extract<Layer, { kind: "effect" }> }) {
  const effect = getEffect(p.layer.effect);
  return (
    <>
      <header className="inspector-head">
        <span className="style-picker-family">{EFFECT_CATEGORY_LABELS[effect.category]} effect</span>
        <h2 className="effect-title">{effect.name}</h2>
        <p>{effect.summary}</p>
      </header>
      <Section title="Settings">
        <SettingsList layer={p.layer} onParam={p.onParam} />
        {effect.controls.length > 0 && <ResetButton onClick={() => p.onResetLayer(p.layer.id)} />}
      </Section>
    </>
  );
}

/** Glyphs are 6 px wide; below that, characters can't be drawn legibly in the image. */
const MIN_CHAR_PX = 6;

function TextSection(p: Props & { layer: Extract<Layer, { kind: "dither" }> }) {
  const cols = Number(p.layer.params.columns ?? 100);
  const charPx = p.workingWidth / cols;
  const maxCols = Math.floor(p.workingWidth / MIN_CHAR_PX);
  // Say exactly what happens to custom characters the built-in font can't draw.
  const custom = p.layer.params.charset === "custom" ? String(p.layer.params.custom ?? "") : null;
  const skipped = custom === null ? [] : [...new Set([...custom])].filter((c) => !glyph(c));
  const usable = custom === null ? 0 : usableChars(custom).length;
  return (
    <Section title="Text">
      {custom !== null && usable < 2 && (
        <p className="hint warn">
          {usable === 0 ? "None of your custom characters" : "Only one of your custom characters"} can be drawn
          {skipped.length ? ` (${skipped.map((c) => (c === " " ? "space" : c)).join(" ")} aren't in the font)` : ""}, so Classic is being
          used instead. Custom needs at least two drawable characters, for example “ .:oO@”.
        </p>
      )}
      {custom !== null && usable >= 2 && skipped.length > 0 && (
        <p className="hint warn">Skipped characters the font can't draw: {skipped.join(" ")}</p>
      )}
      <div className="button-row">
        <button type="button" className="push" onClick={() => p.onTextAction("copy")}>
          Copy text
        </button>
        <button type="button" className="push" onClick={() => p.onTextAction("txt")}>
          Save .txt
        </button>
        <button type="button" className="push" onClick={() => p.onTextAction("html")}>
          Save HTML
        </button>
      </div>
      {charPx < MIN_CHAR_PX ? (
        <p className="hint warn">
          Each character is only {charPx.toFixed(1)} px wide here, so they'll look smudged in the picture (the text you copy is
          unaffected). For crisp characters use at most {maxCols} across{p.pixelSize > 1 ? ", or set Pixel size to 1" : ""}.
        </p>
      ) : (
        <p className="hint">
          {cols} characters across. Paste into anything with a monospace font; HTML keeps the colours.
        </p>
      )}
    </Section>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="link-btn" onClick={onClick}>
      Reset to defaults
    </button>
  );
}
