import { useRef, useState, type FormEvent } from "react";

/**
 * The row a new item is typed into, opened by tapping a row (or the space below them). Return adds
 * the item and leaves the row open for the next; leaving the field adds what was typed and closes it,
 * as does Escape, which drops the text. `chip` shows what the item inherits (its due date).
 */
export function ItemDraft({
  nested,
  chip,
  onAdd,
  onClose,
}: {
  nested?: boolean;
  chip?: string | null;
  /** `next` is true for Return, which keeps the row open for another item. */
  onAdd: (title: string, next: boolean) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const cancelled = useRef(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return onClose();
    onAdd(trimmed, true);
    setTitle("");
  }

  function onBlur() {
    if (!cancelled.current && title.trim()) onAdd(title.trim(), false);
    // The row can outlive this (a newer draft in its place keeps the component), so it never
    // keeps text that was already added.
    setTitle("");
    cancelled.current = false;
    onClose();
  }

  return (
    <form className={`row item item--draft${nested ? " item--subtask" : ""}`} onSubmit={onSubmit}>
      <span className="check" aria-hidden="true">
        <span className="check__box" />
      </span>
      <input
        autoFocus
        className="item__input"
        placeholder="New item"
        aria-label="New item"
        maxLength={500}
        enterKeyHint="next"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          // The Enter or Escape that ends an IME composition is the input method's, not the row's
          // (Safari doesn't flag it isComposing: keyCode 229).
          if (e.nativeEvent.isComposing || e.keyCode === 229) {
            if (e.key === "Enter") e.preventDefault();
            return;
          }
          if (e.key !== "Escape") return;
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }}
      />
      {chip && <span className="chip">{chip}</span>}
    </form>
  );
}
