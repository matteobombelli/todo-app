import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * A textarea that grows with what's typed, from `rows` lines, instead of scrolling inside itself
 * or showing a resize handle. (CSS field-sizing does this where it's supported; this covers the rest.)
 */
export function TextArea({ rows = 2, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const el = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = el.current;
    if (!t || CSS.supports("field-sizing", "content")) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [value]);
  return <textarea ref={el} rows={rows} value={value} {...props} />;
}

/** An on/off switch: a native checkbox with the switch role, drawn as a track and thumb. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        className="switch__input"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true" />
    </span>
  );
}
