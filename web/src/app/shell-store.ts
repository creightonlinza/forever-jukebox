import { create } from "zustand";
import type { TabId } from "./context";
import type { ThemeName } from "./themeConfig";

export type FooterCredit = {
  hostedByName: string | null;
  hostedByUrl: string | null;
};

type ShellState = {
  activeTab: TabId;
  theme: ThemeName;
  isPlayTabPulsing: boolean;
  footerCredit: FooterCredit | null;
  setActiveTab: (tab: TabId) => void;
  setTheme: (theme: ThemeName) => void;
  setPlayTabPulsing: (pulsing: boolean) => void;
  setFooterCredit: (credit: FooterCredit | null) => void;
};

// Shell-level UI state shared between React and the legacy modules. The
// legacy side reads/writes via useShellStore.getState(); React subscribes
// with selectors. Grows into the full app store in Phase 3.
export const useShellStore = create<ShellState>()((set) => ({
  activeTab: "top",
  theme: "dark",
  isPlayTabPulsing: false,
  footerCredit: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setTheme: (theme) => set({ theme }),
  setPlayTabPulsing: (isPlayTabPulsing) => set({ isPlayTabPulsing }),
  setFooterCredit: (footerCredit) => set({ footerCredit }),
}));
