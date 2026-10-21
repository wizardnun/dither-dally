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
    id: "pico-8",
    name: "PICO-8",
    source: "The PICO-8 fantasy console palette by Lexaloffle, released under CC0.",
    colors: paletteFromHex([
      "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ]),
  },
  {
    id: "rgb-8",
    name: "RGB cube",
    source: "The 8 corners of the RGB cube.",
    colors: paletteFromHex(["#000000", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ffffff"]),
  },
  {
    id: "web-216",
    name: "Web-safe",
    source: "The 216 web-safe colours: every mix of 00, 33, 66, 99, CC and FF per channel.",
    colors: webSafe(),
  },
];

function webSafe(): Palette {
  const steps = [0, 0x33, 0x66, 0x99, 0xcc, 0xff];
  return steps.flatMap((r) => steps.flatMap((g) => steps.map((b) => [r, g, b] as const))) as Palette;
}

export function getPalette(id: string): NamedPalette {
  const p = PALETTES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown palette "${id}"`);
  return p;
}
