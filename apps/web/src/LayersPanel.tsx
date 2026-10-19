import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EFFECTS, EFFECT_CATEGORY_LABELS, FAMILY_LABELS, getAlgorithm, getEffect, type EffectCategory, type Layer } from "@dither-dally/core";
import { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "./icons.tsx";

interface Props {
  layers: Layer[];
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onAdd: (effectId: string) => void;
}

export function layerTitle(layer: Layer): { name: string; detail: string } {
  if (layer.kind === "dither") {
    const a = getAlgorithm(layer.algorithm);
    return { name: a.name, detail: `Dither · ${FAMILY_LABELS[a.family]}` };
  }
  const e = getEffect(layer.effect);
  return { name: e.name, detail: EFFECT_CATEGORY_LABELS[e.category] };
}

/**
 * The layer stack, applied top to bottom. Drag rows to reorder (or
 * Alt + ↑/↓ on the selected row), toggle visibility, remove effects.
 */
export function LayersPanel({ layers, selectedId, onSelect, onToggle, onRemove, onMove, onAdd }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** Where to show the add-effect menu (below the + button), or null when closed. */
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);

  return (
    <div className="layers">
      <header className="layers-head">
        <h2>Layers</h2>
        <div className="add-wrap">
          <button
            type="button"
            className="icon-btn"
            aria-label="Add effect"
            title="Add effect"
            aria-expanded={menuAt !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt((at) => (at ? null : { top: r.bottom + 6, left: r.left }));
            }}
          >
            <PlusIcon size={15} />
          </button>
          {/* Rendered at the top level so the panel's rounded clipping doesn't cut it off. */}
          {menuAt &&
            createPortal(
              <AddEffectMenu
                at={menuAt}
                onPick={(id) => {
                  setMenuAt(null);
                  onAdd(id);
                }}
                onClose={() => setMenuAt(null)}
              />,
              document.body,
            )}
        </div>
      </header>

      <p className="layers-caption">Your image</p>
      <ol
        className="layer-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId !== null && dropIndex !== null) onMove(dragId, dropIndex);
          setDragId(null);
          setDropIndex(null);
        }}
      >
        {layers.map((layer, index) => {
          const { name, detail } = layerTitle(layer);
          const selected = layer.id === selectedId;
          return (
            <li
              key={layer.id}
              className={[
                "layer-row",
                selected ? "selected" : "",
                layer.enabled ? "" : "hidden-layer",
                dragId === layer.id ? "dragging" : "",
                dropIndex === index && dragId !== null ? "drop-before" : "",
                dropIndex === index + 1 && index === layers.length - 1 && dragId !== null ? "drop-after" : "",
              ].join(" ")}
              draggable
              onDragStart={(e) => {
                setDragId(layer.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", layer.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
              }}
            >
              <button
                type="button"
                className="layer-main"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(layer.id)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    // Moving down past yourself means inserting two slots further.
                    onMove(layer.id, e.key === "ArrowUp" ? index - 1 : index + 2);
                  } else if ((e.key === "Delete" || e.key === "Backspace") && layer.kind === "effect") {
                    e.preventDefault();
                    onRemove(layer.id);
                  }
                }}
              >
                <span className={`layer-badge ${layer.kind === "dither" ? "dither" : getEffect(layer.effect).category}`} aria-hidden="true">
                  {layer.kind === "dither" ? "D" : name.charAt(0)}
                </span>
                <span className="layer-text">
                  <span className="layer-name">{name}</span>
                  <span className="layer-detail">{detail}</span>
                </span>
              </button>
              <button
                type="button"
                className="layer-action"
                aria-label={layer.enabled ? `Hide ${name}` : `Show ${name}`}
                title={layer.enabled ? "Hide" : "Show"}
                onClick={() => onToggle(layer.id)}
              >
                {layer.enabled ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
              </button>
              {layer.kind === "effect" ? (
                <button type="button" className="layer-action reveal" aria-label={`Remove ${name}`} title="Remove" onClick={() => onRemove(layer.id)}>
                  <TrashIcon size={14} />
                </button>
              ) : (
                <span className="layer-action-spacer" />
              )}
            </li>
          );
        })}
      </ol>
      <p className="layers-caption">Output</p>
      <p className="layers-hint">Layers run top to bottom. Drag to reorder; effects above the dither shape the image, effects below it treat the result.</p>
    </div>
  );
}

function AddEffectMenu({ at, onPick, onClose }: { at: { top: number; left: number }; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".add-wrap")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const categories = Object.keys(EFFECT_CATEGORY_LABELS) as EffectCategory[];
  return (
    <div
      ref={ref}
      className="menu floating"
      role="menu"
      aria-label="Add effect"
      style={{ top: at.top, left: Math.min(at.left, window.innerWidth - 296) }}
    >
      {categories.map((c) => (
        <div key={c} role="group" aria-label={EFFECT_CATEGORY_LABELS[c]}>
          <p className="menu-title">{EFFECT_CATEGORY_LABELS[c]}</p>
          {EFFECTS.filter((e) => e.category === c).map((e) => (
            <button key={e.id} type="button" role="menuitem" className="menu-item" onClick={() => onPick(e.id)}>
              <span className="menu-name">{e.name}</span>
              <span className="menu-desc">{e.summary}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
