import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { haptic, transitionMs } from "./motion";

/** Movement before a touch counts as a swipe; below it, taps and vertical scrolls pass through. */
const SLOP = 10;
const FLICK = 0.5; // px/ms
/** Flick speed is measured over the last moves only, so a slow drag ending in a flick still counts. */
const VELOCITY_WINDOW = 100; // ms

const pending = new WeakMap<HTMLElement, (e: TransitionEvent) => void>();

/**
 * Animates `el` to `transform`, then runs `then` and leaves the transform in place for the caller
 * to reset; without `then` it's a snap back and the transform is cleared. A new slide replaces one
 * still running, so its `then` never fires.
 */
export function slide(el: HTMLElement, transform: string, then?: () => void): void {
  const previous = pending.get(el);
  if (previous) el.removeEventListener("transitionend", previous);
  el.style.transition = "transform var(--medium) var(--ease-out)";
  el.style.transform = transform;
  // transitionend bubbles from children (rows, checkboxes), so only the element's own counts.
  const done = (e: TransitionEvent) => {
    if (e.target !== el) return;
    el.removeEventListener("transitionend", done);
    pending.delete(el);
    el.style.transition = "";
    if (!then) el.style.transform = "";
    then?.();
  };
  pending.set(el, done);
  el.addEventListener("transitionend", done);
}

export function isSliding(el: HTMLElement): boolean {
  return pending.has(el);
}

/** Puts `el` back in place at once, dropping a slide still running. */
export function resetSlide(el: HTMLElement): void {
  const previous = pending.get(el);
  if (previous) el.removeEventListener("transitionend", previous);
  pending.delete(el);
  el.style.transition = "";
  el.style.transform = "";
}

/**
 * Horizontal touch swipes on `ref`: the element follows the finger, then either snaps back or slides
 * a full width off and calls `onSwipe` (-1 for a swipe to the right, i.e. back or previous; 1 for a
 * swipe to the left). The element is left slid off; the owner resets its transform once the next
 * content is in place (or unmounts it).
 * With `edge`, only a swipe to the right that starts within `edge` px of the left side counts, like
 * iOS's back gesture.
 * The element needs `touch-action: pan-y` so the browser leaves horizontal moves to us.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (dir: 1 | -1) => void, edge?: number): void {
  const callback = useRef(onSwipe);
  useEffect(() => {
    callback.current = onSwipe;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; id: number } | null = null;
    let locked = false;
    let dx = 0;
    let samples: { x: number; t: number }[] = [];

    const down = (e: PointerEvent) => {
      // A touch while the element is still sliding off would restart it from the wrong place.
      if (e.pointerType !== "touch" || (edge !== undefined && e.clientX > edge) || isSliding(el)) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      locked = false;
      dx = 0;
      samples = [{ x: e.clientX, t: e.timeStamp }];
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      dx = e.clientX - start.x;
      samples.push({ x: e.clientX, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW) samples.shift();
      const dy = e.clientY - start.y;
      if (!locked) {
        if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) start = null;
        else if (Math.abs(dx) > SLOP) {
          locked = true;
          el.setPointerCapture(e.pointerId);
          el.style.transition = "none";
        }
        return;
      }
      const shown = edge !== undefined ? Math.max(0, dx) : dx;
      el.style.transform = `translateX(${shown}px)`;
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!locked) return;
      const first = samples[0];
      // Speed in the direction of the swipe: a flick back the other way cancels it.
      const toward = (Math.sign(dx) * (e.clientX - first.x)) / Math.max(1, e.timeStamp - first.t);
      const passed = e.type === "pointerup" && toward > -FLICK && (Math.abs(dx) > el.offsetWidth / 3 || toward > FLICK);
      const dir = dx > 0 ? -1 : 1;
      if (!passed || (edge !== undefined && dir !== -1)) return slide(el, "");
      haptic();
      slide(el, `translateX(${-dir * 100}%)`, () => callback.current(dir));
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [ref, edge]);
}

/** How long a press is held before its row lifts for dragging. */
const HOLD = 400; // ms

interface Lifted {
  li: HTMLElement;
  rows: HTMLElement[];
  /** Where the pointer was when the row lifted. */
  y: number;
  id: number;
}

/**
 * Long-press dragging of the <li> children of `list`: hold a row still for HOLD ms and it lifts
 * (`lift`), then `move` follows the pointer and `drop` ends it (`e.type` is "pointercancel" when the
 * browser took the pointer). Moving earlier cancels the hold, so scrolls and taps work as usual; the
 * click that ends a drag is swallowed, and the page doesn't scroll under a lifted row. Returns the
 * cleanup.
 */
function longPressDrag(
  list: HTMLElement,
  on: { lift?: (d: Lifted) => void; move: (d: Lifted, e: PointerEvent) => void; drop: (d: Lifted, e: PointerEvent) => void },
): () => void {
  let hold: { x: number; y: number; id: number; li: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  let drag: Lifted | null = null;
  let swallowClick = false;

  const cancelHold = () => {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  };
  const lift = () => {
    if (!hold) return;
    const { li, y, id } = hold;
    hold = null;
    const rows = [...list.children] as HTMLElement[];
    drag = { li, rows, y, id };
    swallowClick = true;
    list.setPointerCapture(id);
    for (const row of rows) {
      // Moving a row in the DOM would replay its entrance animation.
      row.style.animation = "none";
      row.style.transition = row === li ? "none" : "transform var(--fast) var(--ease-out)";
    }
    li.classList.add("drag--lifted");
    haptic();
    on.lift?.(drag);
  };

  const down = (e: PointerEvent) => {
    swallowClick = false;
    const li = (e.target as Element).closest("li");
    if (e.button !== 0 || !li || li.parentElement !== list) return;
    hold = { x: e.clientX, y: e.clientY, id: e.pointerId, li, timer: setTimeout(lift, HOLD) };
  };
  const move = (e: PointerEvent) => {
    if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) cancelHold();
    if (drag && e.pointerId === drag.id) on.move(drag, e);
  };
  const up = (e: PointerEvent) => {
    if (hold && e.pointerId === hold.id) cancelHold();
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.li.classList.remove("drag--lifted");
    d.li.style.transition = "transform var(--fast) var(--ease-out)";
    on.drop(d, e);
  };
  const click = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  // Once a row is lifted, the finger drags it rather than scrolling the page (or, with a mouse,
  // dragging the link out).
  const block = (e: Event) => {
    if (drag || hold) e.preventDefault();
  };
  const blockScroll = (e: TouchEvent) => {
    if (drag) e.preventDefault();
  };

  list.addEventListener("pointerdown", down);
  list.addEventListener("pointermove", move);
  list.addEventListener("pointerup", up);
  list.addEventListener("pointercancel", up);
  list.addEventListener("click", click, true);
  list.addEventListener("contextmenu", block);
  list.addEventListener("dragstart", block);
  list.addEventListener("touchmove", blockScroll, { passive: false });
  return () => {
    cancelHold();
    list.removeEventListener("pointerdown", down);
    list.removeEventListener("pointermove", move);
    list.removeEventListener("pointerup", up);
    list.removeEventListener("pointercancel", up);
    list.removeEventListener("click", click, true);
    list.removeEventListener("contextmenu", block);
    list.removeEventListener("dragstart", block);
    list.removeEventListener("touchmove", blockScroll);
  };
}

/**
 * A dropped row keeps its dropped position until the list renders `order` (its children's keys,
 * in order) differently, so there's no flash of the old layout before the change lands.
 */
function useSettleOnOrder(ref: RefObject<HTMLElement | null>, order: string): void {
  useLayoutEffect(() => {
    for (const li of ref.current?.children ?? []) {
      (li as HTMLElement).style.transform = "";
      (li as HTMLElement).style.transition = "";
    }
  }, [ref, order]);
}

/**
 * Long-press sorting of the <li> children of the list `ref`: lift a row, drag it up or down and let
 * go. `onMove(from, to)` gets the old and new index.
 */
export function useSortable(ref: RefObject<HTMLElement | null>, order: string, onMove: (from: number, to: number) => void): void {
  const callback = useRef(onMove);
  useEffect(() => {
    callback.current = onMove;
  });
  useSettleOnOrder(ref, order);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    let from = 0;
    let to = 0;
    let size = 0;

    const shift = (rows: HTMLElement[], target: number) =>
      rows.forEach((row, i) => {
        if (i === from) return;
        const offset = from < i && i <= target ? -size : target <= i && i < from ? size : 0;
        row.style.transform = offset ? `translateY(${offset}px)` : "";
      });

    return longPressDrag(list, {
      lift: ({ li, rows }) => {
        from = to = rows.indexOf(li);
        // Rows are the same height apart from wrapped titles, so one row's step stands for all.
        const next = rows[from + 1] ?? rows[from - 1];
        size = next ? Math.abs(next.getBoundingClientRect().top - li.getBoundingClientRect().top) : li.offsetHeight;
      },
      move: ({ li, rows, y }, e) => {
        const dy = e.clientY - y;
        li.style.transform = `translateY(${dy}px)`;
        const target = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / size)));
        if (target !== to) shift(rows, (to = target));
      },
      drop: ({ li, rows }, e) => {
        if (e.type !== "pointerup") to = from;
        shift(rows, to);
        li.style.transform = to !== from ? `translateY(${(to - from) * size}px)` : "";
        const [a, b] = [from, to];
        if (a !== b) setTimeout(() => callback.current(a, b), transitionMs(li));
      },
    });
  }, [ref]);
}

/**
 * Long-press dropping of one row onto another, for the <li> children of the list `ref`, each
 * carrying its record's id in `data-id`. While a lifted row hovers a row that `accepts` it, that row
 * is marked as the target; `onDrop(dragged, target)` gets `null` for a drop onto no row.
 */
export function useDropOnto(
  ref: RefObject<HTMLElement | null>,
  order: string,
  accepts: (dragged: string, target: string) => boolean,
  onDrop: (dragged: string, target: string | null) => void,
): void {
  const callbacks = useRef({ accepts, onDrop });
  useEffect(() => {
    callbacks.current = { accepts, onDrop };
  });
  useSettleOnOrder(ref, order);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    let over: HTMLElement | null = null;
    let slot: DOMRect | null = null;

    // The lifted row is always under the pointer, so look past it.
    const rowUnder = (li: HTMLElement, e: PointerEvent) =>
      document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((el) => el.closest("li"))
        .find((el): el is HTMLLIElement => !!el && el !== li && el.parentElement === list) ?? null;
    const mark = (row: HTMLElement | null) => {
      over?.classList.remove("drag--target");
      over = row;
      over?.classList.add("drag--target");
    };

    return longPressDrag(list, {
      lift: ({ li }) => {
        slot = li.getBoundingClientRect();
        li.classList.add("drag--floating");
      },
      move: ({ li, y }, e) => {
        li.style.transform = `translateY(${e.clientY - y}px)`;
        const row = rowUnder(li, e);
        mark(row && callbacks.current.accepts(li.dataset.id!, row.dataset.id!) ? row : null);
      },
      drop: ({ li }, e) => {
        mark(null);
        li.classList.remove("drag--floating");
        // Snaps back; a change lands when the list re-renders (useSettleOnOrder).
        li.style.transform = "";
        if (e.type !== "pointerup") return;
        const row = rowUnder(li, e);
        const dragged = li.dataset.id!;
        if (row) {
          if (callbacks.current.accepts(dragged, row.dataset.id!)) callbacks.current.onDrop(dragged, row.dataset.id!);
        } else if (slot && (e.clientY < slot.top || e.clientY > slot.bottom)) {
          // Let go over no row and away from where it started: dropped onto nothing.
          callbacks.current.onDrop(dragged, null);
        }
      },
    });
  }, [ref]);
}

/**
 * Single-key shortcuts (`e.key` to handler). Ignored while typing in a field or while a modal is
 * open, so they never steal keystrokes.
 */
export function useShortcuts(keys: Record<string, () => void>): void {
  const current = useRef(keys);
  useEffect(() => {
    current.current = keys;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as Element).closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector("[aria-modal]")) return;
      const handler = current.current[e.key];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
