import { describe, expect, it } from "vitest";
import { KERNELS } from "../src/diffusion.ts";
import { bayerMatrix } from "../src/ordered.ts";
import { nearestIndex, paletteSpread, parseHex, toHex } from "../src/color.ts";
import { getPalette } from "../src/palettes.ts";

describe("diffusion kernels", () => {
  it.each(KERNELS.map((k) => [k.id, k] as const))("%s only pushes error forward", (_id, k) => {
    for (const [dx, dy] of k.taps) expect(dy > 0 || (dy === 0 && dx > 0)).toBe(true);
  });

  it.each(KERNELS.filter((k) => k.id !== "atkinson").map((k) => [k.id, k] as const))(
    "%s weights sum to the divisor",
    (_id, k) => {
      expect(k.taps.reduce((s, [, , w]) => s + w, 0)).toBe(k.divisor);
    },
  );

  it("atkinson deliberately diffuses 6/8 of the error", () => {
    const k = KERNELS.find((x) => x.id === "atkinson")!;
    expect(k.taps.reduce((s, [, , w]) => s + w, 0) / k.divisor).toBe(0.75);
  });

  it("ids are unique", () => {
    expect(new Set(KERNELS.map((k) => k.id)).size).toBe(KERNELS.length);
  });
});

describe("bayerMatrix", () => {
  it("builds the standard 2×2", () => {
    expect(bayerMatrix(2)).toEqual([[0, 2], [3, 1]]);
  });

  it("builds the standard 4×4", () => {
    expect(bayerMatrix(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });

  it.each([8, 16])("%i×%i is a permutation of 0..n²-1", (n) => {
    const values = bayerMatrix(n).flat().sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: n * n }, (_, i) => i));
  });

  it("rejects sizes that aren't powers of two", () => {
    expect(() => bayerMatrix(3)).toThrow();
  });
});

describe("colour helpers", () => {
  it("round-trips hex", () => {
    expect(toHex(parseHex("#0F380f"))).toBe("#0f380f");
  });

  it("rejects malformed hex", () => {
    expect(() => parseHex("#fff")).toThrow();
  });

  it("finds the nearest palette entry", () => {
    const mono = getPalette("mono").colors;
    expect(nearestIndex(mono, 30, 30, 30)).toBe(0);
    expect(nearestIndex(mono, 200, 200, 200)).toBe(1);
  });

  it("measures palette spacing", () => {
    expect(paletteSpread(getPalette("mono").colors)).toBeCloseTo(255);
    expect(paletteSpread(getPalette("grey-4").colors)).toBeCloseTo(85);
  });
});
