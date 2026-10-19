import { useEffect, useMemo, useRef, useState } from "react";
import {
  PRESET_VERSION,
  PresetError,
  defaultParams,
  getAlgorithm,
  type ColorSettings,
  type Params,
  type Preset,
} from "@dither-dally/core";
import { AlgorithmList } from "./AlgorithmList.tsx";
import { exportPng, loadImageFile, sampleImage, thumbnailData, toImageData } from "./image.ts";
import { Inspector } from "./Inspector.tsx";
import { downloadPreset, hashForPreset, initialPreset, noticeFor, presetFromFile, presetFromHash } from "./presetLink.ts";
import { Toolbar } from "./Toolbar.tsx";
import { useDither } from "./useDither.ts";
import { useThumbnails } from "./useThumbnails.ts";
import { Viewer, type CompareMode } from "./Viewer.tsx";

type Source = CanvasImageSource & { width: number; height: number };

/** Floating panel widths plus their margin, used to centre the image in the visible area. */
const BROWSER_SPACE = 236 + 20;
const INSPECTOR_SPACE = 300 + 20;
const WIDE = () => window.innerWidth >= 900;

export function App() {
  const [start] = useState(initialPreset);
  const [original, setOriginal] = useState<Source>(() => sampleImage());
  const [fileName, setFileName] = useState("Sample");
  const [algorithmId, setAlgorithmId] = useState(start.preset.algorithm);
  const [paramsById, setParamsById] = useState<Record<string, Params>>({ [start.preset.algorithm]: start.preset.params });
  const [paletteId, setPaletteId] = useState(start.preset.palette);
  const [pixelSize, setPixelSize] = useState(start.preset.pixelSize);
  const [seed, setSeed] = useState(start.preset.seed);
  const [color, setColor] = useState<ColorSettings>(start.preset.color);
  const [mode, setMode] = useState<CompareMode>("split");
  const [showBrowser, setShowBrowser] = useState(WIDE);
  const [showInspector, setShowInspector] = useState(WIDE);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; id: number } | null>(
    start.notice ? { text: start.notice, id: 0 } : null,
  );
  const imageInput = useRef<HTMLInputElement>(null);
  const presetInput = useRef<HTMLInputElement>(null);

  const algorithm = getAlgorithm(algorithmId);
  const params = useMemo(
    () => ({ ...defaultParams(algorithm), ...paramsById[algorithmId] }),
    [algorithm, algorithmId, paramsById],
  );
  const source = useMemo(() => toImageData(original, pixelSize), [original, pixelSize]);
  const thumbSource = useMemo(() => thumbnailData(original, 88, 60), [original]);
  const result = useDither({ source, algorithmId, params, paletteId, seed, color });
  const thumbnails = useThumbnails(thumbSource, paletteId, seed, color);

  const preset: Preset = useMemo(
    () => ({ version: PRESET_VERSION, algorithm: algorithmId, params, palette: paletteId, pixelSize, seed, color }),
    [algorithmId, params, paletteId, pixelSize, seed, color],
  );

  function say(text: string, error = false) {
    setNotice({ text, error, id: Date.now() });
  }

  // Informational notices fade on their own; errors stay until dismissed.
  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  function applyPreset(p: Preset) {
    setAlgorithmId(p.algorithm);
    setParamsById((all) => ({ ...all, [p.algorithm]: p.params }));
    setPaletteId(p.palette);
    setPixelSize(p.pixelSize);
    setSeed(p.seed);
    setColor(p.color);
  }

  // Keep the address bar in sync, so copying the URL always shares the current look.
  useEffect(() => {
    const hash = hashForPreset(preset);
    if (window.location.hash !== hash) history.replaceState(null, "", hash);
  }, [preset]);

  useEffect(() => {
    const onHashChange = () => {
      const fromLink = presetFromHash(window.location.hash);
      if (!fromLink) return;
      if ("error" in fromLink) say(fromLink.error, true);
      else {
        applyPreset(fromLink.preset);
        say(noticeFor("Loaded settings from the link.", fromLink.warnings));
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  async function openFile(file: File | undefined) {
    if (!file) return;
    try {
      setOriginal(await loadImageFile(file));
      setFileName(file.name.replace(/\.[^.]+$/, ""));
    } catch {
      say(`Couldn't open "${file.name}". Try a PNG, JPEG, GIF or WebP image.`, true);
    }
  }

  async function openPresetFile(file: File | undefined) {
    if (!file) return;
    try {
      const { preset: p, warnings } = await presetFromFile(file);
      applyPreset(p);
      say(noticeFor(`Loaded "${file.name}".`, warnings));
    } catch (err) {
      say(err instanceof PresetError ? err.message : `Couldn't read "${file.name}".`, true);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      say("Link copied. It holds these settings, not your image.");
    } catch {
      say("Couldn't copy automatically. Copy the address from your browser's address bar instead.", true);
    }
  }

  function exportImage() {
    if (result.image) exportPng(result.image, pixelSize, `${fileName}-${algorithmId}.png`);
  }

  const latest = useRef({ exportImage });
  latest.current = { exportImage };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) void openFile(file);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "o") {
        e.preventDefault();
        imageInput.current?.click();
      } else if (e.key === "e") {
        e.preventDefault();
        latest.current.exportImage();
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function setParam(id: string, value: Params[string]) {
    setParamsById((all) => ({ ...all, [algorithmId]: { ...all[algorithmId], [id]: value } }));
  }

  const wide = typeof window !== "undefined" && window.innerWidth >= 900;
  const insets = {
    left: showBrowser && wide ? BROWSER_SPACE : 0,
    right: showInspector && wide ? INSPECTOR_SPACE : 0,
  };
  const status = result.busy ? "Rendering…" : result.ms !== null ? `${result.ms.toFixed(0)} ms` : "";

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && (file.type === "application/json" || file.name.endsWith(".json"))) void openPresetFile(file);
        else void openFile(file);
      }}
    >
      <Toolbar
        title={fileName}
        subtitle={`${source.width * pixelSize} × ${source.height * pixelSize} · ${algorithm.name}`}
        showBrowser={showBrowser}
        onToggleBrowser={() => setShowBrowser((s) => !s)}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector((s) => !s)}
        mode={mode}
        onMode={setMode}
        onOpen={() => imageInput.current?.click()}
        onShare={() => void copyLink()}
        onExport={exportImage}
        canExport={!!result.image}
      />

      <div className="workspace">
        <Viewer original={source} result={result.image} pixelSize={pixelSize} mode={mode} insets={insets} status={status} />

        {showBrowser && (
          <aside className="panel browser" aria-label="Algorithm browser">
            <AlgorithmList selected={algorithmId} thumbnails={thumbnails} onSelect={setAlgorithmId} />
          </aside>
        )}

        {showInspector && (
          <aside className="panel inspector" aria-label="Inspector">
            <Inspector
              algorithm={algorithm}
              params={params}
              onParam={setParam}
              paletteId={paletteId}
              onPalette={setPaletteId}
              color={color}
              onColor={setColor}
              pixelSize={pixelSize}
              onPixelSize={setPixelSize}
              seed={seed}
              onSeed={setSeed}
              onCopyLink={() => void copyLink()}
              onSavePreset={() => downloadPreset(preset, `${fileName}-${algorithmId}`)}
              onLoadPreset={() => presetInput.current?.click()}
            />
          </aside>
        )}

        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-card">Drop an image or a preset</div>
          </div>
        )}

        <div className={`toast${notice?.error ? " error" : ""}`} role="status" aria-live="polite" hidden={!notice}>
          <span>{notice?.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
        {result.error && (
          <div className="toast error" role="alert">
            <span>{result.error}</span>
          </div>
        )}
      </div>

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void openFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={presetInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void openPresetFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
