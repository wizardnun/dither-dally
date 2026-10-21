import { nearestColor, noStyle, threshold } from "./basic.ts";
import { hexagons, pentagons, shapeGrid, triangles, voronoiCells } from "./cells.ts";
import { KERNELS, diffusionAlgorithm, gaussian } from "./diffusion.ts";
import { ripple, slip, streak } from "./glitch.ts";
import { cmykHalftone, halftone } from "./halftone.ts";
import { contours, echoes, edges, engraving, moire, rings, spiral, waveLines } from "./lines.ts";
import { bayer, blueNoise, whiteNoise } from "./ordered.ts";
import { checker, crosshatch, stipple } from "./pattern.ts";
import { riemersma } from "./riemersma.ts";
import { ascii, braille } from "./text.ts";
import { whirl } from "./whirl.ts";
import type { AlgorithmDefinition, Family, Params } from "./types.ts";

export const ALGORITHMS: readonly AlgorithmDefinition[] = [
  noStyle,
  nearestColor,
  threshold,
  ...KERNELS.map(diffusionAlgorithm),
  gaussian,
  riemersma,
  whirl,
  bayer,
  blueNoise,
  whiteNoise,
  halftone,
  cmykHalftone,
  waveLines,
  rings,
  spiral,
  moire,
  echoes,
  engraving,
  crosshatch,
  stipple,
  checker,
  contours,
  edges,
  shapeGrid,
  voronoiCells,
  hexagons,
  triangles,
  pentagons,
  streak,
  slip,
  ripple,
  ascii,
  braille,
];

export const FAMILY_LABELS: Record<Family, string> = {
  basic: "Basic",
  "error-diffusion": "Error diffusion",
  ordered: "Ordered",
  halftone: "Halftone",
  lines: "Line screens",
  pattern: "Pattern",
  polygon: "Polygon",
  glitch: "Glitch",
  text: "Text",
};

/** Whether the family reproduces tones (a flat grey comes out as a matching mix), as opposed to a stylised look. */
export const TONAL_FAMILIES: ReadonlySet<Family> = new Set(["error-diffusion", "ordered", "halftone"]);

export function getAlgorithm(id: string): AlgorithmDefinition {
  const a = ALGORITHMS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown algorithm "${id}"`);
  return a;
}

/** Default control values for an algorithm or effect. */
export function defaultParams(def: Pick<AlgorithmDefinition, "controls">): Params {
  return Object.fromEntries(def.controls.map((c) => [c.id, c.default]));
}
