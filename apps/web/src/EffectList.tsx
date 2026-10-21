import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  EFFECTS,
  EFFECT_CATEGORY_LABELS,
  getAlgorithm,
  getEffect,
  type DitherLayer,
  type EffectCategory,
  type EffectLayer,
  type Layer,
} from "@dither-dally/core";
import { Canvas } from "./Canvas.tsx";
import { ResetButton, SettingsList } from "./ControlField.tsx";
import { ChevronIcon, EyeIcon, EyeOffIcon, MoreIcon, PlusIcon } from "./icons.tsx";
import { FloatingMenu, MenuItem, menuBelow, NARROW_MENU, type MenuPosition } from "./Menu.tsx";

export type Side = "before" | "after";

/** Where a new effect goes: adjustments shape the image first, the rest treat the result. */
const SIDE_FOR: Record<EffectCategory, Side> = { adjust: "before", light: "after", glitch: "after" };

export interface EffectListProps {
  /** The whole stack, in processing order. */
  layers: Layer[];
  ditherThumbnail: ImageData | null;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  onParam: (layerId: string, key: string, value: Layer["params"][string]) => void;
  onResetLayer: (layerId: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** Moves a layer to sit just before the layer now at `toIndex` in the whole stack. */
  onMove: (id: string, toIndex: number) => void;
  onAdd: (effectId: string, side: Side) => void;
  /** Shows the style's own settings. */
  onShowStyle: () => void;
}

/** The effect being dragged, if any. */
let dragging: string | null = null;

/**
 * The stack as one list, top to bottom, with the dither as a divider row:
 * effects above it shape the image, effects below it treat the result.
 * Each effect is a card with its settings inline, one open at a time. Drag
 * a card's header (or use its menu, or Alt + ↑/↓) to reorder.
 */
export function EffectList(p: EffectListProps) {
  const ditherIndex = p.layers.findIndex((l) => l.kind === "dither");
  const dither = p.layers[ditherIndex] as DitherLayer;
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [addAt, setAddAt] = useState<MenuPosition | null>(null);
  const empty = p.layers.length === 1;

  function drop() {
    if (dragging && dropIndex !== null) p.onMove(dragging, dropIndex);
    dragging = null;
    setDropIndex(null);
  }

  return (
    <div className="fx-tab">
      <div className="fx-toolbar">
        <p className="hint">{empty ? "No effects yet." : "Effects run top to bottom."}</p>
        <button
          type="button"
          className="push"
          aria-expanded={addAt !== null}
          onClick={(e) => {
            const pos = menuBelow(e.currentTarget);
            setAddAt((at) => (at ? null : pos));
          }}
        >
          <PlusIcon size={13} /> Add effect
        </button>
      </div>
      {addAt && (
        <FloatingMenu at={addAt} label="Add effect" onClose={() => setAddAt(null)}>
          {(Object.keys(EFFECT_CATEGORY_LABELS) as EffectCategory[]).map((c) => (
            <div key={c} role="group" aria-label={EFFECT_CATEGORY_LABELS[c]}>
              <p className="menu-title">
                {EFFECT_CATEGORY_LABELS[c]} · goes {SIDE_FOR[c]} the dither
              </p>
              {EFFECTS.filter((e) => e.category === c).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setAddAt(null);
                    p.onAdd(e.id, SIDE_FOR[c]);
                  }}
                >
                  <span className="menu-name">{e.name}</span>
                  <span className="menu-desc">{e.summary}</span>
                </button>
              ))}
            </div>
          ))}
        </FloatingMenu>
      )}

      {empty ? (
        <p className="fx-empty">
          Adjustments like contrast or blur shape the image before it's dithered. Light and glitch effects like bloom or scanlines treat the
          result. You can move any effect to either side.
        </p>
      ) : (
        <div
          className="fx-list"
          // Safari only treats an element as a drop target if dragenter is cancelled too (Chrome is lenient).
          onDragEnter={(e) => dragging && e.preventDefault()}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // Over the gap below the last card: drop at the end.
            if (e.target === e.currentTarget) setDropIndex(p.layers.length);
          }}
          onDragLeave={(e) => {
            // Only when the pointer really leaves the list. Safari sends no relatedTarget, so check the position.
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) setDropIndex(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop();
          }}
        >
          {p.layers.map((layer, index) =>
            layer.kind === "dither" ? (
              <DitherDivider
                key={layer.id}
                layer={dither}
                thumbnail={p.ditherThumbnail}
                dropBefore={dropIndex === index}
                dropAfter={dropIndex === index + 1 && index === p.layers.length - 1}
                onDragOverHalf={(after) => setDropIndex(after ? index + 1 : index)}
                onToggle={() => p.onToggle(layer.id)}
                onShowStyle={p.onShowStyle}
              />
            ) : (
              <EffectCard
                key={layer.id}
                layer={layer}
                index={index}
                stackLength={p.layers.length}
                ditherIndex={ditherIndex}
                expanded={p.expandedId === layer.id}
                dropBefore={dropIndex === index}
                dropAfter={dropIndex === index + 1 && index === p.layers.length - 1}
                onDragOverHalf={(after) => setDropIndex(after ? index + 1 : index)}
                {...p}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Drop indicator classes shared by cards and the divider. */
const dropClasses = (before: boolean, after: boolean) => `${before ? " drop-before" : ""}${after ? " drop-after" : ""}`;

/** Calls `onHalf(true)` while a drag is over the lower half of the element. */
function dragOverHalf(onHalf: (after: boolean) => void) {
  return (e: DragEvent<HTMLElement>) => {
    if (!dragging) return;
    e.preventDefault();
    // Safari refuses the drop unless this matches the drag's effectAllowed ("move").
    e.dataTransfer.dropEffect = "move";
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onHalf(e.clientY > rect.top + rect.height / 2);
  };
}

/** The dither's place in the stack. Clicking it shows the style's settings. */
function DitherDivider(p: {
  layer: DitherLayer;
  thumbnail: ImageData | null;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragOverHalf: (after: boolean) => void;
  onToggle: () => void;
  onShowStyle: () => void;
}) {
  const name = getAlgorithm(p.layer.algorithm).name;
  return (
    <div
      className={`fx-divider${p.layer.enabled ? "" : " off"}${dropClasses(p.dropBefore, p.dropAfter)}`}
      onDragOver={dragOverHalf(p.onDragOverHalf)}
    >
      <button type="button" className="fx-divider-main" onClick={p.onShowStyle} title="Show style settings">
        <span className="fx-divider-thumb" aria-hidden="true">
          <Canvas image={p.thumbnail} label="" />
        </span>
        <span className="fx-divider-text">
          <span className="fx-divider-label">Style</span>
          <span className="fx-name">{name}</span>
        </span>
      </button>
      <button
        type="button"
        className="fx-action"
        aria-label={p.layer.enabled ? "Turn off the dither" : "Turn on the dither"}
        title={p.layer.enabled ? "Turn off the dither" : "Turn on the dither"}
        onClick={p.onToggle}
      >
        {p.layer.enabled ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
      </button>
    </div>
  );
}

interface CardProps extends EffectListProps {
  layer: EffectLayer;
  index: number;
  stackLength: number;
  ditherIndex: number;
  expanded: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragOverHalf: (after: boolean) => void;
}

function EffectCard({ layer, index, stackLength, ditherIndex, expanded, dropBefore, dropAfter, onDragOverHalf, ...p }: CardProps) {
  const effect = getEffect(layer.effect);
  const [menuAt, setMenuAt] = useState<MenuPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // A card that opens (a new effect, or one you click) scrolls fully into view.
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [expanded]);
  const before = index < ditherIndex;
  // Moving down past yourself means inserting two slots further (see moveLayer).
  const moveUp = () => p.onMove(layer.id, index - 1);
  const moveDown = () => p.onMove(layer.id, index + 2);
  const moveAcross = () => p.onMove(layer.id, before ? ditherIndex + 1 : ditherIndex);

  return (
    <div
      ref={ref}
      className={`fx-card${expanded ? " expanded" : ""}${layer.enabled ? "" : " off"}${isDragging ? " dragging" : ""}${dropClasses(dropBefore, dropAfter)}`}
      onDragOver={dragOverHalf(onDragOverHalf)}
    >
      {/* Only the header drags, so sliders in the body still work. */}
      <div
        className="fx-head"
        draggable
        onDragStart={(e) => {
          dragging = layer.id;
          setIsDragging(true);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", layer.id);
        }}
        onDragEnd={() => {
          dragging = null;
          setIsDragging(false);
        }}
      >
        <button
          type="button"
          className="fx-title"
          aria-expanded={expanded}
          onClick={() => p.onExpand(expanded ? null : layer.id)}
          onKeyDown={(e) => {
            if (e.altKey && e.key === "ArrowUp" && index > 0) {
              e.preventDefault();
              moveUp();
            } else if (e.altKey && e.key === "ArrowDown" && index < stackLength - 1) {
              e.preventDefault();
              moveDown();
            } else if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              p.onRemove(layer.id);
            }
          }}
        >
          <ChevronIcon size={12} className="chev" />
          <span className={`fx-dot ${effect.category}`} aria-hidden="true" />
          <span className="fx-name">{effect.name}</span>
        </button>
        <button
          type="button"
          className="fx-action"
          aria-label={layer.enabled ? `Turn off ${effect.name}` : `Turn on ${effect.name}`}
          title={layer.enabled ? "Turn off" : "Turn on"}
          onClick={() => p.onToggle(layer.id)}
        >
          {layer.enabled ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
        </button>
        <button
          type="button"
          className="fx-action"
          aria-label={`More for ${effect.name}`}
          title="More"
          aria-expanded={menuAt !== null}
          onClick={(e) => {
            const pos = menuBelow(e.currentTarget, NARROW_MENU);
            setMenuAt((at) => (at ? null : pos));
          }}
        >
          <MoreIcon size={15} />
        </button>
      </div>
      {menuAt && (
        <FloatingMenu at={menuAt} label={`${effect.name} actions`} onClose={() => setMenuAt(null)} narrow>
          <MenuItem disabled={index === 0} onClick={moveUp} close={() => setMenuAt(null)}>
            Move up
          </MenuItem>
          <MenuItem disabled={index === stackLength - 1} onClick={moveDown} close={() => setMenuAt(null)}>
            Move down
          </MenuItem>
          <MenuItem onClick={moveAcross} close={() => setMenuAt(null)}>
            {before ? "Move after the dither" : "Move before the dither"}
          </MenuItem>
          <MenuItem onClick={() => p.onDuplicate(layer.id)} close={() => setMenuAt(null)}>
            Duplicate
          </MenuItem>
          <MenuItem onClick={() => p.onRemove(layer.id)} close={() => setMenuAt(null)} danger>
            Remove
          </MenuItem>
        </FloatingMenu>
      )}
      {expanded && (
        <div className="fx-body">
          <SettingsList layer={layer} onParam={p.onParam} />
          {effect.controls.length > 0 && <ResetButton onClick={() => p.onResetLayer(layer.id)} />}
        </div>
      )}
    </div>
  );
}
