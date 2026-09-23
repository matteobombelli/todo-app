import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";
import { haptic, usePresence } from "./motion";

export interface ModalProps {
  open: boolean;
  /** Asks to close; the owner sets `open` to false, and the modal animates out. */
  onClose: () => void;
  /** Runs once the exit animation has finished. */
  onExited?: () => void;
  title?: string;
  /**
   * Editors are bottom sheets on phones and side panels on wide screens; a dialog is a sheet on
   * phones and a centred box everywhere else.
   */
  variant?: "panel" | "dialog";
  children: ReactNode;
}

/** Open modals, innermost last: Escape only closes the top one. */
const stack: symbol[] = [];

const DISMISS_SHARE = 0.3;
const FLICK = 0.5; // px/ms

/**
 * State for a modal that owns its own closing: it opens on mount, `close()` animates it out, and
 * `onExited` (usually the parent unmounting it) runs afterwards. Spread the first element into Modal.
 */
export function useModal(onExited: () => void): [Pick<ModalProps, "open" | "onClose" | "onExited">, () => void] {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  return [{ open, onClose: close, onExited }, close];
}

export function Modal({ open, onClose, onExited, title, variant = "panel", children }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const drag = useRef<{ y: number; t: number; dy: number; id: number; moved: boolean } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const present = usePresence(open, dialog);
  const shown = useRef(false);

  useEffect(() => {
    if (present) shown.current = true;
    else if (shown.current) {
      shown.current = false;
      onExited?.();
    }
  }, [present, onExited]);

  // Focus starts on the close button and returns to whatever opened the modal.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    header.current?.querySelector("button")?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  // Keyed on `open` alone: re-running on a new onClose would move this modal to the top of the stack.
  useEffect(() => {
    if (!open) return;
    const id = Symbol();
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack.at(-1) === id) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stack.splice(stack.indexOf(id), 1);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Drag down from the handle or header to dismiss; only phones render the modal as a sheet.
  function onPointerDown(e: PointerEvent) {
    if (!open || !window.matchMedia("(max-width: 719px)").matches) return;
    drag.current = { y: e.clientY, t: e.timeStamp, dy: 0, id: e.pointerId, moved: false };
  }
  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    const el = dialog.current;
    if (!d || !el || e.pointerId !== d.id) return;
    d.dy = Math.max(0, e.clientY - d.y);
    // Capture only once it's a drag, so a tap on the close button still clicks.
    if (!d.moved && d.dy > 6) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      el.style.transition = "none";
    }
    if (d.moved) el.style.transform = `translateY(${d.dy}px)`;
  }
  function onPointerUp(e: PointerEvent) {
    const d = drag.current;
    const el = dialog.current;
    drag.current = null;
    if (!d || !el || !d.moved) return;
    const velocity = d.dy / Math.max(1, e.timeStamp - d.t);
    el.style.transition = "";
    el.style.transform = "";
    if (e.type === "pointerup" && (d.dy > el.offsetHeight * DISMISS_SHARE || velocity > FLICK)) {
      haptic();
      onClose();
    }
  }

  if (!present) return null;
  // Portalled to body: a transformed ancestor would otherwise become the fixed backdrop's
  // containing block and clip the modal.
  return createPortal(
    <div className={`modal__backdrop modal__backdrop--${variant}${open ? "" : " modal__backdrop--closing"}`} onMouseDown={onClose}>
      <div
        ref={dialog}
        className={`modal modal--${variant}${open ? "" : " modal--closing"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header
          className="modal__header"
          ref={header}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="modal__handle" aria-hidden="true" />
          <h2 className="modal__title">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
