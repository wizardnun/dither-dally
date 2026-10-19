import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ALGORITHMS, FAMILY_LABELS, type Family } from "@dither-dally/core";
import { Canvas } from "./Canvas.tsx";
import { SearchIcon } from "./icons.tsx";

type Category = Family | "all";
const families = Object.keys(FAMILY_LABELS) as Family[];

interface Props {
  selected: string;
  thumbnails: Record<string, ImageData>;
  /** Space covered by the inspector on the right; the gallery docks just left of it. */
  rightInset: number;
  onPreview: (id: string | null) => void;
  onChoose: (id: string) => void;
  onClose: () => void;
}

/**
 * Style gallery docked beside the inspector, so the canvas stays visible.
 * Hovering or arrowing through styles previews them on the canvas; clicking
 * or Enter applies one. Clicking the canvas or Escape closes it.
 */
export function Gallery({ selected, thumbnails, rightInset, onPreview, onChoose, onClose }: Props) {
  const current = ALGORITHMS.find((a) => a.id === selected);
  const [category, setCategory] = useState<Category>(() => lastCategory ?? current?.family ?? "all");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lastCategory = category;
  }, [category]);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      onPreview(null);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      ALGORITHMS.filter((a) => {
        if (q) return [a.name, a.summary, FAMILY_LABELS[a.family], a.reference?.author ?? ""].join(" ").toLowerCase().includes(q);
        return category === "all" || a.family === category;
      }),
    [q, category],
  );

  // Arrow keys move between cards; the focused card is previewed.
  function onGridKey(e: ReactKeyboardEvent) {
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>(".style-card") ?? []);
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const perRow = Math.max(1, Math.round(gridRef.current!.clientWidth / (cards[0]!.offsetWidth + 12)));
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + perRow, ArrowUp: i - perRow }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    cards[Math.min(cards.length - 1, Math.max(0, next))]?.focus();
  }

  return (
    <div className="gallery-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gallery" role="dialog" aria-label="Styles" style={{ right: rightInset + 10 }}>
        <div className="gallery-search">
          <SearchIcon size={15} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search styles"
            aria-label="Search styles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                gridRef.current?.querySelector<HTMLButtonElement>(".style-card")?.focus();
              } else if (e.key === "Enter" && visible[0]) {
                onChoose(visible[0].id);
              }
            }}
          />
        </div>

        <nav className="gallery-cats" aria-label="Categories">
          {(["all", ...families] as Category[]).map((c) => {
            const count = c === "all" ? ALGORITHMS.length : ALGORITHMS.filter((a) => a.family === c).length;
            return (
              <button
                key={c}
                type="button"
                className="cat"
                aria-current={!q && category === c ? "true" : undefined}
                onClick={() => {
                  setCategory(c);
                  setQuery("");
                }}
              >
                <span>{c === "all" ? "All styles" : FAMILY_LABELS[c]}</span>
                <span className="count">{count}</span>
              </button>
            );
          })}
        </nav>

        <div className="gallery-body">
          <h2 className="gallery-heading">
            {q ? `Results for “${query.trim()}”` : category === "all" ? "All styles" : FAMILY_LABELS[category]}
          </h2>
          {visible.length === 0 ? (
            <p className="gallery-empty">No styles match “{query.trim()}”. Try a name like “halftone”, or a person like “Bayer”.</p>
          ) : (
            <div ref={gridRef} className="style-grid" onKeyDown={onGridKey} onPointerLeave={() => onPreview(null)}>
              {visible.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="style-card"
                  aria-current={a.id === selected ? "true" : undefined}
                  title={a.summary}
                  onPointerEnter={() => onPreview(a.id)}
                  onFocus={() => onPreview(a.id)}
                  onClick={() => onChoose(a.id)}
                >
                  <span className="style-thumb">
                    <Canvas image={thumbnails[a.id] ?? null} label="" />
                  </span>
                  <span className="style-name">{a.name}</span>
                  {(q || category === "all") && <span className="style-family">{FAMILY_LABELS[a.family]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The gallery reopens on the category you last looked at. */
let lastCategory: Category | null = null;
