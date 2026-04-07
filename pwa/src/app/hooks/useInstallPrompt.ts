import { useEffect, useState } from "react";
import {
  safeSessionStorageGet,
  safeSessionStorageSet,
} from "@/shared/utils/safeStorage";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const DISPLAY_MODES = ["standalone", "window-controls-overlay"] as const;
const GATE_UNLOCKED_KEY = "fj_gate_unlocked";

function detectStandalone() {
  const standaloneMode = DISPLAY_MODES.some((mode) =>
    window.matchMedia(`(display-mode: ${mode})`).matches
  );
  const iosStandalone = (window.navigator as NavigatorWithStandalone).standalone === true;
  return standaloneMode || iosStandalone;
}

export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [gateUnlocked, setGateUnlocked] = useState(false);

  useEffect(() => {
    const mediaQueries = DISPLAY_MODES.map((mode) =>
      window.matchMedia(`(display-mode: ${mode})`)
    );
    const updateStandalone = () => {
      const standalone = detectStandalone();
      setIsStandalone(standalone);
      if (standalone) {
        setGateUnlocked(true);
        safeSessionStorageSet(GATE_UNLOCKED_KEY, "1");
      }
    };

    const handler = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      updateStandalone();
    };

    setGateUnlocked(safeSessionStorageGet(GATE_UNLOCKED_KEY) === "1");
    updateStandalone();
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);
    for (const media of mediaQueries) {
      media.addEventListener("change", updateStandalone);
    }
    window.addEventListener("focus", updateStandalone);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
      for (const media of mediaQueries) {
        media.removeEventListener("change", updateStandalone);
      }
      window.removeEventListener("focus", updateStandalone);
    };
  }, []);

  const promptInstall = async () => {
    if (!promptEvent) {
      return null;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setPromptEvent(null);
    }
    return choice.outcome;
  };

  const isGateUnlocked = gateUnlocked || isStandalone;

  return {
    canInstall: !!promptEvent && !isInstalled && !isGateUnlocked,
    isGateUnlocked,
    promptInstall,
  };
}
