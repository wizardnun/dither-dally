import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  PaletteFileError,
  PresetError,
  DEFAULT_STEADY,
  customPalette,
  defaultParams,
  effectLayer,
  extractPalette,
  getAlgorithm,
  getDitherLayer,
  getEffect,
  getPalette,
  insertLayerAfter,
  moveLayer,
  parsePaletteFile,
  removeLayer,
  resolvePalette,
  runUntilDither,
  scaleLayers,
  textArtFor,
  toGpl,
  toHtml,
  toPlainText,
  type ColorSettings,
  type Layer,
  type PaletteRef,
  type Params,
  type Preset,
  type RGB,
} from "@dither-dally/core";
import { BatchSheet } from "./BatchSheet.tsx";
import { Gallery } from "./Gallery.tsx";
import { FULL_MAX_SIDE, exportPng, loadImageFile, sampleImage, thumbnailData, toImageData, workingSize } from "./image.ts";
import type { Side } from "./EffectList.tsx";
import { Inspector, type TextAction } from "./Inspector.tsx";
import { downloadPreset, hashForPreset, initialPreset, noticeFor, presetFromFile, presetFromHash } from "./presetLink.ts";
import { projectFileBlob, projectStore, readProjectFile, thumbnailBlob } from "./projects.ts";
import { Toolbar } from "./Toolbar.tsx";
import { createRenderWorker, renderOnce, useRender } from "./useDither.ts";
import { useHistory } from "./useHistory.ts";
import { useStatus } from "./useStatus.ts";
import { useThumbnails } from "./useThumbnails.ts";
import { formatTime } from "./time.ts";
import type { VideoSession } from "./video.ts";
import { VideoTimeline } from "./VideoTimeline.tsx";

// Video support (and its media library) loads only when a video is opened.
const VideoExportSheet = lazy(() => import("./VideoExportSheet.tsx"));
const loadVideo = () => import("./video.ts");
import { Viewer, type CompareMode } from "./Viewer.tsx";
import { Welcome } from "./Welcome.tsx";

const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|ogv)$/i;
/** sessionStorage key for the project open in this tab, so a reload reopens it. */
const OPEN_PROJECT_KEY = "dither-dally:open-project";

/** Covers the app while a reload reopens the project; says "Opening…" only if it takes a moment. */
function RestoreCover() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="restore-cover" role="status" aria-live="polite">
      {slow && "Opening…"}
    </div>
  );
}

function reopenId(): string | null {
  try {
    return sessionStorage.getItem(OPEN_PROJECT_KEY);
  } catch {
    return null; // storage blocked: start fresh
  }
}
/** Project files saved from Dither Dally. */
const PROJECT_FILE = /\.dally$/i;
/** Palette files that can be dropped onto the window (Paint.NET .txt only via Import). */
const PALETTE_FILE = /\.(gpl|pal|hex)$/i;
const isVideoFile = (f: File) => f.type.startsWith("video/") || VIDEO_FILE.test(f.name);

type Source = CanvasImageSource & { width: number; height: number };

/** Panel widths plus margins, used to centre the image in the visible area. */
const INSPECTOR_SPACE = 300 + 20;
const GALLERY_SPACE = 500 + 20;
const WIDE = () => window.innerWidth >= 900;
/** Below this width the inspector becomes a bottom sheet (matches the CSS). */
const PHONE_MAX = 560;
/** Share of the window height the bottom sheet takes on phones. */
const SHEET_SHARE = 0.5;

/** Whether to use the GPU: on by default, remembered in this browser, and only once WebGPU is confirmed. */
function useGpuSetting() {
  const [wanted, setWanted] = useState(() => {
    try {
      return localStorage.getItem("dither-dally:gpu") !== "off";
    } catch {
      return true;
    }
  });
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    (navigator.gpu?.requestAdapter() ?? Promise.resolve(null))
      .then((adapter) => live && setAvailable(adapter !== null))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);
  const set = (on: boolean) => {
    setWanted(on);
    try {
      localStorage.setItem("dither-dally:gpu", on ? "on" : "off");
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  return { on: wanted && available === true, wanted, available, set };
}

/** The window size, kept up to date so the layout follows resizes and rotation. */
function useViewport() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export function App() {
  const [start] = useState(initialPreset);
  const history = useHistory<Preset>(() => start.preset);
  const doc = history.state;
  const [original, setOriginal] = useState<Source>(() => sampleImage());
  const [fileName, setFileName] = useState("Sample");
  /** The project being autosaved in this browser; null for the sample, or when saving isn't possible. */
  const [projectId, setProjectId] = useState<string | null>(null);
  /** The file the current image or video came from, for project files. Null for the sample. */
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  /** Whether this browser can keep projects; null while checking. */
  const [storageAvailable, setStorageAvailable] = useState<boolean | null>(null);
  /** The start screen; skipped when a reload is reopening this tab's project. */
  const [welcome, setWelcome] = useState(() => !reopenId());
  /**
   * Reopening this tab's project after a reload: "loading" until it's open,
   * then "rendering" until its first result is ready. A plain cover hides
   * the app meanwhile, so the sample never flashes up.
   */
  const [restoring, setRestoring] = useState<"loading" | "rendering" | null>(() => (reopenId() ? "loading" : null));
  /** Opened from a shared link: its settings apply to whatever gets opened. */
  const [fromLink] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, "")).has("p"));
  /** The effect card open in the inspector; one at a time. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mode, setMode] = useState<CompareMode>("result");
  const [galleryOpen, setGalleryOpen] = useState(false);
  /** Style shown on the canvas while hovering in the gallery; null shows the chosen one. */
  const [previewStyle, setPreviewStyle] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(WIDE);
  const viewport = useViewport();
  const [dragging, setDragging] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);
  const [video, setVideo] = useState<VideoSession | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoExportOpen, setVideoExportOpen] = useState(false);
  /** Keep dots still between video frames where the picture doesn't change. */
  const [steadyDots, setSteadyDots] = useState(true);
  const gpu = useGpuSetting();
  const playback = useRef<AbortController | null>(null);
  /** Increments per seek, so a slow frame fetch can't overwrite a newer one. */
  const seekToken = useRef(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; id: number } | null>(
    start.notice ? { text: start.notice, id: 0 } : null,
  );
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const presetInput = useRef<HTMLInputElement>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const [exportingFull, setExportingFull] = useState(false);
  /** Settings each style had when you last left it, so switching back restores them. */
  const styleMemory = useRef<Record<string, Params>>({});

  const dither = getDitherLayer(doc);
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
  /** Size of a full-size export, or null when the preview already is full size. */
  const fullSize = useMemo(() => {
    const s = workingSize(original, doc.pixelSize, FULL_MAX_SIDE);
    return s.width > source.width ? { width: s.width * doc.pixelSize, height: s.height * doc.pixelSize } : null;
  }, [original, doc.pixelSize, source.width]);
  const thumbSource = useMemo(() => thumbnailData(original, 168, 112), [original]);
  const result = useRender({
    source,
    layers: renderLayers,
    palette,
    seed: doc.seed,
    color: doc.color,
    steady: video && steadyDots ? DEFAULT_STEADY : undefined,
    gpu: gpu.on,
  });
  const thumbnails = useThumbnails(thumbSource, doc.layers, palette, doc.seed, doc.color);
  const status = useStatus(result, playing, previewStyle && getAlgorithm(previewStyle).name);
  /** The latest result, but only if it was rendered from the image now open (never a previous image's). */
  const current = result.source === source ? result.image : null;

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
  }

  /** Adds an effect at the end of its side of the dither layer, opened for editing. */
  function addEffect(effectId: string, side: Side) {
    const layer = effectLayer(effectId);
    update((d) => {
      const layers = [...d.layers];
      layers.splice(side === "before" ? layers.findIndex((l) => l.kind === "dither") : layers.length, 0, layer);
      return { ...d, layers };
    });
    setExpandedId(layer.id);
  }

  function duplicateEffect(id: string) {
    const layer = doc.layers.find((l) => l.id === id);
    if (layer?.kind !== "effect") return;
    const copy = { ...effectLayer(layer.effect), enabled: layer.enabled, params: { ...layer.params } };
    update((d) => ({ ...d, layers: insertLayerAfter(d.layers, id, copy) }));
    setExpandedId(copy.id);
  }

  function deleteLayer(id: string) {
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer || layer.kind === "dither") return;
    update((d) => ({ ...d, layers: [...removeLayer(d.layers, id)] }));
    say(`Removed ${getEffect(layer.effect).name}. Undo with Ctrl Z.`);
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
    setExpandedId(null);
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

  /** Shows an image or video. Resolves with whether it opened. */
  async function openSource(file: File): Promise<boolean> {
    stopPlayback();
    if (isVideoFile(file)) {
      try {
        const { VideoSession } = await loadVideo();
        const session = await VideoSession.open(file);
        const first = await session.frameAt(session.info.start);
        if (!first) throw new Error(`"${file.name}" has no frames that can be shown.`);
        video?.dispose();
        setVideo(session);
        setVideoTime(session.info.start);
        setOriginal(first);
        return true;
      } catch (err) {
        say(err instanceof Error ? err.message : `Couldn't open "${file.name}".`, true);
        return false;
      }
    }
    try {
      setOriginal(await loadImageFile(file));
      video?.dispose();
      setVideo(null);
      return true;
    } catch {
      say(`Couldn't open "${file.name}". Try a PNG, JPEG, GIF or WebP image, or an MP4 or WebM video.`, true);
      return false;
    }
  }

  // ----- projects -----

  /** The latest document, for code that runs after an await. */
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    void projectStore.available().then(setStorageAvailable);
    // A reload in the same tab reopens the project that was open (sessionStorage is per tab).
    const reopen = reopenId();
    if (reopen) void openRecent(reopen, { quiet: true });
  }, []);

  useEffect(() => {
    try {
      if (projectId) sessionStorage.setItem(OPEN_PROJECT_KEY, projectId);
      else sessionStorage.removeItem(OPEN_PROJECT_KEY);
    } catch {
      // Storage blocked: a reload just starts fresh.
    }
  }, [projectId]);

  /**
   * Opens an image or video. With no project id it starts a new project,
   * saved in this browser from then on; `preset` replaces the settings
   * (reopening a project, or a project file).
   */
  async function openFile(file: File | undefined, opts: { projectId?: string; preset?: Preset; name?: string } = {}): Promise<boolean> {
    if (!file) return false;
    if (!(await openSource(file))) return false;
    setWelcome(false);
    const name = opts.name ?? file.name.replace(/\.[^.]+$/, "");
    if (opts.preset) applyPreset(opts.preset);
    setFileName(name);
    setSourceFile(file);
    if (opts.projectId) {
      setProjectId(opts.projectId);
      void projectStore.update(opts.projectId, {}).catch(() => {}); // move it to the top of Recent
      return true;
    }
    setProjectId(null);
    if (!(await projectStore.available())) return true;
    try {
      setProjectId(await projectStore.create(name, opts.preset ?? docRef.current, file));
    } catch {
      say("Couldn't save this project in the browser (storage may be full). Use Save project file to keep it.", true);
    }
    return true;
  }

  async function openRecent(id: string, { quiet = false } = {}) {
    try {
      const { name, preset, file } = await projectStore.load(id);
      if (!(await openFile(file, { projectId: id, preset, name }))) throw new Error(`Couldn't open "${name}".`);
      // Reopened after a reload: the project's own settings replace the link's, so drop that notice.
      if (quiet) {
        setNotice(null);
        setRestoring("rendering");
      }
    } catch (err) {
      if (quiet) {
        setRestoring(null);
        setWelcome(true);
      } else say(err instanceof Error ? err.message : "Couldn't open that project.", true);
    }
  }

  async function removeRecent(id: string) {
    try {
      await projectStore.remove(id);
      if (id === projectId) setProjectId(null);
    } catch {
      say("Couldn't remove that project.", true);
    }
  }

  async function openProjectFile(file: File | undefined) {
    if (!file) return;
    try {
      const project = await readProjectFile(file);
      await openFile(project.source, { preset: project.preset, name: project.name });
      say(noticeFor(`Opened "${project.name}".`, project.warnings));
    } catch (err) {
      say(err instanceof Error ? err.message : `Couldn't open "${file.name}".`, true);
    }
  }

  async function saveProjectFile() {
    // The sample has no file of its own: save it as a PNG.
    const source =
      sourceFile ??
      new File([await new Promise<Blob>((resolve) => (original as HTMLCanvasElement).toBlob((b) => resolve(b!), "image/png"))], "Sample.png", {
        type: "image/png",
      });
    const url = URL.createObjectURL(projectFileBlob(fileName, doc, source));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.dally`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say(`Saved "${fileName}.dally". Open it with Open → Open project file, or drop it onto the window.`);
  }

  /** Any file from a picker, drop or paste: project, preset, palette, or image/video. */
  function openAny(file: File | undefined) {
    if (!file) return;
    if (PROJECT_FILE.test(file.name)) void openProjectFile(file);
    else if (file.type === "application/json" || file.name.endsWith(".json")) void openPresetFile(file);
    else if (PALETTE_FILE.test(file.name)) void openPaletteFile(file);
    else void openFile(file);
  }

  // Lift the reload cover once the reopened project's first render is on screen (or a render failed).
  useEffect(() => {
    if (restoring === "rendering" && (current || result.error)) setRestoring(null);
  }, [restoring, current, result.error]);

  // Autosave: settings and a thumbnail, a moment after the last change. Not while a video plays.
  const autosaveFailed = useRef(false);
  useEffect(() => {
    if (!projectId || playing) return;
    const image = !previewStyle ? current : null;
    const t = setTimeout(async () => {
      try {
        await projectStore.update(projectId, { preset: doc, ...(image ? { thumbnail: await thumbnailBlob(image) } : {}) });
        autosaveFailed.current = false;
      } catch {
        if (!autosaveFailed.current) say("Couldn't autosave (browser storage may be full). Use Save project file to keep your work.", true);
        autosaveFailed.current = true;
      }
    }, 800);
    return () => clearTimeout(t);
  }, [doc, projectId, playing, current]);

  // ----- video -----

  function stopPlayback() {
    playback.current?.abort();
    playback.current = null;
    setPlaying(false);
  }

  async function seek(t: number) {
    if (!video) return;
    stopPlayback();
    setVideoTime(t);
    const token = ++seekToken.current;
    const frame = await video.frameAt(t);
    if (frame && token === seekToken.current) setOriginal(frame);
  }

  function play() {
    if (!video) return;
    stopPlayback();
    const controller = new AbortController();
    playback.current = controller;
    setPlaying(true);
    // From the start again if we're at the end.
    const from = videoTime >= video.info.duration - 0.05 ? video.info.start : videoTime;
    void video
      .play(from, controller.signal, (frame, t) => {
        setOriginal(frame);
        setVideoTime(t);
      })
      .finally(() => {
        if (playback.current === controller) stopPlayback();
      });
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

  async function openPaletteFile(file: File | undefined) {
    if (!file) return;
    try {
      const { name, colors, warnings } = parsePaletteFile(await file.text(), file.name);
      update((d) => ({ ...d, palette: customPalette(name, colors) }));
      say([`Loaded "${name}" (${colors.length} colours). It's saved with the preset.`, ...warnings].join(" "));
    } catch (err) {
      say(err instanceof PaletteFileError ? err.message : `Couldn't read "${file.name}".`, true);
    }
  }

  function savePalette() {
    const name = typeof doc.palette === "string" ? getPalette(doc.palette).name : doc.palette.name;
    const url = URL.createObjectURL(new Blob([toGpl(name, palette)], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w.-]+/g, "-")}.gpl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      say("Link copied. It holds all your effects and settings, not your image.");
    } catch {
      say("Couldn't copy automatically. Copy the address from your browser's address bar instead.", true);
    }
  }

  /** The current text art, built from exactly the image the preview shows going into the dither. */
  function currentTextArt() {
    const input = runUntilDither(source, { layers: doc.layers, palette, seed: doc.seed, color: doc.color });
    return textArtFor(dither.algorithm, input, palette, dither.params, doc.color);
  }

  async function textAction(action: TextAction) {
    const art = currentTextArt();
    if (!art) return;
    const base = `${fileName}-${dither.algorithm}`;
    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(toPlainText(art));
        say(`Copied ${art.cols} × ${art.rows} characters. Paste into anything with a monospace font.`);
      } catch {
        say("Couldn't copy automatically. Use Save as .txt instead.", true);
      }
      return;
    }
    const [content, type, ext] =
      action === "txt" ? [toPlainText(art), "text/plain;charset=utf-8", "txt"] : [toHtml(art, base), "text/html;charset=utf-8", "html"];
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportImage() {
    if (current && !previewStyle) exportPng(current, doc.pixelSize, `${fileName}-${dither.algorithm}.png`);
  }

  /**
   * Renders the image at its own resolution (up to FULL_MAX_SIDE) in a separate
   * worker. Distance settings scale with the image so patterns and effects keep
   * their proportions; the dither grain is finer than in the preview.
   */
  async function exportFullSize() {
    if (!fullSize || exportingFull) return;
    const full = toImageData(original, doc.pixelSize, FULL_MAX_SIDE);
    const layers = scaleLayers(doc.layers, full.width / source.width);
    setExportingFull(true);
    say(`Rendering ${fullSize.width} × ${fullSize.height}…`);
    const worker = createRenderWorker();
    try {
      const image = await renderOnce(worker, { source: full, layers, palette, seed: doc.seed, color: doc.color, gpu: gpu.on });
      exportPng(image, doc.pixelSize, `${fileName}-${dither.algorithm}-full.png`);
      say(`Saved ${fullSize.width} × ${fullSize.height} PNG.`);
    } catch (err) {
      say(`Couldn't render at full size${err instanceof Error ? `: ${err.message}` : "."} Try a larger pixel size.`, true);
    } finally {
      worker.terminate();
      setExportingFull(false);
    }
  }

  // ----- keyboard -----

  const latest = useRef({ exportImage, saveProjectFile, openAny, undo: history.undo, redo: history.redo, togglePlay: () => {} });
  latest.current = {
    exportImage,
    saveProjectFile,
    openAny,
    undo: history.undo,
    redo: history.redo,
    togglePlay: () => (video ? (playing ? stopPlayback() : play()) : undefined),
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) latest.current.openAny(file);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["range", "checkbox", "color"].includes((t as HTMLInputElement).type));
      // Space plays/pauses video, unless it would press a focused control instead.
      if (e.key === " " && !e.ctrlKey && !e.metaKey && !typing && !["BUTTON", "INPUT", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        latest.current.togglePlay();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        imageInput.current?.click();
      } else if (key === "e") {
        e.preventDefault();
        latest.current.exportImage();
      } else if (key === "s") {
        e.preventDefault();
        void latest.current.saveProjectFile();
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

  const wide = viewport.width >= 900;
  const phone = viewport.width < PHONE_MAX;
  const inspectorSpace = showInspector && wide ? INSPECTOR_SPACE : 0;
  // On phones the inspector is a bottom sheet and the image fits in the space above it.
  const sheetHeight = phone && showInspector && !galleryOpen ? Math.round(viewport.height * SHEET_SHARE) : 0;
  const insets = {
    left: 0,
    // The gallery takes the inspector's place while open; the image re-fits beside it.
    right: galleryOpen && wide ? GALLERY_SPACE : inspectorSpace,
    bottom: sheetHeight,
  };
  const effects = doc.layers.filter((l) => l.kind === "effect" && l.enabled).length;

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
        openAny(file);
      }}
    >
      <Toolbar
        title={fileName}
        subtitle={`${video ? `Video ${formatTime(video.info.duration - video.info.start)} · ` : ""}${source.width * doc.pixelSize} × ${source.height * doc.pixelSize} · ${getAlgorithm(dither.algorithm).name}${effects ? ` + ${effects} effect${effects > 1 ? "s" : ""}` : ""}`}
        galleryOpen={galleryOpen}
        onToggleGallery={() => setGalleryOpen((o) => !o)}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector((s) => !s)}
        mode={mode}
        onMode={setMode}
        onProjects={() => setWelcome(true)}
        onOpen={() => imageInput.current?.click()}
        onSaveProject={() => void saveProjectFile()}
        onShare={() => void copyLink()}
        onExport={exportImage}
        fullSize={fullSize}
        exportingFull={exportingFull}
        onExportFull={() => void exportFullSize()}
        onBatch={() => batchInput.current?.click()}
        onExportVideo={() => {
          stopPlayback();
          setVideoExportOpen(true);
        }}
        isVideo={video !== null}
        canExport={!!current}
        onTextAction={getAlgorithm(dither.algorithm).family === "text" ? (a) => void textAction(a) : undefined}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
      />

      <div className="workspace">
        <Viewer original={source} result={current} pixelSize={doc.pixelSize} mode={mode} insets={insets} status={status} />

        {video && (
          <VideoTimeline
            start={video.info.start}
            duration={video.info.duration}
            time={videoTime}
            playing={playing}
            onPlay={play}
            onPause={stopPlayback}
            onSeek={(t) => void seek(t)}
            insets={insets}
          />
        )}

        {video && videoExportOpen && (
          <Suspense fallback={null}>
            <VideoExportSheet
              file={video.file}
              info={video.info}
              job={{ layers: doc.layers, palette, seed: doc.seed, color: doc.color, pixelSize: doc.pixelSize, gpu: gpu.on }}
              name={`${fileName}-${dither.algorithm}`}
              steadyDots={steadyDots}
              onSteadyDots={setSteadyDots}
              onClose={() => setVideoExportOpen(false)}
              onDone={(message, error) => {
                setVideoExportOpen(false);
                say(message, error);
              }}
            />
          </Suspense>
        )}

        {galleryOpen && (
          <Gallery
            selected={dither.algorithm}
            thumbnails={thumbnails}
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
          // Hidden rather than unmounted while browsing styles, so it keeps its scroll position.
          <aside className="panel inspector" aria-label="Inspector" hidden={galleryOpen} style={sheetHeight ? { height: sheetHeight } : undefined}>
            <Inspector
              layers={doc.layers}
              expandedId={expandedId}
              onExpand={setExpandedId}
              onToggle={(id) => update(mapLayer(id, (l) => ({ ...l, enabled: !l.enabled })))}
              onRemove={deleteLayer}
              onDuplicate={duplicateEffect}
              onMove={reorder}
              onAdd={addEffect}
              workingWidth={source.width}
              onTextAction={(a) => void textAction(a)}
              ditherThumbnail={thumbnails[dither.algorithm] ?? null}
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
              onImportPalette={() => paletteInput.current?.click()}
              onSavePalette={savePalette}
              color={doc.color}
              onColor={(c: ColorSettings) => update((d) => ({ ...d, color: c }))}
              pixelSize={doc.pixelSize}
              onPixelSize={(n) => update((d) => ({ ...d, pixelSize: n }), "pixelSize")}
              isVideo={video !== null}
              gpuAvailable={gpu.available}
              useGpu={gpu.wanted}
              onUseGpu={gpu.set}
              steadyDots={steadyDots}
              onSteadyDots={setSteadyDots}
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
            job={{ layers: doc.layers, palette, seed: doc.seed, color: doc.color, pixelSize: doc.pixelSize, gpu: gpu.on }}
            suffix={dither.algorithm}
            onClose={() => setBatchFiles(null)}
            onDone={(message, error) => {
              setBatchFiles(null);
              say(message, error);
            }}
          />
        )}

        {restoring && <RestoreCover />}

        {welcome && (
          <Welcome
            available={storageAvailable}
            fromLink={fromLink}
            listRecent={projectStore.list}
            onOpenRecent={(id) => void openRecent(id)}
            onRemoveRecent={removeRecent}
            onOpenFile={() => imageInput.current?.click()}
            onOpenProjectFile={() => projectInput.current?.click()}
            onSample={() => setWelcome(false)}
          />
        )}

        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-card">Drop an image, a video, a project, a preset or a palette</div>
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
        accept="image/*,video/*,.dally"
        hidden
        onChange={(e) => (openAny(e.target.files?.[0]), (e.target.value = ""))}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".dally"
        hidden
        onChange={(e) => (void openProjectFile(e.target.files?.[0]), (e.target.value = ""))}
      />
      <input
        ref={paletteInput}
        type="file"
        accept=".gpl,.pal,.hex,.txt"
        hidden
        onChange={(e) => (void openPaletteFile(e.target.files?.[0]), (e.target.value = ""))}
      />
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
