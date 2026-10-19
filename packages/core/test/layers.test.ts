import { describe, expect, it } from "vitest";
import { insertLayerAfter, moveLayer, removeLayer } from "../src/layers.ts";
import { ditherLayer, effectLayer } from "../src/preset.ts";
import type { Layer } from "../src/types.ts";

const stack = (): Layer[] => [
  { ...effectLayer("adjust"), id: "a" },
  { ...ditherLayer(), id: "d" },
  { ...effectLayer("tint"), id: "t" },
  { ...effectLayer("vignette"), id: "v" },
];
const ids = (ls: readonly Layer[]) => ls.map((l) => l.id).join("");

describe("moveLayer (drop before the row at an index)", () => {
  it.each([
    ["a", 0, "adtv"], // already there
    ["a", 1, "adtv"], // dropping just below itself is a no-op
    ["a", 2, "datv"],
    ["a", 4, "dtva"], // to the end
    ["v", 0, "vadt"], // to the top
    ["v", 3, "adtv"], // just above itself: no-op
    ["t", 1, "atdv"], // moving an effect above the dither
    ["d", 4, "atvd"], // dither to the bottom
    ["a", 99, "dtva"], // clamped
    ["v", -5, "vadt"], // clamped
  ] as const)("moving %s to %i gives %s", (id, to, expected) => {
    expect(ids(moveLayer(stack(), id, to))).toBe(expected);
  });

  it("returns the same array when nothing moves", () => {
    const s = stack();
    expect(moveLayer(s, "a", 1)).toBe(s);
    expect(moveLayer(s, "missing", 0)).toBe(s);
  });

  it("supports Alt+arrow semantics: up = index−1, down = index+2", () => {
    expect(ids(moveLayer(stack(), "t", 2 - 1))).toBe("atdv");
    expect(ids(moveLayer(stack(), "t", 2 + 2))).toBe("advt");
  });
});

describe("insertLayerAfter", () => {
  it("inserts after the given layer, or at the end", () => {
    const x = { ...effectLayer("invert"), id: "x" };
    expect(ids(insertLayerAfter(stack(), "d", x))).toBe("adxtv");
    expect(ids(insertLayerAfter(stack(), "v", x))).toBe("adtvx");
    expect(ids(insertLayerAfter(stack(), "missing", x))).toBe("adtvx");
  });
});

describe("removeLayer", () => {
  it("removes effects but never the dither layer", () => {
    expect(ids(removeLayer(stack(), "t"))).toBe("adv");
    const s = stack();
    expect(removeLayer(s, "d")).toBe(s);
  });
});
