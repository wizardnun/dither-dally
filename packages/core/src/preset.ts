import { DEFAULT_COLOR, type ColorSettings } from "./colorspace.ts";
import { PALETTES } from "./palettes.ts";
import { ALGORITHMS, defaultParams } from "./registry.ts";
import type { AlgorithmDefinition, Params } from "./types.ts";

export const PRESET_VERSION = 1;
export const PIXEL_SIZE_RANGE = { min: 1, max: 8 } as const;

/**
 * Everything needed to reproduce a look, except the image itself.
 * Phase 3 replaces the single algorithm with a list of layers (version 2).
 */
export interface Preset {
  version: typeof PRESET_VERSION;
  algorithm: string;
  params: Params;
  palette: string;
  pixelSize: number;
  seed: number;
  color: ColorSettings;
}

export class PresetError extends Error {
  override name = "PresetError";
}

export function defaultPreset(algorithmId = "floyd-steinberg"): Preset {
  const algorithm = ALGORITHMS.find((a) => a.id === algorithmId) ?? ALGORITHMS[0]!;
  return {
    version: PRESET_VERSION,
    algorithm: algorithm.id,
    params: defaultParams(algorithm),
    palette: "mono",
    pixelSize: 2,
    seed: 1,
    color: { ...DEFAULT_COLOR },
  };
}

/**
 * Validates untrusted input (a file or a shared link) into a usable preset.
 * Throws PresetError if it can't be used at all; otherwise fixes what it can
 * and reports each fix in `warnings`.
 */
export function parsePreset(input: unknown): { preset: Preset; warnings: string[] } {
  if (!isRecord(input)) throw new PresetError("A preset must be a JSON object.");
  if (input.version !== PRESET_VERSION) {
    throw new PresetError(`Unsupported preset version ${JSON.stringify(input.version)}. This app reads version ${PRESET_VERSION}.`);
  }
  const algorithm = ALGORITHMS.find((a) => a.id === input.algorithm);
  if (!algorithm) throw new PresetError(`Unknown algorithm ${JSON.stringify(input.algorithm)}.`);

  const warnings: string[] = [];
  const base = defaultPreset(algorithm.id);

  let palette = base.palette;
  if (typeof input.palette === "string" && PALETTES.some((p) => p.id === input.palette)) palette = input.palette;
  else warnings.push(`Unknown palette ${JSON.stringify(input.palette)}; using ${base.palette}.`);

  const pixelSize = clampInt(input.pixelSize, PIXEL_SIZE_RANGE.min, PIXEL_SIZE_RANGE.max);
  if (pixelSize === null) warnings.push(`Invalid pixel size; using ${base.pixelSize}.`);

  const seed = typeof input.seed === "number" && Number.isFinite(input.seed) ? Math.trunc(input.seed) >>> 0 : null;
  if (seed === null) warnings.push(`Invalid seed; using ${base.seed}.`);

  const color = { ...base.color };
  if (isRecord(input.color)) {
    if (input.color.space === "srgb" || input.color.space === "linear") color.space = input.color.space;
    else warnings.push("Unknown diffusion space; using sRGB.");
    if (input.color.metric === "srgb" || input.color.metric === "oklab") color.metric = input.color.metric;
    else warnings.push("Unknown colour metric; using sRGB.");
  } else if (input.color !== undefined) {
    warnings.push("Invalid colour settings; using defaults.");
  }

  return {
    preset: {
      version: PRESET_VERSION,
      algorithm: algorithm.id,
      params: sanitizeParams(algorithm, input.params, warnings),
      palette,
      pixelSize: pixelSize ?? base.pixelSize,
      seed: seed ?? base.seed,
      color,
    },
    warnings,
  };
}

/** Keeps only known controls, clamps sliders to range and step, and fills in defaults. */
export function sanitizeParams(algorithm: AlgorithmDefinition, raw: unknown, warnings: string[] = []): Params {
  const params = defaultParams(algorithm);
  if (raw === undefined) return params;
  if (!isRecord(raw)) {
    warnings.push("Invalid params; using defaults.");
    return params;
  }
  for (const control of algorithm.controls) {
    const v = raw[control.id];
    if (v === undefined) continue;
    switch (control.kind) {
      case "slider":
        if (typeof v === "number" && Number.isFinite(v)) {
          const stepped = Math.round((v - control.min) / control.step) * control.step + control.min;
          params[control.id] = Math.min(control.max, Math.max(control.min, stepped));
        } else warnings.push(`Invalid value for "${control.label}"; using ${control.default}.`);
        break;
      case "toggle":
        if (typeof v === "boolean") params[control.id] = v;
        else warnings.push(`Invalid value for "${control.label}"; using ${control.default ? "on" : "off"}.`);
        break;
      case "select":
        if (typeof v === "string" && control.options.some((o) => o.value === v)) params[control.id] = v;
        else warnings.push(`Invalid value for "${control.label}"; using ${control.default}.`);
        break;
    }
  }
  for (const key of Object.keys(raw)) {
    if (!algorithm.controls.some((c) => c.id === key)) warnings.push(`Ignored unknown setting "${key}".`);
  }
  return params;
}

/** Compact, URL-safe encoding for sharing in a link. */
export function encodePreset(preset: Preset): string {
  const bytes = new TextEncoder().encode(JSON.stringify(preset));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePreset(encoded: string): { preset: Preset; warnings: string[] } {
  let json: unknown;
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    throw new PresetError("This link's settings are damaged or incomplete.");
  }
  return parsePreset(json);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}
