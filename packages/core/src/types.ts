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

export type Family = "basic" | "error-diffusion" | "ordered";

export interface Reference {
  author: string;
  year: number;
  title?: string;
}

interface ControlBase {
  id: string;
  label: string;
  help?: string;
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

export type Control = SliderControl | ToggleControl | SelectControl;

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

export interface RunContext {
  /** Seed for anything random. Same seed, same output. */
  seed: number;
  /** Diffusion space and matching metric. */
  color: ColorSettings;
}

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
