import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR } from "../src/colorspace.ts";
import { getPalette } from "../src/palettes.ts";
import { runPipeline } from "../src/pipeline.ts";
import { ditherLayer } from "../src/preset.ts";
import { defaultParams, getAlgorithm } from "../src/registry.ts";
import { SteadyDither } from "../src/steady.ts";
import type { PixelBuffer } from "../src/types.ts";

const W = 96;
const H = 64;
const mono = getPalette("mono").colors;
const fs = getAlgorithm("floyd-steinberg");
const dither = (img: PixelBuffer) => fs.run(img, mono, defaultParams(fs), { seed: 1, color: DEFAULT_COLOR });

/** A gradient with an optional bright square at `squareX`, plus per-frame noise of ±`noise`. */
function frame(seed: number, { noise = 3, squareX = -1, lift = 0 } = {}): PixelBuffer {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed * 2654435761;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inSquare = squareX >= 0 && x >= squareX && x < squareX + 16 && y >= 24 && y < 40;
      const v = (inSquare ? 230 : (x / W) * 200 + 20) + lift + rand() * noise;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** Share of pixels whose colour differs between two outputs. */
function changed(a: PixelBuffer, b: PixelBuffer, region?: (x: number, y: number) => boolean): number {
  let n = 0;
  let total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (region && !region(x, y)) continue;
      total++;
      const i = (y * W + x) * 4;
      if (a.data[i] !== b.data[i]) n++;
    }
  }
  return n / total;
}

const mean = (img: PixelBuffer) => {
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 4) sum += img.data[i]!;
  return sum / (img.data.length / 4);
};

describe("SteadyDither", () => {
  it("stops a still, noisy scene from shimmering", () => {
    const plain: number[] = [];
    const steady: number[] = [];
    const s = new SteadyDither();
    let prevPlain = dither(frame(0));
    let prevSteady = s.apply(frame(0), prevPlain);
    for (let f = 1; f <= 6; f++) {
      const input = frame(f);
      const out = dither(input);
      plain.push(changed(prevPlain, out));
      const st = s.apply(input, out);
      steady.push(changed(prevSteady, st));
      prevPlain = out;
      prevSteady = st;
    }
    // Without it, a large share of the dots move every frame; with it, none do.
    expect(Math.min(...plain)).toBeGreaterThan(0.1);
    expect(Math.max(...steady)).toBe(0);
  });

  it("still follows things that move", () => {
    const s = new SteadyDither();
    const first = s.apply(frame(0, { squareX: 10 }), dither(frame(0, { squareX: 10 })));
    const moved = frame(1, { squareX: 50 });
    const out = s.apply(moved, dither(moved));
    // Where the square arrived, the output must show it (bright), not the old gradient.
    const inNewSquare = (x: number, y: number) => x >= 50 && x < 66 && y >= 24 && y < 40;
    expect(changed(first, out, inNewSquare)).toBeGreaterThan(0.3);
    let white = 0;
    for (let y = 24; y < 40; y++) for (let x = 50; x < 66; x++) if (out.data[(y * W + x) * 4] === 255) white++;
    expect(white / 256).toBeGreaterThan(0.8);
  });

  it("can't drift during a slow fade: blocks refresh once the change adds up", () => {
    const s = new SteadyDither({ block: 8, threshold: 4 });
    let out = s.apply(frame(0, { noise: 0 }), dither(frame(0, { noise: 0 })));
    for (let f = 1; f <= 40; f++) {
      const input = frame(f, { noise: 0, lift: f }); // one level brighter per frame
      out = s.apply(input, dither(input));
    }
    const target = dither(frame(40, { noise: 0, lift: 40 }));
    // Within the threshold's worth of tone of a fresh dither of the final frame.
    expect(Math.abs(mean(out) - mean(target))).toBeLessThan(8);
  });

  it("starts over when the size changes or on reset", () => {
    const s = new SteadyDither();
    s.apply(frame(0), dither(frame(0)));
    const small: PixelBuffer = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) };
    expect(s.apply(small, small).data).toEqual(small.data);
    s.reset();
    const f = frame(3);
    expect(s.apply(f, dither(f)).data).toEqual(dither(f).data);
  });

  it("runs in the pipeline after the dither layer, and not for styles that keep colours", () => {
    const steady = new SteadyDither();
    const settings = { layers: [ditherLayer("floyd-steinberg")], palette: mono, seed: 1, color: DEFAULT_COLOR, steady };
    const a = runPipeline(frame(0), settings);
    const b = runPipeline(frame(1), settings);
    expect(changed(a, b)).toBe(0);
    const none = { ...settings, layers: [ditherLayer("none")] };
    const input = frame(2);
    expect(runPipeline(input, none).data).toEqual(input.data);
  });
});
