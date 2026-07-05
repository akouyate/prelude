export const semantic = {
  background: {
    app: "#F9F8F3",
    panel: "rgb(255 255 255 / 0.76)",
    panelSolid: "#ffffff",
    subtle: "#f7f7ef",
  },
  border: {
    default: "#ece8de",
    strong: "#ddd8cc",
    active: "#171715",
  },
  focus: {
    ring: "oklch(0.748 0.18 121.09 / 0.32)",
  },
  radius: {
    control: "0.8125rem",
    panel: "1.375rem",
    pill: "9999px",
  },
} as const;

export type PreludeSemanticTokens = typeof semantic;
