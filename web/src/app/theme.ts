import type { AppContext } from "./context";
import { themeConfig, type ThemeName } from "./themeConfig";

const themeStorageKey = "fj-theme";

export function applyThemeVariables(theme: ThemeName) {
  const themeVars = themeConfig[theme];
  const rootStyle = document.documentElement.style;
  Object.entries(themeVars).forEach(([key, value]) => {
    rootStyle.setProperty(key, value);
  });
}

export function resolveStoredTheme(): ThemeName {
  const storedTheme = localStorage.getItem(themeStorageKey);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return "dark";
}

export function applyTheme(context: AppContext, theme: ThemeName) {
  const { jukebox } = context;
  applyThemeVariables(theme);
  document.body.classList.toggle("theme-light", theme === "light");
  localStorage.setItem(themeStorageKey, theme);
  jukebox?.refresh();
}

export function applyStoredTheme(context: AppContext) {
  applyTheme(context, resolveStoredTheme());
}
