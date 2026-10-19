/** Longest side of the working image. Keeps previews fast on large photos. */
export const MAX_SIDE = 1600;

/** Draws `source` into a canvas, downscaled so the result is (w / pixelSize) × (h / pixelSize). */
export function toImageData(source: CanvasImageSource & { width: number; height: number }, pixelSize: number): ImageData {
  const fit = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round((source.width * fit) / pixelSize));
  const h = Math.max(1, Math.round((source.height * fit) / pixelSize));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Small centre-cropped copy of `source` that fills width × height, for browser thumbnails. */
export function thumbnailData(source: CanvasImageSource & { width: number; height: number }, width: number, height: number): ImageData {
  const scale = Math.max(width / source.width, height / source.height);
  const sw = width / scale;
  const sh = height / scale;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function loadImageFile(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** A built-in sample so the app shows something useful before you load a file. */
export function sampleImage(width = 960, height = 540): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  for (let x = 0; x < width; x++) {
    const hue = (x / width) * 300;
    const grad = g.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `hsl(${hue} 70% 92%)`);
    grad.addColorStop(0.5, `hsl(${hue} 70% 50%)`);
    grad.addColorStop(1, `hsl(${hue} 70% 6%)`);
    g.fillStyle = grad;
    g.fillRect(x, 0, 1, height);
  }
  const glow = g.createRadialGradient(width * 0.7, height * 0.4, 8, width * 0.7, height * 0.4, height * 0.45);
  glow.addColorStop(0, "rgba(255,255,255,0.95)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, width, height);
  const ramp = g.createLinearGradient(0, 0, width, 0);
  ramp.addColorStop(0, "#000");
  ramp.addColorStop(1, "#fff");
  g.fillStyle = ramp;
  g.fillRect(0, height - 60, width, 60);
  return canvas;
}

/** Scales `image` up by `pixelSize` with hard edges and triggers a PNG download. */
export function exportPng(image: ImageData, pixelSize: number, filename: string): void {
  const small = document.createElement("canvas");
  small.width = image.width;
  small.height = image.height;
  small.getContext("2d")!.putImageData(image, 0, 0);
  const big = document.createElement("canvas");
  big.width = image.width * pixelSize;
  big.height = image.height * pixelSize;
  const ctx = big.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  big.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
