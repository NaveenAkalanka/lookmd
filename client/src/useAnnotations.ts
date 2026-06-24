/**
 * Per-file annotation state with undo/redo history and optional local persistence.
 *
 * History is a past/present/future stack over the whole marks array, so every
 * operation — add, move, recolour, resize, erase, clear — is undoable and
 * redoable. Continuous gestures (dragging a mark, sweeping the eraser) pass a
 * shared `coalesce` key so the whole gesture collapses into one history step
 * instead of dozens.
 *
 * Ephemeral by default: the present vanishes when `fileKey` changes (you leave
 * the file) or on reload. When `pinned` is on — or a stored entry already exists
 * — the present is loaded from and written through to localStorage so it survives
 * reload. The `.md` file is never touched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Mark,
  getAnnotations,
  setAnnotations,
  clearAnnotations,
  isPinned,
} from './annotations';

export interface UseAnnotations {
  marks: Mark[];
  pinned: boolean;
  canUndo: boolean;
  canRedo: boolean;
  addMark: (mark: Mark) => void;
  eraseMark: (id: string, coalesce?: string) => void;
  updateMark: (id: string, patch: Partial<Mark>, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  setPinned: (on: boolean) => void;
}

interface History {
  past: Mark[][];
  present: Mark[];
  future: Mark[][];
}

const EMPTY: History = { past: [], present: [], future: [] };

export function useAnnotations(fileKey: string): UseAnnotations {
  const [hist, setHist] = useState<History>(EMPTY);
  const [pinned, setPinnedState] = useState(false);

  const keyRef = useRef(fileKey);
  const pinnedRef = useRef(pinned);
  // The coalesce key of the in-progress gesture; matching keys fold into one step.
  const coalesceRef = useRef<string | null>(null);
  keyRef.current = fileKey;
  pinnedRef.current = pinned;

  // Load when the file changes: hydrate from storage if kept, else empty. Reset
  // history so undo can't cross file boundaries.
  useEffect(() => {
    coalesceRef.current = null;
    const stored = getAnnotations(fileKey);
    if (stored) {
      setHist({ past: [], present: stored.marks, future: [] });
      setPinnedState(true);
    } else {
      setHist(EMPTY);
      setPinnedState(isPinned(fileKey));
    }
  }, [fileKey]);

  const persist = useCallback((next: Mark[]) => {
    if (pinnedRef.current) setAnnotations(keyRef.current, { marks: next });
  }, []);

  /** Apply a change, pushing a history step — unless `coalesce` matches the
   *  current gesture, in which case it replaces the present without a new step. */
  const mutate = useCallback(
    (fn: (prev: Mark[]) => Mark[], coalesce?: string) => {
      setHist((h) => {
        const present = fn(h.present);
        persist(present);
        if (coalesce && coalesceRef.current === coalesce) {
          return { ...h, present };
        }
        coalesceRef.current = coalesce ?? null;
        return { past: [...h.past, h.present], present, future: [] };
      });
    },
    [persist],
  );

  const addMark = useCallback((mark: Mark) => mutate((p) => [...p, mark]), [mutate]);
  const eraseMark = useCallback(
    (id: string, coalesce?: string) => mutate((p) => p.filter((m) => m.id !== id), coalesce),
    [mutate],
  );
  const updateMark = useCallback(
    (id: string, patch: Partial<Mark>, coalesce?: string) =>
      mutate((p) => p.map((m) => (m.id === id ? ({ ...m, ...patch } as Mark) : m)), coalesce),
    [mutate],
  );

  const undo = useCallback(() => {
    coalesceRef.current = null;
    setHist((h) => {
      if (!h.past.length) return h;
      const present = h.past[h.past.length - 1]!;
      persist(present);
      return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future] };
    });
  }, [persist]);

  const redo = useCallback(() => {
    coalesceRef.current = null;
    setHist((h) => {
      if (!h.future.length) return h;
      const present = h.future[0]!;
      persist(present);
      return { past: [...h.past, h.present], present, future: h.future.slice(1) };
    });
  }, [persist]);

  const clear = useCallback(() => {
    coalesceRef.current = null;
    clearAnnotations(keyRef.current);
    setPinnedState(false);
    pinnedRef.current = false;
    setHist((h) => (h.present.length === 0 ? h : { past: [...h.past, h.present], present: [], future: [] }));
  }, []);

  const setPinned = useCallback((on: boolean) => {
    setPinnedState(on);
    pinnedRef.current = on;
    setHist((h) => {
      if (on) setAnnotations(keyRef.current, { marks: h.present });
      else clearAnnotations(keyRef.current);
      return h;
    });
  }, []);

  return {
    marks: hist.present,
    pinned,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    addMark,
    eraseMark,
    updateMark,
    undo,
    redo,
    clear,
    setPinned,
  };
}
