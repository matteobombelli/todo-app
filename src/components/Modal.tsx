import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "md" | "full";
  children: ReactNode;
}

export function Modal({ open, onClose, title, size = "md", children }: ModalProps) {
  const header = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  // Focus starts on the close button and returns to whatever opened the modal.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    header.current?.querySelector("button")?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Portalled to body: a transformed ancestor (the page-in animation) would otherwise become the fixed
  // backdrop's containing block and clip the modal.
  return createPortal(
    <div className="modal__backdrop" onMouseDown={onClose}>
      <div
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal__header" ref={header}>
          <h2 className="modal__title">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
