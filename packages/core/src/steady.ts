import type { PixelBuffer } from "./types.ts";

export interface SteadyOptions {
  /** Block size in working pixels. Smaller blocks follow motion more closely. */
  block: number;
  /** Mean change per channel (0–255) a block's input must exceed before it's dithered again. */
  threshold: number;
}

export const DEFAULT_STEADY: SteadyOptions = { block: 8, threshold: 4 };

/**
 * Keeps dithered video steady. Dithering each frame from scratch re-scatters
 * the dots wherever the input differs even slightly (compression noise,
 * sensor grain), which shimmers. This keeps the previous frame's dots for
 * every block whose input hasn't really changed, and takes the new frame's
 * dots where it has.
 *
 * Each block is compared with the input it was last dithered from, not just
 * the previous frame, so a slow fade can't drift: once a block has changed by
 * more than the threshold in total, it refreshes.
 */
export class SteadyDither {
  private readonly options: SteadyOptions;
  /** Per block: the input it was last dithered from, and the dots it got. */
  private reference: Uint8ClampedArray | null = null;
  private previous: Uint8ClampedArray | null = null;
  private width = 0;
  private height = 0;

  constructor(options: SteadyOptions = DEFAULT_STEADY) {
    this.options = { block: Math.max(1, Math.round(options.block)), threshold: Math.max(0, options.threshold) };
  }

  /** Forgets the previous frame, so the next one is dithered in full. */
  reset(): void {
    this.reference = null;
    this.previous = null;
  }

  /**
   * Merges a freshly dithered frame with the previous one. `input` is the
   * image as it went into the dither layer and `dithered` is that layer's
   * output; both must be the same size. Returns a new buffer.
   */
  apply(input: PixelBuffer, dithered: PixelBuffer): PixelBuffer {
    const { width: w, height: h } = dithered;
    if (input.width !== w || input.height !== h) throw new Error("SteadyDither: input and output sizes differ");
    if (!this.reference || !this.previous || w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.reference = input.data.slice();
      this.previous = dithered.data.slice();
      return { width: w, height: h, data: dithered.data.slice() };
    }
    const { block, threshold } = this.options;
    const src = input.data;
    const ref = this.reference;
    const prev = this.previous;
    const fresh = dithered.data;
    for (let by = 0; by < h; by += block) {
      const y1 = Math.min(h, by + block);
      for (let bx = 0; bx < w; bx += block) {
        const x1 = Math.min(w, bx + block);
        let diff = 0;
        for (let y = by; y < y1; y++) {
          for (let i = (y * w + bx) * 4, end = (y * w + x1) * 4; i < end; i += 4) {
            diff += Math.abs(src[i]! - ref[i]!) + Math.abs(src[i + 1]! - ref[i + 1]!) + Math.abs(src[i + 2]! - ref[i + 2]!);
          }
        }
        if (diff / ((y1 - by) * (x1 - bx) * 3) <= threshold) continue; // unchanged: keep its dots
        for (let y = by; y < y1; y++) {
          const start = (y * w + bx) * 4;
          const end = (y * w + x1) * 4;
          prev.set(fresh.subarray(start, end), start);
          ref.set(src.subarray(start, end), start);
        }
      }
    }
    return { width: w, height: h, data: prev.slice() };
  }
}
