import type { ColorSettings, Layer, RGB } from "@dither-dally/core";

export interface RenderRequest {
  requestId: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred, not copied. */
  buffer: ArrayBuffer;
  layers: Layer[];
  /** Already resolved to colours, so custom palettes need no lookup in the worker. */
  palette: RGB[];
  seed: number;
  color: ColorSettings;
}

export type RenderResponse =
  | { requestId: number; ok: true; width: number; height: number; buffer: ArrayBuffer; ms: number }
  | { requestId: number; ok: false; error: string };
