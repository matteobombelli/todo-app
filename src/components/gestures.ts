import { useEffect, useRef, type RefObject } from "react";
import { haptic } from "./motion";

/** Movement before a touch counts as a swipe; below it, taps and vertical scrolls pass through. */
const SLOP = 10;
const FLICK = 0.5; // px/ms

/**
 * Horizontal touch swipes on `ref`: the element follows the finger, then either snaps back or calls
 * `onSwipe` (-1 for a swipe to the right, i.e. back or previous; 1 for a swipe to the left).
 * With `edge`, only a swipe to the right that starts within `edge` px of the left side counts, and
 * the element slides fully off before `onSwipe` runs, like iOS's back gesture.
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
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let locked = false;
    let dx = 0;

    const settle = (transform: string, then?: () => void) => {
      el.style.transition = "transform var(--medium) var(--ease-out)";
      el.style.transform = transform;
      // transitionend bubbles from children (rows, checkboxes), so only the element's own counts.
      const done = (e: TransitionEvent) => {
        if (e.target !== el) return;
        el.removeEventListener("transitionend", done);
        el.style.transition = "";
        if (!then) el.style.transform = "";
        then?.();
      };
      el.addEventListener("transitionend", done);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || (edge !== undefined && e.clientX > edge)) return;
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
      locked = false;
      dx = 0;
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      dx = e.clientX - start.x;
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
      const shown = edge !== undefined ? Math.max(0, dx) : dx * 0.4;
      el.style.transform = `translateX(${shown}px)`;
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const velocity = dx / Math.max(1, e.timeStamp - start.t);
      start = null;
      if (!locked) return;
      const threshold = edge !== undefined ? el.offsetWidth / 3 : 60;
      const passed = e.type === "pointerup" && (Math.abs(dx) > threshold || Math.abs(velocity) > FLICK);
      const dir = dx > 0 ? -1 : 1;
      if (!passed || (edge !== undefined && dir !== -1)) return settle("");
      haptic();
      if (edge !== undefined) settle("translateX(100%)", () => callback.current(dir));
      else {
        el.style.transition = "";
        el.style.transform = "";
        callback.current(dir);
      }
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
