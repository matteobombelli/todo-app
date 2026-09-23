// The only place colour values live. Lists and events store a key; the client turns each key into a
// CSS variable (--palette-<key>) that follows the colour scheme.
export const PALETTE = {
  red: { light: "#d64545", dark: "#f07070" },
  orange: { light: "#e0782b", dark: "#f59a55" },
  yellow: { light: "#c99a06", dark: "#e8c143" },
  green: { light: "#3c9a4f", dark: "#6cc47d" },
  teal: { light: "#1f9189", dark: "#4cc2b8" },
  blue: { light: "#3478c6", dark: "#6aa6ea" },
  indigo: { light: "#5b5bd6", dark: "#8d8df2" },
  purple: { light: "#8e4ec6", dark: "#b88ae8" },
  brown: { light: "#8d6446", dark: "#bb9171" },
  gray: { light: "#6b6b76", dark: "#9a9aa6" },
} as const;

export type PaletteKey = keyof typeof PALETTE;
export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];

// Save-the-date's theme colour; its entries are not user-colourable.
export const STD_COLOR = "#d6336c";
