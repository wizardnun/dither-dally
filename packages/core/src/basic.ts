import { createBuffer } from "./color.ts";
import { createColorModel, type ColorSettings, DEFAULT_COLOR } from "./colorspace.ts";
import type { AlgorithmDefinition, Palette, PixelBuffer } from "./types.ts";

/** Maps every pixel to its nearest palette colour after adding `bias` (sRGB units) to each channel. */
export function quantize(
  input: PixelBuffer,
  palette: Palette,
  bias = 0,
  color: ColorSettings = DEFAULT_COLOR,
): PixelBuffer {
  // No error is carried between pixels, so only the matching metric matters here.
  const model = createColorModel(palette, { space: "srgb", metric: color.metric });
  const out = createBuffer(input.width, input.height);
  const src = input.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const p = palette[model.nearest(src[i]! + bias, src[i + 1]! + bias, src[i + 2]! + bias)]!;
    dst[i] = p[0];
    dst[i + 1] = p[1];
    dst[i + 2] = p[2];
    dst[i + 3] = src[i + 3]!;
  }
  return out;
}

/** No style: the image passes through unchanged, so only the effects apply. */
export const noStyle: AlgorithmDefinition = {
  id: "none",
  name: "None",
  family: "basic",
  summary: "No dithering: the image keeps all its colours, so only your effects change it.",
  controls: [],
  keepsColours: true,
  run: (input) => ({ width: input.width, height: input.height, data: input.data.slice() }),
};

export const nearestColor: AlgorithmDefinition = {
  id: "nearest",
  name: "Nearest colour",
  family: "basic",
  summary: "Snaps each pixel to the closest palette colour, with no dithering.",
  controls: [],
  run: (input, palette, _params, ctx) => quantize(input, palette, 0, ctx.color),
};

export const threshold: AlgorithmDefinition = {
  id: "threshold",
  name: "Threshold",
  family: "basic",
  summary: "Nearest colour with an adjustable cut-off: lower levels push more pixels to lighter colours.",
  controls: [
    { kind: "slider", id: "level", label: "Level", min: 0, max: 255, step: 1, default: 128 },
  ],
  run: (input, palette, params, ctx) => quantize(input, palette, 128 - Number(params.level ?? 128), ctx.color),
};
