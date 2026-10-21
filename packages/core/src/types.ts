import type { ColorSettings } from "./colorspace.ts";

/** RGBA pixels, row-major, 4 bytes per pixel. Structurally compatible with `ImageData`. */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGB = readonly [r: number, g: number, b: number];

/** Ordered list of output colours. Algorithms only ever emit these. */
export type Palette = readonly RGB[];

export type Family = "basic" | "error-diffusion" | "ordered" | "halftone" | "lines" | "pattern" | "polygon" | "glitch" | "text";

export interface Reference {
  author: string;
  year: number;
  title?: string;
}

interface ControlBase {
  id: string;
  label: string;
  help?: string;
  /** Show this control only while another control has one of these values. */
  visibleWhen?: { control: string; is: readonly ParamValue[] };
}

export interface SliderControl extends ControlBase {
  kind: "slider";
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface ToggleControl extends ControlBase {
  kind: "toggle";
  default: boolean;
}

export interface SelectControl extends ControlBase {
  kind: "select";
  options: readonly { value: string; label: string }[];
  default: string;
}

export interface ColorControl extends ControlBase {
  kind: "color";
  /** 6-digit hex, e.g. "#ff6600". */
  default: string;
}

export interface TextControl extends ControlBase {
  kind: "text";
  maxLength: number;
  default: string;
}

export type Control = SliderControl | ToggleControl | SelectControl | ColorControl | TextControl;

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

/**
 * Draws one character as an ink mask (1 = ink) of exactly `width × height`
 * pixels, or returns null if it can't. Lets a host draw text styles with a
 * real font; core falls back to its built-in pixel font without one.
 */
export type GlyphRasterizer = (ch: string, width: number, height: number) => Uint8Array | null;

export interface RunContext {
  /** Seed for anything random. Same seed, same output. */
  seed: number;
  /** Diffusion space and matching metric. */
  color: ColorSettings;
  /** Optional real-font drawing for text styles. */
  glyphs?: GlyphRasterizer;
}

export type EffectCategory = "adjust" | "light" | "glitch";

/**
 * A full-colour image operation used as a layer before or after the dither.
 * Unlike algorithms, effects are not limited to the palette: an effect after
 * the dither can add colours on purpose (a tint, a glow).
 */
export interface EffectDefinition {
  /** Stable kebab-case id. Never rename once released: presets refer to it. */
  id: string;
  name: string;
  category: EffectCategory;
  /** One sentence, in our own words. */
  summary: string;
  controls: readonly Control[];
  run(input: PixelBuffer, params: Params, ctx: { seed: number }): PixelBuffer;
}

interface LayerBase {
  id: string;
  enabled: boolean;
}

export interface DitherLayer extends LayerBase {
  kind: "dither";
  algorithm: string;
  params: Params;
}

export interface EffectLayer extends LayerBase {
  kind: "effect";
  effect: string;
  params: Params;
}

/** A step in the processing stack. Layers run top to bottom. */
export type Layer = DitherLayer | EffectLayer;

export interface AlgorithmDefinition {
  /** Stable kebab-case id. Never rename once released: presets refer to it. */
  id: string;
  name: string;
  family: Family;
  /** One sentence, in our own words. */
  summary: string;
  reference?: Reference;
  controls: readonly Control[];
  run(input: PixelBuffer, palette: Palette, params: Params, ctx: RunContext): PixelBuffer;
}
