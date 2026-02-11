import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { AppStateProvider } from "./state/AppState";
import { Home } from "./routes/Home";
import { Listen } from "./routes/Listen";
import { Faq } from "./routes/Faq";
import { useInstallPrompt } from "./hooks/useInstallPrompt";

function AppLayout() {
  const location = useLocation();
  const { canInstall, promptInstall } = useInstallPrompt();

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-actions">
          {canInstall ? (
            <button className="tab-btn" type="button" onClick={() => void promptInstall()}>
              Install
            </button>
          ) : null}
        </div>
        <div className="hero-main">
          <div className="hero-title">
            <h1 className="hero-title-neon">THE FOREVER JUKEBOX</h1>
            <span className="hero-subtitle">Offline Desktop PWA</span>
          </div>
          <nav className="tabs" aria-label="Primary">
            <Link className={`tab-btn ${location.pathname === "/" ? "active" : ""}`} to="/">
              Home
            </Link>
            <Link className={`tab-btn ${location.pathname === "/listen" ? "active" : ""}`} to="/listen">
              Listen
            </Link>
            <Link className={`tab-btn ${location.pathname === "/faq" ? "active" : ""}`} to="/faq">
              FAQ
            </Link>
          </nav>
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
    <BrowserRouter>
      <AppStateProvider>
        <AppLayout />
      </AppStateProvider>
    </BrowserRouter>
  );
}
