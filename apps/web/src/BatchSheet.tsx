import { useRef, useState } from "react";
import type { ColorSettings, Layer, RGB } from "@dither-dally/core";
import { loadImageFile, toImageData } from "./image.ts";
import { createRenderWorker, renderOnce } from "./useDither.ts";

interface Props {
  files: File[];
  job: { layers: Layer[]; palette: RGB[]; seed: number; color: ColorSettings; pixelSize: number };
  suffix: string;
  onClose: () => void;
  onDone: (message: string, error?: boolean) => void;
}

type DirectoryHandle = { getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> };
type WithDirectoryPicker = Window & { showDirectoryPicker?: (o: { mode: "readwrite" }) => Promise<DirectoryHandle> };

/**
 * Confirms and runs a batch export. Where the browser can write to a folder
 * (Chromium), files go straight into a folder you pick; elsewhere each one
 * downloads in turn.
 */
export function BatchSheet({ files, job, suffix, onClose, onDone }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);
  const canPickFolder = typeof (window as WithDirectoryPicker).showDirectoryPicker === "function";

  async function run() {
    let dir: DirectoryHandle | null = null;
    if (canPickFolder) {
      try {
        dir = await (window as WithDirectoryPicker).showDirectoryPicker!({ mode: "readwrite" });
      } catch {
        return; // folder picker dismissed: stay on the sheet
      }
    }
    const worker = createRenderWorker();
    const failed: string[] = [];
    let processed = 0;
    setProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        if (cancelled.current) break;
        const file = files[i]!;
        try {
          const bitmap = await loadImageFile(file);
          const source = toImageData(bitmap, job.pixelSize);
          bitmap.close();
          const result = await renderOnce(worker, { ...job, source });
          const blob = await toPng(result, job.pixelSize);
          const name = `${file.name.replace(/\.[^.]+$/, "")}-${suffix}.png`;
          if (dir) {
            const handle = await dir.getFileHandle(name, { create: true });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } else {
            download(blob, name);
            await new Promise((r) => setTimeout(r, 250)); // browsers throttle rapid downloads
          }
        } catch {
          failed.push(file.name);
        }
        processed = i + 1;
        setProgress(processed);
      }
    } finally {
      worker.terminate();
    }
    const done = processed - failed.length;
    if (failed.length) onDone(`Exported ${done} image${done === 1 ? "" : "s"}. Couldn't process: ${failed.join(", ")}.`, true);
    else onDone(cancelled.current ? `Stopped after ${done} image${done === 1 ? "" : "s"}.` : `Exported ${done} image${done === 1 ? "" : "s"}.`);
  }

  const running = progress !== null;
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="batch-title">
        <h2 id="batch-title">Batch export</h2>
        <p>
          Apply the current layers and settings to {files.length} image{files.length === 1 ? "" : "s"}. Each is processed the same way
          as the preview (long side up to 1,600 px, then scaled by the pixel size) and saved as PNG.
        </p>
        <p className="hint">
          {canPickFolder ? "You'll choose a folder to save into." : "Each file downloads separately; your browser may ask to allow multiple downloads."}
        </p>
        {running && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={files.length} aria-valuenow={progress}>
            <div className="progress-fill" style={{ width: `${(progress / files.length) * 100}%` }} />
            <span>
              {progress} of {files.length}
            </span>
          </div>
        )}
        <div className="sheet-buttons">
          {running ? (
            <button type="button" className="push" onClick={() => (cancelled.current = true)}>
              Stop
            </button>
          ) : (
            <>
              <button type="button" className="push" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="push primary" onClick={() => void run()}>
                Export {files.length} image{files.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function toPng(image: ImageData, pixelSize: number): Promise<Blob> {
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
  return new Promise((resolve, reject) => big.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
