import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  getFirstEncodableVideoCodec,
  type InputVideoTrack,
} from "mediabunny";
import { scaleLayers, type ColorSettings, type Layer, type RGB, type SteadyOptions } from "@dither-dally/core";
import { MAX_SIDE } from "./image.ts";
import { createRenderWorker, renderOnce } from "./useDither.ts";

export interface VideoInfo {
  /** Preview frame size (long side ≤ MAX_SIDE). */
  width: number;
  height: number;
  /** The video's own display size. */
  sourceWidth: number;
  sourceHeight: number;
  /** Seconds. */
  duration: number;
  /** First frame timestamp, seconds (often 0). */
  start: number;
  hasAudio: boolean;
}

// This module pulls in mediabunny (~550 KB); the app imports it lazily, only once a video is opened.

/**
 * An opened video file. Frames come back as canvases sized to the preview
 * (long side ≤ MAX_SIDE), the same size an image would be worked on.
 */
export class VideoSession {
  readonly file: File;
  readonly info: VideoInfo;
  private readonly input: Input;
  private readonly sink: CanvasSink;

  private constructor(file: File, input: Input, sink: CanvasSink, info: VideoInfo) {
    this.file = file;
    this.input = input;
    this.sink = sink;
    this.info = info;
  }

  static async open(file: File): Promise<VideoSession> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`"${file.name}" has no video track.`);
    if (!(await track.canDecode())) throw new Error(`This browser can't decode the video in "${file.name}".`);
    const fit = Math.min(1, MAX_SIDE / Math.max(track.displayWidth, track.displayHeight));
    const width = Math.max(2, Math.round(track.displayWidth * fit));
    const height = Math.max(2, Math.round(track.displayHeight * fit));
    const sink = new CanvasSink(track as InputVideoTrack, { width, height, fit: "fill" });
    const start = await track.getFirstTimestamp();
    const duration = await input.computeDuration();
    const hasAudio = (await input.getPrimaryAudioTrack()) !== null;
    const info = { width, height, sourceWidth: track.displayWidth, sourceHeight: track.displayHeight, duration, start, hasAudio };
    return new VideoSession(file, input, sink, info);
  }

  /**
   * Set once direct frame lookup has failed for this file. Files without a
   * seek index (common for browser and screen recordings) can't be looked up
   * directly, but can still be read sequentially from any point.
   */
  private sequentialOnly = false;

  /** The frame showing at time `t` (seconds). */
  async frameAt(t: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
    const at = Math.max(this.info.start, t);
    if (!this.sequentialOnly) {
      const wrapped = await this.sink.getCanvas(at);
      if (wrapped || at <= this.info.start) return wrapped?.canvas ?? null;
      this.sequentialOnly = true;
    }
    for await (const wrapped of this.sink.canvases(at)) return wrapped.canvas;
    return null;
  }

  /**
   * Plays from `from` in real time, calling `onFrame` for each frame that's
   * due. Frames that arrive late are skipped so playback keeps pace. Resolves
   * when the video ends or `signal` aborts.
   */
  async play(from: number, signal: AbortSignal, onFrame: (canvas: HTMLCanvasElement | OffscreenCanvas, t: number) => void) {
    const t0 = performance.now();
    for await (const wrapped of this.sink.canvases(Math.max(this.info.start, from))) {
      if (signal.aborted) return;
      const due = (wrapped.timestamp - from) * 1000;
      const now = performance.now() - t0;
      if (now - due > 120) continue; // too late: drop it
      if (due > now) await new Promise((r) => setTimeout(r, due - now));
      if (signal.aborted) return;
      onFrame(wrapped.canvas, wrapped.timestamp);
    }
  }

  dispose() {
    this.input.dispose?.();
  }
}

/** Longest side of a full-size video export: 4K, which hardware encoders handle widely. */
export const VIDEO_FULL_MAX_SIDE = 3840;

export interface VideoExportJob {
  file: File;
  layers: Layer[];
  palette: RGB[];
  seed: number;
  color: ColorSettings;
  pixelSize: number;
  /** "preview": the preview's resolution. "full": the video's own, up to VIDEO_FULL_MAX_SIDE. */
  size: "preview" | "full";
  /** Keep dots steady between frames; sizes are in preview pixels and scale with the export. */
  steady?: SteadyOptions;
}

/** Output size of a video export, kept even as H.264 requires. */
export function videoExportSize(video: { width: number; height: number }, pixelSize: number, maxSide: number) {
  const fit = Math.min(1, maxSide / Math.max(video.width, video.height));
  let w = Math.max(2, Math.round((video.width * fit) / pixelSize));
  let h = Math.max(2, Math.round((video.height * fit) / pixelSize));
  if ((w * pixelSize) % 2) w -= 1;
  if ((h * pixelSize) % 2) h -= 1;
  return { w, h, outW: w * pixelSize, outH: h * pixelSize };
}

export interface VideoExportHandle {
  /** Resolves with the encoded file. Rejects with VideoExportCanceled if cancelled. */
  done: Promise<{ blob: Blob; extension: string }>;
  cancel: () => void;
}

export class VideoExportCanceled extends Error {
  override name = "VideoExportCanceled";
}

/**
 * Re-encodes a video with every frame run through the style and effects, at
 * the preview's resolution or the video's own (then scaled up by the pixel
 * size with hard edges). At full size, distance settings and the steady-dots
 * blocks scale with the frame so the look matches the preview. The audio
 * track is copied over unchanged when possible.
 */
export function exportVideo(job: VideoExportJob, onProgress: (fraction: number) => void): VideoExportHandle {
  let conversion: Conversion | null = null;
  let cancelled = false;
  const worker = createRenderWorker();

  const done = (async () => {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("This file has no video track.");
      const display = { width: track.displayWidth, height: track.displayHeight };
      const { w, h, outW, outH } = videoExportSize(display, job.pixelSize, job.size === "full" ? VIDEO_FULL_MAX_SIDE : MAX_SIDE);
      // How much larger than the preview each frame is; settings in pixels scale by this.
      const factor = w / videoExportSize(display, job.pixelSize, MAX_SIDE).w;
      const layers = scaleLayers(job.layers, factor);
      const steady = job.steady && { ...job.steady, block: Math.max(1, Math.round(job.steady.block * factor)) };

      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      const codec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), { width: outW, height: outH });
      if (!codec) {
        throw new Error(
          job.size === "full"
            ? `This browser can't encode video at ${outW} × ${outH}. Try "As previewed".`
            : "This browser can't encode video. Try a recent version of Chrome, Edge, Safari or Firefox.",
        );
      }

      const work = new OffscreenCanvas(w, h);
      const workCtx = work.getContext("2d", { willReadFrequently: true })!;
      workCtx.imageSmoothingQuality = "high";
      const small = new OffscreenCanvas(w, h);
      const smallCtx = small.getContext("2d")!;

      conversion = await Conversion.init({
        input,
        output,
        showWarnings: false,
        video: {
          codec,
          forceTranscode: true,
          processedWidth: outW,
          processedHeight: outH,
          process: async (sample) => {
            sample.draw(workCtx, 0, 0, w, h);
            const frame = workCtx.getImageData(0, 0, w, h);
            const result = await renderOnce(worker, { source: frame, layers, palette: job.palette, seed: job.seed, color: job.color, steady });
            smallCtx.putImageData(result, 0, 0);
            // A fresh canvas per frame, so the encoder never sees a frame overwritten mid-flight.
            const out = new OffscreenCanvas(outW, outH);
            const outCtx = out.getContext("2d")!;
            outCtx.imageSmoothingEnabled = false;
            outCtx.drawImage(small, 0, 0, outW, outH);
            return out;
          },
        },
      });
      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks.map((d) => d.reason).join(", ");
        throw new Error(`This video can't be converted here (${reasons || "unsupported format"}).`);
      }
      if (cancelled) throw new VideoExportCanceled();
      conversion.onProgress = (p) => onProgress(p);
      await conversion.execute();
      const buffer = output.target.buffer;
      if (!buffer) throw new Error("The encoder produced no output.");
      return { blob: new Blob([buffer], { type: output.format.mimeType }), extension: output.format.fileExtension };
    } catch (err) {
      if (cancelled || err instanceof ConversionCanceledError) throw new VideoExportCanceled();
      throw err;
    } finally {
      worker.terminate();
      input.dispose?.();
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      void conversion?.cancel();
    },
  };
}
