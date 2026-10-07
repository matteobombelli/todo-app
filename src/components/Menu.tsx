import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePresence } from "./motion";

export type MenuEntry =
  | {
      label: string;
      /** An icon, or any small node (a list's colour dot). */
      icon?: LucideIcon | ReactNode;
      onSelect: () => void;
      destructive?: boolean;
      checked?: boolean;
    }
  | { label: string; icon?: LucideIcon | ReactNode; submenu: MenuEntry[] }
  | "separator";

interface Open {
  /** A new key for each opening, so a menu opened over another starts afresh. */
  key: number;
  entries: MenuEntry[];
  /** A pointer position (right-click) or the element that opened it (a kebab button). */
  at: { x: number; y: number } | DOMRect;
}

/** Room kept between the menu and the viewport edges. */
const MARGIN = 8;

function isIcon(icon: LucideIcon | ReactNode): icon is LucideIcon {
  // Lucide icons are forwardRef components: objects with a render function.
  return typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon);
}

/**
 * A context menu, iOS style: right-click a row, or click its kebab, for its actions. Render `menu`,
 * and pass `show` the mouse event and the entries; a right-click places the menu at the pointer, a
 * click anchors it under the clicked element (or, with `atPointer`, at the pointer too). Touch long-presses are left alone, since they drag rows.
 * A submenu replaces the menu's contents, with a row back to the parent.
 */
export function useMenu(): [menu: ReactNode, show: (e: MouseEvent, entries: MenuEntry[], atPointer?: boolean) => void] {
  const [open, setOpen] = useState<Open | null>(null);
  const [shown, setShown] = useState(false);
  const count = useRef(0);

  const show = useCallback((e: MouseEvent, entries: MenuEntry[], atPointer?: boolean) => {
    if (e.type === "contextmenu") {
      // Already handled (a long-press drag blocks it), or a touch long-press.
      if (e.defaultPrevented || (e.nativeEvent as PointerEvent).pointerType === "touch") return;
      e.preventDefault();
      setOpen({ key: ++count.current, entries, at: { x: e.clientX, y: e.clientY } });
    } else {
      e.stopPropagation();
      const at = atPointer ? { x: e.clientX, y: e.clientY } : (e.currentTarget as Element).getBoundingClientRect();
      setOpen({ key: ++count.current, entries, at });
    }
    setShown(true);
  }, []);

  const menu = open && (
    <MenuPopover
      key={open.key}
      entries={open.entries}
      at={open.at}
      shown={shown}
      onClose={() => setShown(false)}
      onExited={() => setOpen(null)}
    />
  );
  return [menu, show];
}

function MenuPopover({
  entries,
  at,
  shown,
  onClose,
  onExited,
}: Omit<Open, "key"> & { shown: boolean; onClose: () => void; onExited: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [stack, setStack] = useState<{ label: string; entries: MenuEntry[] }[]>([]);
  const present = usePresence(shown, ref);
  const current = stack.at(-1)?.entries ?? entries;

  useEffect(() => {
    if (!present) onExited();
  }, [present, onExited]);

  // Placed at the pointer, or under its button's right edge, flipped or nudged to stay on screen.
  // Re-measured when a submenu changes its size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Layout size: the entrance animation scales the box, which getBoundingClientRect would include.
    const { offsetWidth: width, offsetHeight: height } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x: number;
    let y: number;
    let origin: string;
    if (at instanceof DOMRect) {
      x = at.right - width;
      y = at.bottom + 4;
      origin = "top right";
      if (y + height > vh - MARGIN && at.top - height - 4 > MARGIN) {
        y = at.top - height - 4;
        origin = "bottom right";
      }
    } else {
      x = at.x + width > vw - MARGIN ? at.x - width : at.x;
      y = at.y + height > vh - MARGIN ? at.y - height : at.y;
      origin = `${y < at.y ? "bottom" : "top"} ${x < at.x ? "right" : "left"}`;
    }
    el.style.left = `${Math.max(MARGIN, Math.min(x, vw - width - MARGIN))}px`;
    el.style.top = `${Math.max(MARGIN, Math.min(y, vh - height - MARGIN))}px`;
    el.style.transformOrigin = origin;
  }, [at, current]);

  // Focus moves into the menu and goes back to whatever had it when the menu closes, unless it has
  // moved on (a click elsewhere). A chosen entry hands it back first, so a modal it opens keeps it.
  const restoreFocus = () => {
    if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    opener.current = document.activeElement;
  }, []);
  useEffect(() => {
    if (!shown && ref.current?.contains(document.activeElement)) restoreFocus();
  }, [shown]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [current]);

  useEffect(() => {
    if (!shown) return;
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    // A right-click elsewhere opens that row's menu instead; this one makes way.
    document.addEventListener("contextmenu", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [shown, onClose]);

  function onKeyDown(e: KeyboardEvent) {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "Escape") {
      if (stack.length) setStack((s) => s.slice(0, -1));
      else onClose();
    } else if (e.key === "ArrowDown") focus(index + 1);
    else if (e.key === "ArrowUp") focus(index - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(-1);
    else if (e.key === "ArrowLeft" && stack.length) setStack((s) => s.slice(0, -1));
    else if (e.key === "Tab") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  if (!present) return null;
  const icon = (i: LucideIcon | ReactNode | undefined) => {
    if (!i) return null;
    if (isIcon(i)) {
      const Icon = i;
      return <Icon size={17} strokeWidth={1.75} aria-hidden="true" />;
    }
    return i;
  };

  return createPortal(
    <div
      ref={ref}
      className={`menu${shown ? "" : " menu--closing"}`}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {stack.length > 0 && (
        <>
          <button
            type="button"
            role="menuitem"
            className="menu__item menu__item--back"
            onClick={() => setStack((s) => s.slice(0, -1))}
          >
            <ChevronLeft size={17} strokeWidth={2} aria-hidden="true" />
            <span className="menu__label">{stack.at(-1)!.label}</span>
          </button>
          <div className="menu__separator" role="separator" />
        </>
      )}
      {current.map((entry, i) => {
        if (entry === "separator") return <div key={i} className="menu__separator" role="separator" />;
        if ("submenu" in entry) {
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              className="menu__item"
              onClick={() => setStack((s) => [...s, { label: entry.label, entries: entry.submenu }])}
            >
              <span className="menu__label">{entry.label}</span>
              <span className="menu__icon">{icon(entry.icon) ?? <ChevronRight size={17} aria-hidden="true" />}</span>
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={entry.checked}
            className={`menu__item${entry.destructive ? " menu__item--destructive" : ""}`}
            onClick={() => {
              restoreFocus();
              onClose();
              entry.onSelect();
            }}
          >
            <span className="menu__label">{entry.label}</span>
            <span className="menu__icon">{icon(entry.icon)}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
