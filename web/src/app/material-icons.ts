export const MATERIAL_SYMBOL_ICON_NAMES = [
  "add_circle",
  "arrow_downward",
  "arrow_drop_down",
  "arrow_upward",
  "check_circle",
  "close",
  "cloud",
  "cloud_done",
  "cloud_off",
  "delete",
  "download",
  "error",
  "fullscreen",
  "fullscreen_exit",
  "hourglass_top",
  "info",
  "open_in_new",
  "pause",
  "play_arrow",
  "playlist_add_check",
  "queue_music",
  "refresh",
  "science",
  "search",
  "share",
  "skip_next",
  "skip_previous",
  "star",
  "swap_horiz",
  "timer",
  "tune",
  "volume_up",
] as const;

export type MaterialSymbolIconName = (typeof MATERIAL_SYMBOL_ICON_NAMES)[number];

export const MATERIAL_SYMBOL_ICON_NAMES_PARAM =
  MATERIAL_SYMBOL_ICON_NAMES.join(",");
