import { PALETTE_KEYS, type PaletteKey } from "../../shared/palette";

export function paletteVar(key: string): string {
  return `var(--palette-${key})`;
}

export function ColorPicker({ value, onChange }: { value: PaletteKey; onChange: (key: PaletteKey) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Colour">
      {PALETTE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={key === value}
          aria-label={key}
          className="color-picker__swatch"
          style={{ background: paletteVar(key) }}
          onClick={() => onChange(key)}
        />
      ))}
    </div>
  );
}
