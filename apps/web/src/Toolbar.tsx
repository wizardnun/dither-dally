import { useEffect, useRef, useState } from "react";
import {
  ExportIcon,
  PhotoIcon,
  RedoIcon,
  ShareIcon,
  SideBySideIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
  SplitIcon,
  SquareIcon,
  StylesIcon,
  UndoIcon,
} from "./icons.tsx";
import { Segmented } from "./ui.tsx";
import type { CompareMode } from "./Viewer.tsx";

interface Props {
  title: string;
  subtitle: string;
  showLayers: boolean;
  onToggleLayers: () => void;
  galleryOpen: boolean;
  onToggleGallery: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  mode: CompareMode;
  onMode: (m: CompareMode) => void;
  onOpen: () => void;
  onShare: () => void;
  onExport: () => void;
  onBatch: () => void;
  onExportVideo: () => void;
  isVideo: boolean;
  canExport: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Set when the style produces text, adding text export to the menu. */
  onTextAction?: (action: "copy" | "txt" | "html") => void;
}

export function Toolbar(p: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button type="button" className="tool" aria-pressed={p.showLayers} aria-label="Show layers" title="Layers" onClick={p.onToggleLayers}>
          <SidebarLeftIcon />
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={p.galleryOpen}
          aria-label="Browse styles"
          title="Browse styles (Ctrl K)"
          onClick={p.onToggleGallery}
        >
          <StylesIcon />
        </button>
        <button type="button" className="tool" aria-label="Open image" title="Open image (Ctrl O)" onClick={p.onOpen}>
          <PhotoIcon />
        </button>
        <span className="toolbar-sep" aria-hidden="true" />
        <button type="button" className="tool" aria-label="Undo" title="Undo (Ctrl Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          <UndoIcon />
        </button>
        <button type="button" className="tool" aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={!p.canRedo} onClick={p.onRedo}>
          <RedoIcon />
        </button>
      </div>

      <div className="doc-title">
        <span className="doc-name">{p.title}</span>
        <span className="doc-sub">{p.subtitle}</span>
      </div>

      <div className="toolbar-group">
        <Segmented<CompareMode>
          label="Compare"
          iconOnly
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: "split", label: "Split compare", icon: <SplitIcon size={16} /> },
            { value: "side", label: "Side by side", icon: <SideBySideIcon size={16} /> },
            { value: "result", label: "Result only", icon: <SquareIcon size={16} /> },
          ]}
        />
        <button type="button" className="tool" aria-label="Copy link to these settings" title="Copy link to these settings" onClick={p.onShare}>
          <ShareIcon />
        </button>
        <ExportMenu
          onExport={p.onExport}
          onBatch={p.onBatch}
          onExportVideo={p.onExportVideo}
          onTextAction={p.onTextAction}
          isVideo={p.isVideo}
          canExport={p.canExport}
        />
        <button
          type="button"
          className="tool"
          aria-pressed={p.showInspector}
          aria-label="Show inspector"
          title="Inspector"
          onClick={p.onToggleInspector}
        >
          <SidebarRightIcon />
        </button>
      </div>
    </header>
  );
}

interface ExportMenuProps {
  onExport: () => void;
  onBatch: () => void;
  onExportVideo: () => void;
  onTextAction?: (action: "copy" | "txt" | "html") => void;
  isVideo: boolean;
  canExport: boolean;
}

function ExportMenu({ onExport, onBatch, onExportVideo, onTextAction, isVideo, canExport }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="menu-anchor">
      <button type="button" className="tool" aria-label="Export" title="Export" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ExportIcon />
      </button>
      {open && (
        <div className="menu right" role="menu">
          {onTextAction &&
            (
              [
                ["copy", "Copy as text", "Paste it anywhere that uses a monospace font."],
                ["txt", "Save as .txt", "Plain text file."],
                ["html", "Save as HTML", "A web page that keeps the colours."],
              ] as const
            ).map(([action, name, desc]) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onTextAction(action);
                }}
              >
                <span className="menu-name">{name}</span>
                <span className="menu-desc">{desc}</span>
              </button>
            ))}
          {isVideo && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onExportVideo();
              }}
            >
              <span className="menu-name">Export video…</span>
              <span className="menu-desc">Process every frame and save an MP4, keeping the sound.</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={!canExport}
            onClick={() => {
              setOpen(false);
              onExport();
            }}
          >
            <span className="menu-name">{isVideo ? "Export frame as PNG" : "Export PNG"}</span>
            <span className="menu-desc">{isVideo ? "Save the frame you're looking at." : "Save this image as you see it."} Ctrl E</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onBatch();
            }}
          >
            <span className="menu-name">Batch export…</span>
            <span className="menu-desc">Apply this look to many images at once.</span>
          </button>
        </div>
      )}
    </div>
  );
}
