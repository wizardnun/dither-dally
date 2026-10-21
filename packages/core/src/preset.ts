import { paletteFromHex, toHex } from "./color.ts";
import { DEFAULT_COLOR, type ColorSettings } from "./colorspace.ts";
import { EFFECTS } from "./effects.ts";
import { PALETTES } from "./palettes.ts";
import { ALGORITHMS, defaultParams } from "./registry.ts";
import type { Control, DitherLayer, EffectLayer, Layer, Palette, Params } from "./types.ts";

export const PRESET_VERSION = 2;
export const PIXEL_SIZE_RANGE = { min: 1, max: 8 } as const;
export const MAX_LAYERS = 32;
export const CUSTOM_PALETTE_SIZE = { min: 2, max: 256 } as const;

/** A palette made by the user (e.g. extracted from an image), stored in the preset itself. */
export interface CustomPalette {
  name: string;
  /** 6-digit hex colours. */
  colors: string[];
}

/** A built-in palette id, or a custom palette carried in the preset. */
export type PaletteRef = string | CustomPalette;

/** Everything needed to reproduce a look, except the image itself. */
export interface Preset {
  version: typeof PRESET_VERSION;
  /** Run top to bottom. Always contains exactly one dither layer. */
  layers: Layer[];
  palette: PaletteRef;
  pixelSize: number;
  seed: number;
  color: ColorSettings;
}

export class PresetError extends Error {
  override name = "PresetError";
}

export function newLayerId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function ditherLayer(algorithmId = "floyd-steinberg"): DitherLayer {
  const algorithm = ALGORITHMS.find((a) => a.id === algorithmId) ?? ALGORITHMS[0]!;
  return { id: newLayerId(), kind: "dither", enabled: true, algorithm: algorithm.id, params: defaultParams(algorithm) };
}

export function effectLayer(effectId: string): EffectLayer {
  const effect = EFFECTS.find((e) => e.id === effectId);
  if (!effect) throw new Error(`Unknown effect "${effectId}"`);
  return { id: newLayerId(), kind: "effect", enabled: true, effect: effect.id, params: defaultParams(effect) };
}

export function defaultPreset(algorithmId = "floyd-steinberg"): Preset {
  return {
    version: PRESET_VERSION,
    layers: [ditherLayer(algorithmId)],
    palette: "mono",
    pixelSize: 2,
    seed: 1,
    color: { ...DEFAULT_COLOR },
  };
}

export function resolvePalette(ref: PaletteRef): Palette {
  if (typeof ref !== "string") return paletteFromHex(ref.colors);
  return (PALETTES.find((p) => p.id === ref) ?? PALETTES[0]!).colors;
}

export function customPalette(name: string, colors: Palette): CustomPalette {
  return { name, colors: colors.map(toHex) };
}

/** The document's dither layer. Every valid preset has exactly one. */
export function getDitherLayer(preset: Pick<Preset, "layers">): DitherLayer {
  const d = preset.layers.find((l): l is DitherLayer => l.kind === "dither");
  if (!d) throw new PresetError("This document has no dither layer.");
  return d;
}

/**
 * Validates untrusted input (a file or a shared link) into a usable preset.
 * Reads version 1 (single algorithm) and version 2 (layers). Throws
 * PresetError if it can't be used at all; otherwise fixes what it can and
 * reports each fix in `warnings`.
 */
export function parsePreset(input: unknown): { preset: Preset; warnings: string[] } {
  if (!isRecord(input)) throw new PresetError("A preset must be a JSON object.");
  if (input.version === 1) return parsePreset(migrateV1(input));
  if (input.version !== PRESET_VERSION) {
    throw new PresetError(
      `Unsupported preset version ${JSON.stringify(input.version)}. This app reads versions 1 and ${PRESET_VERSION}.`,
    );
  }
  const warnings: string[] = [];
  const base = defaultPreset();

  const layers = parseLayers(input.layers, warnings);

  let palette: PaletteRef = base.palette;
  if (typeof input.palette === "string" && PALETTES.some((p) => p.id === input.palette)) palette = input.palette;
  else if (isRecord(input.palette)) {
    const custom = parseCustomPalette(input.palette);
    if (custom) palette = custom;
    else warnings.push("The custom palette was invalid; using 1-bit.");
  } else warnings.push(`Unknown palette ${JSON.stringify(input.palette)}; using 1-bit.`);

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
      layers,
      palette,
      pixelSize: pixelSize ?? base.pixelSize,
      seed: seed ?? base.seed,
      color,
    },
    warnings,
  };
}

/** Version 1 had a single algorithm and its params at the top level. */
function migrateV1(v1: Record<string, unknown>): Record<string, unknown> {
  const algorithm = ALGORITHMS.find((a) => a.id === v1.algorithm);
  if (!algorithm) throw new PresetError(`Unknown algorithm ${JSON.stringify(v1.algorithm)}.`);
  const { algorithm: _a, params, ...rest } = v1;
  return {
    ...rest,
    version: 2,
    layers: [{ id: newLayerId(), kind: "dither", enabled: true, algorithm: algorithm.id, params }],
  };
}

function parseLayers(raw: unknown, warnings: string[]): Layer[] {
  if (!Array.isArray(raw)) throw new PresetError("A preset needs a list of layers.");
  const layers: Layer[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const item of raw.slice(0, MAX_LAYERS)) {
    if (!isRecord(item)) {
      dropped++;
      continue;
    }
    let id = typeof item.id === "string" && /^[\w-]{1,64}$/.test(item.id) ? item.id : newLayerId();
    while (ids.has(id)) id = newLayerId();
    ids.add(id);
    const enabled = typeof item.enabled === "boolean" ? item.enabled : true;
    if (item.kind === "dither") {
      const algorithm = ALGORITHMS.find((a) => a.id === item.algorithm);
      if (!algorithm) {
        warnings.push(`Unknown style ${JSON.stringify(item.algorithm)}; using Floyd–Steinberg.`);
        layers.push({ ...ditherLayer(), id, enabled });
        continue;
      }
      if (layers.some((l) => l.kind === "dither")) {
        warnings.push("Only one dither layer is supported; extra ones were removed.");
        continue;
      }
      layers.push({ id, kind: "dither", enabled, algorithm: algorithm.id, params: sanitizeParams(algorithm, item.params, warnings) });
    } else if (item.kind === "effect") {
      const effect = EFFECTS.find((e) => e.id === item.effect);
      if (!effect) {
        warnings.push(`Unknown effect ${JSON.stringify(item.effect)} was removed.`);
        continue;
      }
      layers.push({ id, kind: "effect", enabled, effect: effect.id, params: sanitizeParams(effect, item.params, warnings) });
    } else {
      dropped++;
    }
  }
  if (raw.length > MAX_LAYERS) warnings.push(`Only the first ${MAX_LAYERS} layers were kept.`);
  if (dropped) warnings.push(`${dropped} unreadable layer${dropped > 1 ? "s were" : " was"} removed.`);
  if (!layers.some((l) => l.kind === "dither")) {
    warnings.push("No dither layer found; added Floyd–Steinberg.");
    layers.push(ditherLayer());
  }
  return layers;
}

function parseCustomPalette(raw: Record<string, unknown>): CustomPalette | null {
  if (!Array.isArray(raw.colors)) return null;
  const colors = raw.colors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase());
  if (colors.length < CUSTOM_PALETTE_SIZE.min || colors.length > CUSTOM_PALETTE_SIZE.max) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : "Custom";
  return { name, colors };
}

/** Keeps only known controls, clamps sliders to range and step, and fills in defaults. */
export function sanitizeParams(def: { controls: readonly Control[] }, raw: unknown, warnings: string[] = []): Params {
  const params = defaultParams(def);
  if (raw === undefined) return params;
  if (!isRecord(raw)) {
    warnings.push("Invalid settings; using defaults.");
    return params;
  }
  for (const control of def.controls) {
    const v = raw[control.id];
    if (v === undefined) continue;
    switch (control.kind) {
      case "slider":
        if (typeof v === "number" && Number.isFinite(v)) {
          const stepped = Math.round((v - control.min) / control.step) * control.step + control.min;
          // Round away float noise from fractional steps (0.1 + 0.2 …).
          params[control.id] = Number(Math.min(control.max, Math.max(control.min, stepped)).toFixed(6));
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
      case "color":
        if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) params[control.id] = v.toLowerCase();
        else warnings.push(`Invalid colour for "${control.label}"; using ${control.default}.`);
        break;
      case "text":
        if (typeof v === "string") {
          if ([...v].length > control.maxLength) warnings.push(`"${control.label}" was too long and was shortened.`);
          params[control.id] = [...v].slice(0, control.maxLength).join("");
        } else warnings.push(`Invalid text for "${control.label}"; using the default.`);
        break;
    }
  }
  for (const key of Object.keys(raw)) {
    if (!def.controls.some((c) => c.id === key)) warnings.push(`Ignored unknown setting "${key}".`);
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
