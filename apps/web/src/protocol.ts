import type { ColorSettings, Layer, RGB, SteadyOptions } from "@dither-dally/core";

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
  /** Video frames: keep dots steady between consecutive requests (see SteadyDither). */
  steady?: SteadyOptions;
  /** Run the layers that can on the GPU (WebGPU), where available. */
  gpu?: boolean;
}

export type RenderResponse =
  | { requestId: number; ok: true; width: number; height: number; buffer: ArrayBuffer; ms: number; gpu: boolean }
  | { requestId: number; ok: false; error: string };
