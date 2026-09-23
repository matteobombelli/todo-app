import { Check } from "lucide-react";

/** A native checkbox, visually replaced so the tick can animate. */
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <span className="check">
      <input type="checkbox" className="check__input" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="check__box" aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
    </span>
  );
}
