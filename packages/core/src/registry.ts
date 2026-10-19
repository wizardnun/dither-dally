import { nearestColor, threshold } from "./basic.ts";
import { KERNELS, diffusionAlgorithm } from "./diffusion.ts";
import { bayer, blueNoise, whiteNoise } from "./ordered.ts";
import type { AlgorithmDefinition, Family, Params } from "./types.ts";

export const ALGORITHMS: readonly AlgorithmDefinition[] = [
  nearestColor,
  threshold,
  ...KERNELS.map(diffusionAlgorithm),
  bayer,
  blueNoise,
  whiteNoise,
];

export const FAMILY_LABELS: Record<Family, string> = {
  basic: "Basic",
  "error-diffusion": "Error diffusion",
  ordered: "Ordered",
};

export function getAlgorithm(id: string): AlgorithmDefinition {
  const a = ALGORITHMS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown algorithm "${id}"`);
  return a;
}

export function defaultParams(algorithm: AlgorithmDefinition): Params {
  return Object.fromEntries(algorithm.controls.map((c) => [c.id, c.default]));
}
