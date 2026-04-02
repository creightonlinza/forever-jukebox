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

type InstallGateProps = {
  canInstall: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | null>;
};

function InstallGate({ canInstall, promptInstall }: InstallGateProps) {
  return (
    <div className="install-gate">
      <section className="install-gate__panel">
        <div className="hero-title-frame install-gate__title-frame">
          <h1 className="hero-title-neon install-gate__title">
            THE FOREVER <span className="hero-title-jukebox">JUKEBOX</span>
          </h1>
        </div>
        <p className="install-gate__subtitle">
          Install to use the offline app.
        </p>
        <p className="install-gate__hint">
          {canInstall
            ? "After installing, open it from your desktop or app launcher."
            : "Use your browser menu (Install app/Add to Home Screen), then open the installed app."}
        </p>
        {canInstall ? (
          <button
            className="tab-btn install-gate__action"
            type="button"
            onClick={() => void promptInstall()}
          >
            Install
          </button>
        ) : null}
      </section>
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const { isListenLoading } = useAppState();
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
        <div className="hero-actions" />
        <div className="hero-main">
          <div className="hero-title">
            <div className="hero-title-frame">
              <h1 className="hero-title-neon">
                THE FOREVER <span className="hero-title-jukebox">JUKEBOX</span>
              </h1>
            </div>
            <span className="hero-subtitle">Offline App</span>
          </div>
          {!hideTabsWhileLoading ? (
            <nav className="tabs" aria-label="Primary">
              <Link
                className={`tab-btn ${isHomeRoute ? "active" : ""}`}
                to="/"
              >
                Home
              </Link>
              <Link
                className={`tab-btn ${isListenRoute ? "active" : ""}`}
                to="/listen"
              >
                Listen
              </Link>
              <Link
                className={`tab-btn ${isFaqRoute ? "active" : ""}`}
                to="/faq"
              >
                FAQ
              </Link>
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
