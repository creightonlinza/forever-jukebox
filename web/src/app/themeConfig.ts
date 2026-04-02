export type ThemeName = "light" | "dark";

export const themeConfig: Record<ThemeName, Record<string, string>> = {
  dark: {
    // Core
    "--bg": "#0F1115",
    "--text": "#E7E4DD",
    "--text-rgb": "231, 228, 221",
    "--muted": "#9AA3B2",
    "--accent": "#4AC7FF",
    "--title-accent": "#F1C47A",
    "--title-glow": "rgba(241, 196, 122, 0.55)",

    // Surfaces
    "--surface-panel": "#141922",
    "--surface-hero": "#1A1F27",
    "--surface-control": "#1F2633",
    "--surface-control-hover": "#202835",

    // Borders
    "--border-panel": "#283142",
    "--border-hero": "#2B3442",
    "--border-control": "#3B465B",

    // Visualizer
    "--viz-bg": "radial-gradient(circle at 50% 50%, #232B3D 0%, #0F1115 70%)",
    "--viz-shadow": "rgba(74, 199, 255, 0.14)",
    "--viz-overlay": "rgba(10, 12, 16, 0.6)",

    // Graph/Beat
    "--edge-stroke": "rgba(74, 199, 255, 0.5)",
    "--edge-selected": "#B48CFF",
    "--beat-fill": "#FFD46A",
    "--beat-highlight": "#FFD46A",
  },
  light: {
    // Core
    "--bg": "#F7F2E8",
    "--text": "#2D2113",
    "--text-rgb": "45, 33, 19",
    "--muted": "#5E4B34",
    "--accent": "#0F8A70",
    "--title-accent": "#B06A1F",
    "--title-glow": "rgba(176, 106, 31, 0.28)",

    // Surfaces
    "--surface-panel": "#FFFDF8",
    "--surface-hero": "#F5ECDD",
    "--surface-control": "#F2E5D2",
    "--surface-control-hover": "#EAD9BF",

    // Borders
    "--border-panel": "rgba(75, 53, 26, 0.20)",
    "--border-hero": "rgba(100, 69, 34, 0.24)",
    "--border-control": "rgba(95, 71, 43, 0.32)",

    // Visualizer
    "--viz-bg":
      "radial-gradient(1000px circle at 28% 20%, rgba(241, 215, 170, 0.55), transparent 60%), " +
      "radial-gradient(1000px circle at 80% 80%, rgba(211, 182, 136, 0.45), transparent 62%), " +
      "linear-gradient(180deg, #F8EFE0 0%, #EFE2CC 100%)",
    "--viz-shadow": "rgba(95, 71, 43, 0.20)",
    "--viz-overlay": "rgba(255, 250, 240, 0.72)",

    // Graph/Beat
    "--edge-stroke": "rgba(45, 33, 19, 0.42)",
    "--edge-selected": "#0F8A70",
    "--beat-fill": "#D08A3A",
    "--beat-highlight": "#D08A3A",
  },
};
