import {
  BrowserRouter,
  Link,
  Route,
  Routes,
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
        <h1 className="hero-title-neon install-gate__title">THE FOREVER JUKEBOX</h1>
        <p className="install-gate__subtitle">
          Install to use the offline desktop app.
        </p>
        <p className="install-gate__hint">
          {canInstall
            ? "After installing, open it from your desktop or app launcher."
            : "Use your browser menu (Install app/Add to Home Screen), then open the installed app."}
        </p>
        {canInstall ? (
          <button className="tab-btn install-gate__action" type="button" onClick={() => void promptInstall()}>
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
  const hideTabsWhileLoading =
    location.pathname === "/listen" && isListenLoading;

  if (!isGateUnlocked) {
    return <InstallGate canInstall={canInstall} promptInstall={promptInstall} />;
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-actions" />
        <div className="hero-main">
          <div className="hero-title">
            <h1 className="hero-title-neon">THE FOREVER JUKEBOX</h1>
            <span className="hero-subtitle">Offline Desktop App - BETA</span>
          </div>
          {!hideTabsWhileLoading ? (
            <nav className="tabs" aria-label="Primary">
              <Link
                className={`tab-btn ${location.pathname === "/" ? "active" : ""}`}
                to="/"
              >
                Home
              </Link>
              <Link
                className={`tab-btn ${location.pathname === "/listen" ? "active" : ""}`}
                to="/listen"
              >
                Listen
              </Link>
              <Link
                className={`tab-btn ${location.pathname === "/faq" ? "active" : ""}`}
                to="/faq"
              >
                FAQ
              </Link>
            </nav>
          ) : null}
        </div>
      </header>
      <main className="app__main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/listen" element={<Listen />} />
          <Route path="/faq" element={<Faq />} />
        </Routes>
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
