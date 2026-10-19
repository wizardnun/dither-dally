import { paletteFromHex } from "./color.ts";
import type { Palette } from "./types.ts";

export interface NamedPalette {
  id: string;
  name: string;
  /** Where the colours come from. Every built-in palette must say. */
  source: string;
  colors: Palette;
}

export const PALETTES: readonly NamedPalette[] = [
  {
    id: "mono",
    name: "1-bit",
    source: "Black and white.",
    colors: paletteFromHex(["#000000", "#ffffff"]),
  },
  {
    id: "grey-4",
    name: "4 greys",
    source: "Evenly spaced sRGB greys.",
    colors: paletteFromHex(["#000000", "#555555", "#aaaaaa", "#ffffff"]),
  },
  {
    id: "cga-4",
    name: "CGA mode 4",
    source: "IBM CGA 320×200 palette 1, high intensity.",
    colors: paletteFromHex(["#000000", "#55ffff", "#ff55ff", "#ffffff"]),
  },
  {
    id: "ega-16",
    name: "EGA 16",
    source: "IBM EGA default 16-colour palette.",
    colors: paletteFromHex([
      "#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
      "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff",
    ]),
  },
  {
    id: "handheld-4",
    name: "Handheld green",
    source: "Four greens in the style of early monochrome handheld LCDs.",
    colors: paletteFromHex(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]),
  },
  {
    id: "rgb-8",
    name: "RGB cube",
    source: "The 8 corners of the RGB cube.",
    colors: paletteFromHex(["#000000", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ffffff"]),
  },
];

export function getPalette(id: string): NamedPalette {
  const p = PALETTES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown palette "${id}"`);
  return p;
}
