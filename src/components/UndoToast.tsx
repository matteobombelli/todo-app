import { useSyncExternalStore } from "react";
import type { Entity } from "../../shared/entities";
import { store } from "../data/instance";

/** How long a deletion can be undone before it is written. */
export const UNDO_MS = 5000;

interface Toast {
  key: number;
  message: string;
  undo: () => void;
}

let current: Toast | null = null;
let count = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Toast | null): void {
  current = next;
  for (const l of listeners) l();
}

/** Shows `message` with an Undo button for UNDO_MS, replacing any toast already showing. */
export function offerUndo(message: string, undo: () => void): void {
  clearTimeout(timer);
  const key = ++count;
  set({ key, message, undo });
  timer = setTimeout(() => current?.key === key && set(null), UNDO_MS);
}

/**
 * Deletes a record (with what its deletion takes along) at once on screen, with an Undo toast
 * instead of a confirmation. The delete is written once the toast has gone.
 */
export function removeWithUndo(entity: Entity, id: string, message: string): void {
  offerUndo(message, store.removeLater(entity, id, UNDO_MS));
}

/** Renders the undo toast; mounted once, in the shell. */
export function UndoToast() {
  const toast = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!toast) return null;
  return (
    <div key={toast.key} className="toast" role="status">
      <span className="toast__message">{toast.message}</span>
      <button
        type="button"
        className="button--secondary"
        onClick={() => {
          toast.undo();
          set(null);
        }}
      >
        Undo
      </button>
    </div>
  );
}
