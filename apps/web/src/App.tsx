import { useEffect, useMemo, useRef, useState } from "react";
import {
  PresetError,
  customPalette,
  defaultParams,
  effectLayer,
  extractPalette,
  getAlgorithm,
  getDitherLayer,
  getEffect,
  insertLayerAfter,
  moveLayer,
  removeLayer,
  resolvePalette,
  type ColorSettings,
  type Layer,
  type PaletteRef,
  type Params,
  type Preset,
  type RGB,
} from "@dither-dally/core";
import { BatchSheet } from "./BatchSheet.tsx";
import { Gallery } from "./Gallery.tsx";
import { exportPng, loadImageFile, sampleImage, thumbnailData, toImageData } from "./image.ts";
import { Inspector } from "./Inspector.tsx";
import { LayersPanel, layerTitle } from "./LayersPanel.tsx";
import { downloadPreset, hashForPreset, initialPreset, noticeFor, presetFromFile, presetFromHash } from "./presetLink.ts";
import { Toolbar } from "./Toolbar.tsx";
import { useRender } from "./useDither.ts";
import { useHistory } from "./useHistory.ts";
import { useThumbnails } from "./useThumbnails.ts";
import { Viewer, type CompareMode } from "./Viewer.tsx";

type Source = CanvasImageSource & { width: number; height: number };

/** Panel widths plus margins, used to centre the image in the visible area. */
const LAYERS_SPACE = 240 + 20;
const INSPECTOR_SPACE = 300 + 20;
const GALLERY_SPACE = 500 + 10;
const WIDE = () => window.innerWidth >= 900;

export function App() {
  const [start] = useState(initialPreset);
  const history = useHistory<Preset>(() => start.preset);
  const doc = history.state;
  const [original, setOriginal] = useState<Source>(() => sampleImage());
  const [fileName, setFileName] = useState("Sample");
  const [selectedId, setSelectedId] = useState(() => getDitherLayer(start.preset).id);
  const [mode, setMode] = useState<CompareMode>("split");
  const [galleryOpen, setGalleryOpen] = useState(false);
  /** Style shown on the canvas while hovering in the gallery; null shows the chosen one. */
  const [previewStyle, setPreviewStyle] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(WIDE);
  const [showInspector, setShowInspector] = useState(WIDE);
  const [dragging, setDragging] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; id: number } | null>(
    start.notice ? { text: start.notice, id: 0 } : null,
  );
  const imageInput = useRef<HTMLInputElement>(null);
  const presetInput = useRef<HTMLInputElement>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  /** Settings each style had when you last left it, so switching back restores them. */
  const styleMemory = useRef<Record<string, Params>>({});

  const dither = getDitherLayer(doc);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? dither;
  const palette = useMemo<RGB[]>(() => resolvePalette(doc.palette) as RGB[], [doc.palette]);
  const renderLayers = useMemo<Layer[]>(
    () =>
      previewStyle
        ? doc.layers.map((l) =>
            l.kind === "dither" ? { ...l, enabled: true, algorithm: previewStyle, params: styleMemory.current[previewStyle] ?? defaultParams(getAlgorithm(previewStyle)) } : l,
          )
        : doc.layers,
    [doc.layers, previewStyle],
  );
  const source = useMemo(() => toImageData(original, doc.pixelSize), [original, doc.pixelSize]);
  const thumbSource = useMemo(() => thumbnailData(original, 168, 112), [original]);
  const result = useRender({ source, layers: renderLayers, palette, seed: doc.seed, color: doc.color });
  const thumbnails = useThumbnails(thumbSource, doc.layers, palette, doc.seed, doc.color);

  function say(text: string, error = false) {
    setNotice({ text, error, id: Date.now() });
  }

  // Informational notices fade on their own; errors stay until dismissed.
  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // ----- document edits (all undoable) -----

  const update = history.set;
  const mapLayer = (id: string, fn: (l: Layer) => Layer) => (d: Preset) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) });

  function setParam(layerId: string, key: string, value: Params[string]) {
    update(mapLayer(layerId, (l) => ({ ...l, params: { ...l.params, [key]: value } })), `param:${layerId}:${key}`);
  }

  function chooseStyle(algorithmId: string) {
    styleMemory.current[dither.algorithm] = dither.params;
    const params = styleMemory.current[algorithmId] ?? defaultParams(getAlgorithm(algorithmId));
    update(mapLayer(dither.id, (l) => ({ ...l, algorithm: algorithmId, params, enabled: true }) as Layer));
    setSelectedId(dither.id);
  }

  function addEffect(effectId: string) {
    const layer = effectLayer(effectId);
    update((d) => ({ ...d, layers: insertLayerAfter(d.layers, selected.id, layer) }));
    setSelectedId(layer.id);
  }

  function deleteLayer(id: string) {
    const index = doc.layers.findIndex((l) => l.id === id);
    const layer = doc.layers[index];
    if (!layer || layer.kind === "dither") return;
    update((d) => ({ ...d, layers: [...removeLayer(d.layers, id)] }));
    if (selectedId === id) setSelectedId((doc.layers[index - 1] ?? doc.layers[index + 1] ?? dither).id);
    say(`Removed ${layerTitle(layer).name}. Undo with Ctrl Z.`);
  }

  function reorder(id: string, toIndex: number) {
    update((d) => {
      const layers = moveLayer(d.layers, id, toIndex);
      return layers === d.layers ? d : { ...d, layers: [...layers] };
    });
  }

  function extract(count: number) {
    const colors = extractPalette(source, count, doc.seed);
    if (colors.length < 2) {
      say("This image doesn't have enough distinct colours to make a palette.", true);
      return;
    }
    update((d) => ({ ...d, palette: customPalette("From image", colors) }));
    say(`Made a ${colors.length}-colour palette from your image. It's saved with the preset.`);
  }

  function applyPreset(p: Preset) {
    update(() => p);
    setSelectedId(getDitherLayer(p).id);
  }

  // Keep the address bar in sync, so copying the URL always shares the current look.
  useEffect(() => {
    const hash = hashForPreset(doc);
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [doc]);

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

  // ----- files -----

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
      say("Link copied. It holds all your layers and settings, not your image.");
    } catch {
      say("Couldn't copy automatically. Copy the address from your browser's address bar instead.", true);
    }
  }

  function exportImage() {
    if (result.image && !previewStyle) exportPng(result.image, doc.pixelSize, `${fileName}-${dither.algorithm}.png`);
  }

  // ----- keyboard -----

  const latest = useRef({ exportImage, undo: history.undo, redo: history.redo });
  latest.current = { exportImage, undo: history.undo, redo: history.redo };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) void openFile(file);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      const typing = t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["range", "checkbox", "color"].includes((t as HTMLInputElement).type));
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        imageInput.current?.click();
      } else if (key === "e") {
        e.preventDefault();
        latest.current.exportImage();
      } else if (key === "k") {
        e.preventDefault();
        setGalleryOpen((o) => !o);
      } else if (!typing && key === "z") {
        e.preventDefault();
        if (e.shiftKey) latest.current.redo();
        else latest.current.undo();
      } else if (!typing && key === "y") {
        e.preventDefault();
        latest.current.redo();
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ----- layout -----

  const wide = typeof window !== "undefined" && window.innerWidth >= 900;
  const inspectorSpace = showInspector && wide ? INSPECTOR_SPACE : 0;
  const insets = {
    left: showLayers && wide ? LAYERS_SPACE : 0,
    // While the gallery is docked, the image re-fits into the space left of it.
    right: inspectorSpace + (galleryOpen && wide ? GALLERY_SPACE : 0),
  };
  const effects = doc.layers.filter((l) => l.kind === "effect" && l.enabled).length;
  const status = previewStyle
    ? `Preview: ${getAlgorithm(previewStyle).name}`
    : result.busy
      ? "Rendering…"
      : result.ms !== null
        ? `${result.ms.toFixed(0)} ms`
        : "";

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && (file.type === "application/json" || file.name.endsWith(".json"))) void openPresetFile(file);
        else void openFile(file);
      }}
    >
      <Toolbar
        title={fileName}
        subtitle={`${source.width * doc.pixelSize} × ${source.height * doc.pixelSize} · ${getAlgorithm(dither.algorithm).name}${effects ? ` + ${effects} effect${effects > 1 ? "s" : ""}` : ""}`}
        showLayers={showLayers}
        onToggleLayers={() => setShowLayers((s) => !s)}
        galleryOpen={galleryOpen}
        onToggleGallery={() => setGalleryOpen((o) => !o)}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector((s) => !s)}
        mode={mode}
        onMode={setMode}
        onOpen={() => imageInput.current?.click()}
        onShare={() => void copyLink()}
        onExport={exportImage}
        onBatch={() => batchInput.current?.click()}
        canExport={!!result.image}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
      />

      <div className="workspace">
        <Viewer original={source} result={result.image} pixelSize={doc.pixelSize} mode={mode} insets={insets} status={status} />

        {showLayers && (
          <aside className="panel layers-panel" aria-label="Layers">
            <LayersPanel
              layers={doc.layers}
              selectedId={selected.id}
              onSelect={setSelectedId}
              onToggle={(id) => update(mapLayer(id, (l) => ({ ...l, enabled: !l.enabled })))}
              onRemove={deleteLayer}
              onMove={reorder}
              onAdd={addEffect}
            />
          </aside>
        )}

        {galleryOpen && (
          <Gallery
            selected={dither.algorithm}
            thumbnails={thumbnails}
            rightInset={inspectorSpace}
            onPreview={setPreviewStyle}
            onChoose={(id) => {
              chooseStyle(id);
              setPreviewStyle(null);
              setGalleryOpen(false);
            }}
            onClose={() => {
              setPreviewStyle(null);
              setGalleryOpen(false);
            }}
          />
        )}

        {showInspector && (
          <aside className="panel inspector" aria-label="Inspector">
            <Inspector
              layer={selected}
              thumbnail={thumbnails[dither.algorithm] ?? null}
              onOpenStyles={() => setGalleryOpen(true)}
              onParam={setParam}
              onResetLayer={(id) =>
                update(
                  mapLayer(id, (l) => ({
                    ...l,
                    params: defaultParams(l.kind === "dither" ? getAlgorithm(l.algorithm) : getEffect(l.effect)),
                  })),
                )
              }
              palette={doc.palette}
              onPalette={(ref: PaletteRef) => update((d) => ({ ...d, palette: ref }))}
              onExtract={extract}
              color={doc.color}
              onColor={(c: ColorSettings) => update((d) => ({ ...d, color: c }))}
              pixelSize={doc.pixelSize}
              onPixelSize={(n) => update((d) => ({ ...d, pixelSize: n }), "pixelSize")}
              seed={doc.seed}
              onSeed={(n) => update((d) => ({ ...d, seed: n }), "seed")}
              onCopyLink={() => void copyLink()}
              onSavePreset={() => downloadPreset(doc, `${fileName}-${dither.algorithm}`)}
              onLoadPreset={() => presetInput.current?.click()}
            />
          </aside>
        )}

        {batchFiles && (
          <BatchSheet
            files={batchFiles}
            job={{ layers: doc.layers, palette, seed: doc.seed, color: doc.color, pixelSize: doc.pixelSize }}
            suffix={dither.algorithm}
            onClose={() => setBatchFiles(null)}
            onDone={(message, error) => {
              setBatchFiles(null);
              say(message, error);
            }}
          />
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

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => (void openFile(e.target.files?.[0]), (e.target.value = ""))} />
      <input
        ref={presetInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => (void openPresetFile(e.target.files?.[0]), (e.target.value = ""))}
      />
      <input
        ref={batchInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) setBatchFiles(files);
        }}
      />
    </div>
  );
}
