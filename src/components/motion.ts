import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/**
 * When the element's longest transition (delay included) ends, so timers follow the stylesheet
 * (and reduced motion) instead of a copied constant.
 */
export function transitionMs(el: Element): number {
  const style = getComputedStyle(el);
  const ms = (list: string) => list.split(",").map((s) => parseFloat(s) * 1000);
  const delays = ms(style.transitionDelay);
  return Math.max(...ms(style.transitionDuration).map((d, i) => d + (delays[i % delays.length] ?? 0)));
}

/** Keeps `present` true through the exit transition of `el`, so it can animate out before unmounting. */
export function usePresence(open: boolean, el: RefObject<HTMLElement | null>): boolean {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), el.current ? transitionMs(el.current) : 0);
    return () => clearTimeout(timer);
  }, [open, present, el]);
  return present;
}

/** A short vibration on devices that support it (Android); iOS has no web haptics, so it's a no-op there. */
export function haptic(): void {
  navigator.vibrate?.(8);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Matches the stylesheet's sidebar breakpoint. */
export const WIDE = "(min-width: 960px)";

/** Direction for the next route's view transition; styles.css animates `:root[data-nav]`. */
export function setNavDirection(dir: "push" | "pop" | "tab"): void {
  document.documentElement.dataset.nav = dir;
}
