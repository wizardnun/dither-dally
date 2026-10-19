import { useCallback, useRef, useState } from "react";

const LIMIT = 200;
/** Changes with the same key this close together become one undo step (e.g. a slider drag). */
const COALESCE_MS = 700;

export interface History<T> {
  state: T;
  /** Apply a change. Pass `key` to merge rapid repeated changes into one undo step. */
  set: (update: (s: T) => T, key?: string) => void;
  /** Replace the state without creating an undo step (e.g. loading). */
  reset: (s: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(initial: () => T): History<T> {
  const [h, setH] = useState(() => ({ past: [] as T[], present: initial(), future: [] as T[] }));
  const last = useRef<{ key: string; at: number } | null>(null);

  const set = useCallback((update: (s: T) => T, key?: string) => {
    const now = Date.now();
    const merge = key !== undefined && last.current?.key === key && now - last.current.at < COALESCE_MS;
    last.current = key !== undefined ? { key, at: now } : null;
    setH((h) => {
      const next = update(h.present);
      if (Object.is(next, h.present)) return h;
      return {
        past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const reset = useCallback((s: T) => {
    last.current = null;
    setH({ past: [], present: s, future: [] });
  }, []);

  const undo = useCallback(() => {
    last.current = null;
    setH((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] } : h));
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setH((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h));
  }, []);

  return { state: h.present, set, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
