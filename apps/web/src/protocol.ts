import type { ColorSettings, Params } from "@dither-dally/core";

export interface DitherRequest {
  requestId: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred, not copied. */
  buffer: ArrayBuffer;
  algorithmId: string;
  params: Params;
  paletteId: string;
  seed: number;
  color: ColorSettings;
}

export type DitherResponse =
  | { requestId: number; ok: true; width: number; height: number; buffer: ArrayBuffer; ms: number }
  | { requestId: number; ok: false; error: string };
