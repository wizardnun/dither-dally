import type { Layer } from "./types.ts";

/**
 * Moves layer `id` so it lands just before the layer currently at `toIndex`
 * (or at the end when `toIndex` is the list length): the convention of a
 * drop indicator drawn between rows. Out-of-range targets are clamped.
 * Returns the same array when nothing moves.
 */
export function moveLayer(layers: readonly Layer[], id: string, toIndex: number): readonly Layer[] {
  const from = layers.findIndex((l) => l.id === id);
  if (from < 0) return layers;
  let to = Math.max(0, Math.min(layers.length, toIndex));
  if (to > from) to--; // removing the layer first shifts later slots up by one
  if (to === from) return layers;
  const next = [...layers];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Inserts `layer` right after layer `afterId` (or at the end if it isn't found). */
export function insertLayerAfter(layers: readonly Layer[], afterId: string, layer: Layer): Layer[] {
  const at = layers.findIndex((l) => l.id === afterId);
  const next = [...layers];
  next.splice(at < 0 ? next.length : at + 1, 0, layer);
  return next;
}

/** Removes an effect layer. The dither layer can't be removed; the list is returned unchanged. */
export function removeLayer(layers: readonly Layer[], id: string): readonly Layer[] {
  const layer = layers.find((l) => l.id === id);
  if (!layer || layer.kind === "dither") return layers;
  return layers.filter((l) => l.id !== id);
}
