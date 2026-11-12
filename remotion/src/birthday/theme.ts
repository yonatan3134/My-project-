export const COLORS = {
  night: "#0b1020",
  indigo: "#1e1b4b",
  gold: "#facc15",
  coral: "#fb7185",
  sky: "#38bdf8",
  mint: "#34d399",
  white: "#ffffff",
} as const;

export const PARTY_COLORS = [
  COLORS.gold,
  COLORS.coral,
  COLORS.sky,
  COLORS.mint,
  COLORS.white,
];

export const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
