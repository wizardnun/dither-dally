import { decodePreset, defaultPreset, encodePreset, parsePreset, PresetError, type Preset } from "@dither-dally/core";

const HASH_KEY = "p";

/** Reads a preset from `#p=…` in the URL. Returns null if there is none. */
export function presetFromHash(hash: string): { preset: Preset; warnings: string[] } | { error: string } | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(HASH_KEY);
  if (!value) return null;
  try {
    return decodePreset(value);
  } catch (err) {
    return { error: err instanceof PresetError ? err.message : "This link's settings couldn't be read." };
  }
}

export function hashForPreset(preset: Preset): string {
  return `#${HASH_KEY}=${encodePreset(preset)}`;
}

/** The preset to start with: from the link if it has a valid one, otherwise defaults. */
export function initialPreset(): { preset: Preset; notice: string | null } {
  const fromLink = presetFromHash(window.location.hash);
  if (!fromLink) return { preset: defaultPreset(), notice: null };
  if ("error" in fromLink) return { preset: defaultPreset(), notice: `${fromLink.error} Showing the default settings.` };
  return { preset: fromLink.preset, notice: noticeFor("Loaded settings from the link.", fromLink.warnings) };
}

export async function presetFromFile(file: File): Promise<{ preset: Preset; warnings: string[] }> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new PresetError(`"${file.name}" isn't a valid preset file (it isn't JSON).`);
  }
  return parsePreset(json);
}

export function downloadPreset(preset: Preset, name: string): void {
  const blob = new Blob([JSON.stringify(preset, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.dither-dally.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function noticeFor(message: string, warnings: string[]): string {
  return warnings.length ? `${message} Some values were adjusted: ${warnings.join(" ")}` : message;
}
