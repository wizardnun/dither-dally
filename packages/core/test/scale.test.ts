import { describe, expect, it } from "vitest";
import { scaleLayers } from "../src/pipeline.ts";
import { ditherLayer, effectLayer } from "../src/preset.ts";
import type { Layer } from "../src/types.ts";

describe("scaleLayers (full-size render keeps proportions)", () => {
  const halftone: Layer = { ...ditherLayer("halftone"), params: { ...ditherLayer("halftone").params, cell: 8, angle: 45 } };
  const blur: Layer = { ...effectLayer("blur"), params: { radius: 2.5 } };
  const rowShift: Layer = { ...effectLayer("row-shift"), params: { ...effectLayer("row-shift").params, distance: 0, band: 3 } };

  it("multiplies pixel distances and leaves other settings alone", () => {
    const [h] = scaleLayers([halftone], 2.5);
    expect(h!.params.cell).toBe(20);
    expect(h!.params.angle).toBe(45);
  });

  it("keeps whole-pixel settings whole and fractional ones exact", () => {
    const [h, b] = scaleLayers([halftone, blur], 1.3);
    expect(h!.params.cell).toBe(10); // 8 × 1.3 = 10.4, rounded
    expect(b!.params.radius).toBeCloseTo(3.25);
  });

  it("keeps zero at zero and anything above zero at least 1", () => {
    const [r] = scaleLayers([rowShift], 0.1);
    expect(r!.params.distance).toBe(0);
    expect(r!.params.band).toBe(1);
  });

  it("fills in defaults for missing settings before scaling", () => {
    const bare: Layer = { ...ditherLayer("halftone"), params: {} };
    const [h] = scaleLayers([bare], 2);
    expect(h!.params.cell).toBe(16); // default 8
  });

  it("is a copy at factor 1 and never changes its input", () => {
    const input = [halftone, blur];
    const out = scaleLayers(input, 1);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    scaleLayers(input, 3);
    expect(halftone.params.cell).toBe(8);
  });
});
