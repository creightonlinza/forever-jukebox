import {
  BrowserRouter,
  Link,
  useLocation,
} from "react-router-dom";
import { AppStateProvider, useAppState } from "./state/AppState";
import { Home } from "./routes/Home";
import { Listen } from "./routes/Listen";
import { Faq } from "./routes/Faq";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";

type InstallGateProps = {
  canInstall: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | null>;
};

function InstallGate({ canInstall, promptInstall }: InstallGateProps) {
  const { t } = useTranslation();
  return (
    <div className="install-gate">
      <section className="install-gate__panel">
        <div className="hero-title-frame install-gate__title-frame">
          <h1 className="hero-title-neon install-gate__title">
            FOREVER <span className="hero-title-jukebox">JUKEBOX</span>
          </h1>
        </div>
        <p className="install-gate__subtitle">
          {t("install.subtitle")}
        </p>
        <p className="install-gate__hint">
          {canInstall
            ? t("install.afterInstall")
            : t("install.browserMenu")}
        </p>
        {canInstall ? (
          <button
            className="tab-btn install-gate__action"
            type="button"
            onClick={() => void promptInstall()}
          >
            {t("install.action")}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isListenLoading, setIsSettingsOpen } = useAppState();
  const { canInstall, isGateUnlocked, promptInstall } = useInstallPrompt();
  const isListenRoute = location.pathname === "/listen";
  const isFaqRoute = location.pathname === "/faq";
  const isHomeRoute = !isListenRoute && !isFaqRoute;
  const hideTabsWhileLoading =
    isListenRoute && isListenLoading;

  if (!isGateUnlocked) {
    return (
      <InstallGate canInstall={canInstall} promptInstall={promptInstall} />
    );
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-main">
          <div className="hero-title">
            <div className="hero-title-frame">
              <h1 className="hero-title-neon">
                FOREVER <span className="hero-title-jukebox">JUKEBOX</span>
              </h1>
            </div>
            <span className="hero-subtitle">{t("navigation.offlineApp")}</span>
          </div>
          {!hideTabsWhileLoading ? (
            <nav className="tabs" aria-label={t("navigation.primary")}>
              <Link
                className={`tab-btn ${isHomeRoute ? "active" : ""}`}
                to="/"
              >
                {t("common.home")}
              </Link>
              <Link
                className={`tab-btn ${isListenRoute ? "active" : ""}`}
                to="/listen"
              >
                {t("common.listen")}
              </Link>
              <Link
                className={`tab-btn ${isFaqRoute ? "active" : ""}`}
                to="/faq"
              >
                {t("common.faq")}
              </Link>
              <button
                id="settings-open"
                className="tab-btn settings-button"
                type="button"
                aria-label={t("settings.open")}
                title={t("settings.open")}
                onClick={() => setIsSettingsOpen(true)}
              >
                <SymbolIcon className="settings-button-icon" name="settings" />
              </button>
            </nav>
          ) : null}
        </div>
      </header>
      <main className="app__main">
        <section
          style={{ display: isHomeRoute ? "block" : "none" }}
          aria-hidden={!isHomeRoute}
        >
          <Home />
        </section>
        <section
          style={{ display: isListenRoute ? "block" : "none" }}
          aria-hidden={!isListenRoute}
        >
          <Listen isActive={isListenRoute} />
        </section>
        <section
          style={{ display: isFaqRoute ? "block" : "none" }}
          aria-hidden={!isFaqRoute}
        >
          <Faq />
        </section>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppStateProvider>
        <AppLayout />
      </AppStateProvider>
    </BrowserRouter>
  );
}
