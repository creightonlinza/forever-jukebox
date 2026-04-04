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
    "--bg": "#F6F1FF",
    "--text": "#261A38",
    "--text-rgb": "38, 26, 56",
    "--muted": "#635280",
    "--accent": "#2E8BFF",
    "--title-accent": "#B144FF",
    "--title-glow": "rgba(177, 68, 255, 0.34)",

    // Surfaces
    "--surface-panel": "#FCFAFF",
    "--surface-hero": "#EFE5FF",
    "--surface-control": "#E8DBFF",
    "--surface-control-hover": "#DDCCFF",

    // Borders
    "--border-panel": "rgba(73, 43, 113, 0.20)",
    "--border-hero": "rgba(91, 48, 150, 0.26)",
    "--border-control": "rgba(96, 56, 152, 0.34)",

    // Visualizer
    "--viz-bg": "radial-gradient(circle at 50% 50%, #D9C3FF 0%, #F6F1FF 70%)",
    "--viz-shadow": "rgba(101, 52, 168, 0.24)",
    "--viz-overlay": "rgba(250, 246, 255, 0.74)",

    // Graph/Beat
    "--edge-stroke": "rgba(77, 48, 120, 0.44)",
    "--edge-selected": "#7F39FB",
    "--beat-fill": "#B144FF",
    "--beat-highlight": "#B144FF",
  },
};
