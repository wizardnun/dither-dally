import { toHex } from "./color.ts";
import type { Palette, RGB } from "./types.ts";

/** Most colours a custom palette may hold; kept in step with CUSTOM_PALETTE_SIZE in preset.ts. */
const MAX_COLORS = 256;

export class PaletteFileError extends Error {}

export interface ParsedPalette {
  name: string;
  colors: Palette;
  /** Things worth telling the user, such as duplicates removed. */
  warnings: string[];
}

/**
 * Reads a palette file in any of the common formats, detected from its
 * contents: GIMP / Inkscape / Krita (.gpl), JASC / Paint Shop Pro (.pal),
 * Paint.NET (.txt, AARRGGBB per line) and plain hex lists (.hex, one
 * RRGGBB per line, as Lospec exports). Duplicate colours are dropped.
 */
export function parsePaletteFile(text: string, fileName = ""): ParsedPalette {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim());
  const first = lines.find((l) => l !== "") ?? "";
  let name = fileName.replace(/\.[^.]+$/, "");
  let found: RGB[];

  if (/^GIMP Palette/i.test(first)) {
    found = [];
    for (const line of lines.slice(lines.indexOf(first) + 1)) {
      const header = /^Name:\s*(.+)$/i.exec(line);
      if (header) name = header[1]!;
      const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(line);
      if (m) found.push(rgb(m[1]!, m[2]!, m[3]!));
    }
  } else if (/^JASC-PAL/i.test(first)) {
    found = [];
    // Header: JASC-PAL, a version line, then the colour count.
    for (const line of lines.slice(lines.indexOf(first) + 3)) {
      const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(line);
      if (m) found.push(rgb(m[1]!, m[2]!, m[3]!));
    }
  } else {
    // Hex lists: RRGGBB or #RRGGBB (Lospec), or AARRGGBB (Paint.NET); ";" starts a comment.
    found = [];
    for (const line of lines) {
      const m = /^#?(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(line.split(";")[0]!.trim());
      if (m) found.push(rgb(...hexChannels(m[1]!)));
    }
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  let colors = found.filter((c) => {
    const key = toHex(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (colors.length < found.length) {
    const n = found.length - colors.length;
    warnings.push(`Removed ${n} duplicate colour${n > 1 ? "s" : ""}.`);
  }
  if (colors.length < 2) {
    throw new PaletteFileError(
      colors.length === 0
        ? "This file doesn't contain any colours we can read. Supported: .gpl, .pal (JASC), .hex and Paint.NET .txt palettes."
        : "This palette has only one colour; a palette needs at least two.",
    );
  }
  if (colors.length > MAX_COLORS) {
    warnings.push(`Kept the first ${MAX_COLORS} of ${colors.length} colours.`);
    colors = colors.slice(0, MAX_COLORS);
  }
  return { name: name.trim().slice(0, 40) || "Imported", colors, warnings };
}

/** Writes a palette as a GIMP palette file (.gpl), which most image editors can open. */
export function toGpl(name: string, colors: Palette): string {
  const rows = colors.map(([r, g, b]) => `${pad(r)} ${pad(g)} ${pad(b)}\t${toHex([r, g, b])}`);
  return `GIMP Palette\nName: ${name.replace(/[\r\n]/g, " ")}\nColumns: ${Math.min(colors.length, 16)}\n#\n${rows.join("\n")}\n`;
}

function rgb(r: string | number, g: string | number, b: string | number): RGB {
  const c: RGB = [Number(r), Number(g), Number(b)];
  if (c.some((v) => v > 255)) throw new PaletteFileError(`Colour values must be 0–255; found ${c.join(" ")}.`);
  return c;
}

function hexChannels(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const pad = (v: number) => String(v).padStart(3, " ");
