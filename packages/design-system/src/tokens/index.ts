import { colors } from "./colors";

export const tokens = {
  colors,
  fontFamily: {
    sans: "var(--font-sans), Inter, ui-sans-serif, system-ui, sans-serif"
  },
  radius: {
    xs: "0.25rem",
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.75rem"
  },
  shadows: {
    focus: "0 0 0 3px rgb(47 159 103 / 0.24)",
    soft: "0 12px 32px rgb(21 24 29 / 0.08)"
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
