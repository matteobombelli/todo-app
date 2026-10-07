import { useRef, type ReactNode } from "react";
import { isDate } from "../../shared/dates";

/**
 * The browser's own date picker, opened from code (a menu entry) rather than from a visible field.
 * Render `input` somewhere on the page, then call `pick(initial, onPick)`.
 */
export function useDatePicker(): [input: ReactNode, pick: (initial: string, onPick: (date: string) => void) => void] {
  const ref = useRef<HTMLInputElement>(null);
  const handler = useRef<((date: string) => void) | null>(null);

  const pick = (initial: string, onPick: (date: string) => void) => {
    const el = ref.current;
    if (!el) return;
    handler.current = onPick;
    el.value = initial;
    try {
      el.showPicker();
    } catch {
      // No showPicker (older Safari): focusing a date field opens its picker there.
      el.focus();
    }
  };

  const input = (
    <input
      ref={ref}
      type="date"
      className="date-picker"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => isDate(e.target.value) && handler.current?.(e.target.value)}
    />
  );
  return [input, pick];
}
