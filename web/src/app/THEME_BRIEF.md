# Theme Token Brief

Use this guide to build new color schemes without knowing the UI. Provide
values for each token and respect the relationships/constraints described.

Core

- `--bg`: app background; lowest layer; calm and low-contrast.
- `--text`: primary text on `--bg`; high contrast and readable.
- `--text-rgb`: same as `--text` but as "R, G, B" for translucent effects.
- `--muted`: secondary text; readable on `--bg` and `--surface-panel`, softer than `--text`.
- `--accent`: primary interactive highlight (links, active states).
- `--title-accent`: decorative headline color (hero/logo).
- `--title-glow`: same hue as `--title-accent` with transparency for glow effects.

Surfaces

- `--surface-panel`: standard card/panel background (content blocks).
- `--surface-hero`: prominent header/hero background; should stand out from `--surface-panel`.
- `--surface-control`: buttons/toggles background; should read as interactive.
- `--surface-control-hover`: 5-10% stronger than `--surface-control`.

Borders

- `--border-panel`: outlines for panels and inputs.
- `--border-hero`: outline for hero/header; can be softer or stronger than `--border-panel`.
- `--border-control`: outline for buttons/tabs.

Visualizer

- `--viz-bg`: background gradient for the viz area; complements `--bg`.
- `--viz-shadow`: subtle inner glow/shadow for viz depth.
- `--viz-overlay`: translucent overlay for labels on top of viz.

Graph/Beat Colors

- `--edge-stroke`: faint graph lines; low-contrast but visible.
- `--edge-selected`: selected edge color; higher contrast.
- `--beat-fill`: base beat marker fill (semi-transparent). Not used by the Classic layout, whose
  tiles use each beat's timbre color.
- `--beat-highlight`: highlight color; brighter than `--beat-fill`. Colors the beat cursor, the
  Classic layout's leading tile, hover markers and hovered branches.

Constraints

- `--text` on `--bg` and `--surface-panel` should pass WCAG AA (~4.5:1).
- `--muted` should be ~60-75% contrast of `--text`.
- `--surface-hero` should be visibly distinct from `--surface-panel` (luminance or hue).
- `--surface-control` should look clickable vs `--surface-panel`.
- Keep `--accent` distinct from `--title-accent` unless you want a single hue.

Template

```js
export const theme = {
  dark: {
    // Core
    "--bg": "",
    "--text": "",
    "--text-rgb": "",
    "--muted": "",
    "--accent": "",
    "--title-accent": "",
    "--title-glow": "",

    // Surfaces
    "--surface-panel": "",
    "--surface-hero": "",
    "--surface-control": "",
    "--surface-control-hover": "",

    // Borders
    "--border-panel": "",
    "--border-hero": "",
    "--border-control": "",

    // Visualizer
    "--viz-bg": "",
    "--viz-shadow": "",
    "--viz-overlay": "",

    // Graph/Beat
    "--edge-stroke": "",
    "--edge-selected": "",
    "--beat-fill": "",
    "--beat-highlight": "",
  },

  light: {
    // Core
    "--bg": "",
    "--text": "",
    "--text-rgb": "",
    "--muted": "",
    "--accent": "",
    "--title-accent": "",
    "--title-glow": "",

    // Surfaces
    "--surface-panel": "",
    "--surface-hero": "",
    "--surface-control": "",
    "--surface-control-hover": "",

    // Borders
    "--border-panel": "",
    "--border-hero": "",
    "--border-control": "",

    // Visualizer
    "--viz-bg": "",
    "--viz-shadow": "",
    "--viz-overlay": "",

    // Graph/Beat
    "--edge-stroke": "",
    "--edge-selected": "",
    "--beat-fill": "",
    "--beat-highlight": "",
  },
};
```
