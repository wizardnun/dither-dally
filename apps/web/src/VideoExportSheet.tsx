import { useEffect, useRef, useState } from "react";
import { getAlgorithm, type ColorSettings, type Layer, type RGB } from "@dither-dally/core";
import { formatTime } from "./time.ts";
import { exportVideo, VideoExportCanceled, type VideoExportHandle, type VideoInfo } from "./video.ts";

interface Props {
  file: File;
  info: VideoInfo;
  job: { layers: Layer[]; palette: RGB[]; seed: number; color: ColorSettings; pixelSize: number };
  name: string;
  onClose: () => void;
  onDone: (message: string, error?: boolean) => void;
}

/** Families whose pattern is fixed to the pixel grid, so still parts of a video stay still. */
const STABLE = new Set(["ordered", "halftone", "lines", "pattern", "polygon", "basic"]);

export default function VideoExportSheet({ file, info, job, name, onClose, onDone }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const handle = useRef<VideoExportHandle | null>(null);
  const started = useRef(0);
  const [eta, setEta] = useState<string>("");
  const dither = job.layers.find((l) => l.kind === "dither");
  const family = dither?.kind === "dither" ? getAlgorithm(dither.algorithm).family : "basic";
  const flickers = !STABLE.has(family);

  useEffect(() => () => handle.current?.cancel(), []);

  async function run() {
    started.current = performance.now();
    setProgress(0);
    handle.current = exportVideo({ file, ...job }, (p) => {
      setProgress(p);
      if (p > 0.02) {
        const elapsed = (performance.now() - started.current) / 1000;
        setEta(`about ${formatTime((elapsed / p) * (1 - p)).replace(/\.\d$/, "")} left`);
      }
    });
    try {
      const { blob, extension } = await handle.current.done;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.${extension.replace(/^\./, "")}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onDone(`Exported ${a.download} (${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (err) {
      if (err instanceof VideoExportCanceled) onDone("Video export cancelled.");
      else onDone(err instanceof Error ? err.message : "Video export failed.", true);
    }
  }

  const running = progress !== null;
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="video-title">
        <h2 id="video-title">Export video</h2>
        <p>
          Every frame of “{file.name}” ({formatTime(info.duration - info.start)}) goes through your style and effects and is saved as an MP4
          {info.hasAudio ? ", keeping the original sound" : ""}. Frames are processed at the preview size, then scaled by the pixel size.
        </p>
        {flickers && (
          <p className="hint">
            Error-diffusion styles re-scatter their dots every frame, which looks like shimmering in video. For a steadier look, try an
            Ordered, Halftone or Line screen style.
          </p>
        )}
        {running && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            <span>
              {Math.round(progress * 100)}%{eta ? ` · ${eta}` : ""}
            </span>
          </div>
        )}
        <div className="sheet-buttons">
          {running ? (
            <button type="button" className="push" onClick={() => handle.current?.cancel()}>
              Stop
            </button>
          ) : (
            <>
              <button type="button" className="push" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="push primary" onClick={() => void run()}>
                Export MP4
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
