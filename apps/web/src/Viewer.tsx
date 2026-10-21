import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "./Canvas.tsx";
import { MinusIcon, PlusIcon } from "./icons.tsx";

export type CompareMode = "split" | "side" | "result";
export type Zoom = "fit" | number;

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;
const GAP = 16;
/** Room kept free around the image when fitting. */
const MARGIN = 40;
/** Space reserved at the bottom for the zoom control. */
const HUD_SPACE = 56;

interface Props {
  original: ImageData;
  result: ImageData | null;
  pixelSize: number;
  mode: CompareMode;
  /** Width covered by floating panels on each side, so the image centres in the visible area. */
  insets: { left: number; right: number };
  status: string;
}

export function Viewer({ original, result, pixelSize, mode, insets, status }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [split, setSplit] = useState(0.5);
  const drag = useRef<{ kind: "pan" | "split"; startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const splitBox = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const imgW = original.width * pixelSize;
  const imgH = original.height * pixelSize;
  const columns = mode === "side" ? 2 : 1;
  const visibleW = Math.max(0, size.w - insets.left - insets.right);
  const availW = visibleW - MARGIN * 2 - GAP * (columns - 1);
  const availH = size.h - MARGIN * 2 - HUD_SPACE;
  const fitScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availW / (imgW * columns), availH / imgH)));
  const scale = zoom === "fit" ? fitScale : zoom;

  // A new image size or layout returns to a centred view.
  useEffect(() => setOffset({ x: 0, y: 0 }), [imgW, imgH, mode]);
  useEffect(() => {
    if (zoom === "fit") setOffset({ x: 0, y: 0 });
  }, [zoom]);

  const centerX = insets.left + visibleW / 2;
  const centerY = (size.h - HUD_SPACE) / 2;
  const dispW = Math.round(imgW * scale);
  const dispH = Math.round(imgH * scale);
  const totalW = dispW * columns + GAP * (columns - 1);
  const left = Math.round(centerX + offset.x - totalW / 2);
  const top = Math.round(centerY + offset.y - dispH / 2);

  function zoomTo(next: number, at?: { x: number; y: number }) {
    const s1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const p = at ?? { x: centerX, y: centerY };
    const cx = centerX + offset.x;
    const cy = centerY + offset.y;
    const k = 1 - s1 / scale;
    setOffset({ x: offset.x + (p.x - cx) * k, y: offset.y + (p.y - cy) * k });
    setZoom(s1);
  }
  const zoomIn = () => zoomTo(ZOOM_STEPS.find((z) => z > scale + 1e-6) ?? MAX_ZOOM);
  const zoomOut = () => zoomTo([...ZOOM_STEPS].reverse().find((z) => z < scale - 1e-6) ?? MIN_ZOOM);

  // Ctrl/⌘ + wheel or trackpad pinch zooms at the pointer; plain wheel pans.
  const latest = useRef({ zoomTo, scale, zoom });
  latest.current = { zoomTo, scale, zoom };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { zoomTo, scale, zoom } = latest.current;
      if (e.ctrlKey || e.metaKey) {
        zoomTo(scale * Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        if (zoom === "fit") setZoom(scale);
        setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard: ⌘/Ctrl + 0 fit, 1 actual pixels, +/- zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      const { zoomTo, scale } = latest.current;
      if (e.key === "0") setZoom("fit");
      else if (e.key === "1") zoomTo(1);
      else if (e.key === "=" || e.key === "+") zoomTo(ZOOM_STEPS.find((z) => z > scale + 1e-6) ?? MAX_ZOOM);
      else if (e.key === "-") zoomTo([...ZOOM_STEPS].reverse().find((z) => z < scale - 1e-6) ?? MIN_ZOOM);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const onHandle = (e.target as HTMLElement).closest(".split-handle");
    drag.current = { kind: onHandle ? "split" : "pan", startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (onHandle) moveSplit(e.clientX);
  }
  function moveSplit(clientX: number) {
    const box = splitBox.current?.getBoundingClientRect();
    if (box) setSplit(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  }
  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "split") moveSplit(e.clientX);
    else {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 4) return; // a click, not a drag
      if (!d.moved) {
        d.moved = true;
        setPanning(true);
        if (zoom === "fit") setZoom(scale);
      }
      setOffset({ x: d.ox + dx, y: d.oy + dy });
    }
  }
  function onPointerUp() {
    drag.current = null;
    setPanning(false);
  }

  const boxStyle = { width: dispW, height: dispH };
  const shown = result ?? original;

  return (
    <div
      ref={stageRef}
      className={`stage${panning ? " panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest(".split-handle")) setZoom(zoom === "fit" ? 1 : "fit");
      }}
    >
      {size.w > 0 && (
        // Below 100% hard-edged scaling invents moiré patterns, so smooth instead; at 100%+ show crisp pixels.
        <div className={`artboard${scale < 0.999 ? " smooth" : ""}`} style={{ left, top, gap: GAP }}>
          {mode === "split" && (
            <div ref={splitBox} className="image-box" style={boxStyle}>
              <Canvas image={shown} label="Result" className="pixels" />
              {result && (
                <>
                  <Canvas
                    image={original}
                    label="Original"
                    className="pixels overlay"
                    style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
                  />
                  <span className="tag left" style={{ opacity: split > 0.12 ? 1 : 0 }}>
                    Original
                  </span>
                  <span className="tag right" style={{ opacity: split < 0.88 ? 1 : 0 }}>
                    Result
                  </span>
                  <div
                    className="split-handle"
                    style={{ left: `${split * 100}%` }}
                    role="slider"
                    tabIndex={0}
                    aria-label="Compare original and result"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(split * 100)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 0.05));
                      if (e.key === "ArrowRight") setSplit((s) => Math.min(1, s + 0.05));
                    }}
                  >
                    <span className="knob" />
                  </div>
                </>
              )}
            </div>
          )}
          {mode === "side" && (
            <>
              <div className="image-box" style={boxStyle}>
                <Canvas image={original} label="Original" className="pixels" />
                <span className="tag left">Original</span>
              </div>
              <div className="image-box" style={boxStyle}>
                <Canvas image={shown} label="Result" className="pixels" />
                <span className="tag left">Result</span>
              </div>
            </>
          )}
          {mode === "result" && (
            <div className="image-box" style={boxStyle}>
              <Canvas image={shown} label="Result" className="pixels" />
            </div>
          )}
        </div>
      )}

      <div className="hud" style={{ left: centerX }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="hud-btn" aria-label="Zoom out" title="Zoom out (Ctrl −)" onClick={zoomOut}>
          <MinusIcon size={14} />
        </button>
        <button
          type="button"
          className="hud-zoom"
          title="Fit to window (Ctrl 0) / actual pixels (Ctrl 1)"
          onClick={() => setZoom(zoom === "fit" ? 1 : "fit")}
        >
          {zoom === "fit" ? `Fit · ${Math.round(scale * 100)}%` : `${Math.round(scale * 100)}%`}
        </button>
        <button type="button" className="hud-btn" aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={zoomIn}>
          <PlusIcon size={14} />
        </button>
        {/* Always present (even empty) so the box keeps one width. */}
        <span className="hud-status">{status}</span>
      </div>
    </div>
  );
}
