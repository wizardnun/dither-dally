import { nearestColor, threshold } from "./basic.ts";
import { hexagons, shapeGrid, triangles, voronoiCells } from "./cells.ts";
import { KERNELS, diffusionAlgorithm } from "./diffusion.ts";
import { cmykHalftone, halftone } from "./halftone.ts";
import { bayer, blueNoise, whiteNoise } from "./ordered.ts";
import { crosshatch } from "./pattern.ts";
import { riemersma } from "./riemersma.ts";
import type { AlgorithmDefinition, Family, Params } from "./types.ts";

export const ALGORITHMS: readonly AlgorithmDefinition[] = [
  nearestColor,
  threshold,
  ...KERNELS.map(diffusionAlgorithm),
  riemersma,
  bayer,
  blueNoise,
  whiteNoise,
  halftone,
  cmykHalftone,
  crosshatch,
  shapeGrid,
  voronoiCells,
  hexagons,
  triangles,
];

export const FAMILY_LABELS: Record<Family, string> = {
  basic: "Basic",
  "error-diffusion": "Error diffusion",
  ordered: "Ordered",
  halftone: "Halftone",
  pattern: "Pattern",
  polygon: "Polygon",
};

/** Whether the family reproduces tones (a flat grey comes out as a matching mix), as opposed to a stylised look. */
export const TONAL_FAMILIES: ReadonlySet<Family> = new Set(["error-diffusion", "ordered", "halftone"]);

export function getAlgorithm(id: string): AlgorithmDefinition {
  const a = ALGORITHMS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown algorithm "${id}"`);
  return a;
}

export function defaultParams(algorithm: AlgorithmDefinition): Params {
  return Object.fromEntries(algorithm.controls.map((c) => [c.id, c.default]));
}
