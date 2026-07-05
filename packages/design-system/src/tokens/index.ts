import { colors } from "./colors";
import { semantic } from "./semantic";

export const tokens = {
  colors,
  semantic,
  fontFamily: {
    sans: "var(--font-sans), Inter, ui-sans-serif, system-ui, sans-serif",
    title: "var(--font-title-sans), ui-sans-serif, system-ui, sans-serif",
    display: "var(--font-display), Georgia, ui-serif, serif"
  },
  radius: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.25rem",
    "2xl": "1.5rem"
  },
  shadows: {
    focus: "0 0 0 3px rgb(104 116 63 / 0.24)",
    soft: "0 12px 32px rgb(23 23 21 / 0.08)"
  },
  spacing: {
    page: "clamp(1rem, 4vw, 2.5rem)"
  },
  breakpoints: {
    xs: "28rem",
    sm: "40rem",
    md: "48rem",
    lg: "64rem",
    xl: "80rem"
  },
  animation: {
    fast: "140ms ease",
    base: "200ms ease"
  }
} as const;

export type PreludeTokens = typeof tokens;
