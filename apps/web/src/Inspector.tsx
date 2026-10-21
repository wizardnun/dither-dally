import { useRef, useState, type KeyboardEvent } from "react";
import {
  FAMILY_LABELS,
  PIXEL_SIZE_RANGE,
  getAlgorithm,
  glyph,
  usableChars,
  type ColorSettings,
  type DitherLayer,
  type PaletteRef,
} from "@dither-dally/core";
import { Canvas } from "./Canvas.tsx";
import { ResetButton, SettingsList } from "./ControlField.tsx";
import { EffectList, type EffectListProps } from "./EffectList.tsx";
import { ChevronIcon, DiceIcon, DocIcon, FolderIcon, LinkIcon } from "./icons.tsx";
import { PalettePicker } from "./PalettePicker.tsx";
import { Row, Section, Segmented, SliderRow, SwitchRow } from "./ui.tsx";

export type TextAction = "copy" | "txt" | "html";

export const STEADY_HELP = "Keeps dots still where the picture doesn't change, so diffusion and noise styles don't shimmer. Moving parts still update.";

type Tab = "style" | "effects" | "output";
const TABS: { id: Tab; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "effects", label: "Effects" },
  { id: "output", label: "Output" },
];

type Props = Omit<EffectListProps, "onShowStyle"> & {
  /** Width of the working image, for warning when characters would be too small to read. */
  workingWidth: number;
  onTextAction: (action: TextAction) => void;
  onOpenStyles: () => void;
  palette: PaletteRef;
  onPalette: (ref: PaletteRef) => void;
  onExtract: (count: number) => void;
  onImportPalette: () => void;
  onSavePalette: () => void;
  color: ColorSettings;
  onColor: (c: ColorSettings) => void;
  pixelSize: number;
  onPixelSize: (n: number) => void;
  isVideo: boolean;
  /** Null while still checking. */
  gpuAvailable: boolean | null;
  useGpu: boolean;
  onUseGpu: (on: boolean) => void;
  steadyDots: boolean;
  onSteadyDots: (on: boolean) => void;
  seed: number;
  onSeed: (n: number) => void;
  onCopyLink: () => void;
  onSavePreset: () => void;
  onLoadPreset: () => void;
};

/** Three tabs: the style, the effects around it, and output and preset settings. */
export function Inspector(p: Props) {
  const [tab, setTab] = useState<Tab>("style");
  const tabsRef = useRef<HTMLDivElement>(null);
  const dither = p.layers.find((l) => l.kind === "dither") as DitherLayer;
  const effectCount = p.layers.length - 1;

  // Arrow keys move between tabs, as in a native tab bar.
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length]!;
    setTab(t.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#tab-${t.id}`)?.focus();
  }

  return (
    <>
      <div ref={tabsRef} className="inspector-tabs segmented" role="tablist" aria-label="Inspector" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "effects" && effectCount > 0 && <span className="tab-count">{effectCount}</span>}
          </button>
        ))}
      </div>
      <div className="inspector-scroll" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "style" && <StyleTab {...p} layer={dither} />}
        {tab === "effects" && <EffectList {...p} onShowStyle={() => setTab("style")} />}
        {tab === "output" && <OutputTab {...p} />}
      </div>
    </>
  );
}

function StyleTab(p: Props & { layer: DitherLayer }) {
  const algorithm = getAlgorithm(p.layer.algorithm);
  const diffusion = algorithm.family === "error-diffusion";
  return (
    <>
      <header className="inspector-head">
        <button type="button" className="style-picker" onClick={p.onOpenStyles} title="Browse styles (Ctrl K)">
          <span className="style-picker-thumb">
            <Canvas image={p.ditherThumbnail} label="" />
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
        {!p.layer.enabled && (
          <p className="hint warn">
            The dither is turned off, so you're seeing the image with only its effects.{" "}
            <button type="button" className="link-btn" onClick={() => p.onToggle(p.layer.id)}>
              Turn it on
            </button>
          </p>
        )}
      </header>

      {!algorithm.keepsColours && (
        <Section title="Settings">
          <SettingsList layer={p.layer} onParam={p.onParam} />
          <ResetButton onClick={() => p.onResetLayer(p.layer.id)} />
        </Section>
      )}

      {algorithm.family === "text" && <TextSection {...p} layer={p.layer} />}

      {algorithm.keepsColours ? (
        <p className="hint keeps-colours">
          Palette and colour settings don't apply without a style. Add effects on the Effects tab.
        </p>
      ) : (
        <>
          <Section title="Palette">
            <PalettePicker
              value={p.palette}
              onChange={p.onPalette}
              onExtract={p.onExtract}
              onImport={p.onImportPalette}
              onSave={p.onSavePalette}
            />
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
      )}
    </>
  );
}

function OutputTab(p: Props) {
  return (
    <>
      {p.isVideo && (
        <Section title="Video">
          <SwitchRow id="steady-dots" label="Steady dots" checked={p.steadyDots} onChange={p.onSteadyDots} help={STEADY_HELP} />
        </Section>
      )}
      <Section title="Rendering">
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
        {p.gpuAvailable === false ? (
          <p className="hint">GPU rendering isn't available in this browser, so everything runs on the processor.</p>
        ) : (
          <SwitchRow
            id="use-gpu"
            label="Use GPU"
            checked={p.useGpu}
            onChange={p.onUseGpu}
            help="Runs ordered, halftone, line and hatch styles, and Blur, Sharpen and Bloom, on your graphics card: up to 50× faster on big images and video. Error diffusion and the rest stay on the processor."
          />
        )}
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
        <p className="hint">Links and presets hold your style, effects and settings, never your image.</p>
      </Section>
    </>
  );
}

/** Glyphs are 6 px wide; below that, characters can't be drawn legibly in the image. */
const MIN_CHAR_PX = 6;

function TextSection(p: Props & { layer: DitherLayer }) {
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
