import { useAppStore } from "../store";
import { TabBar } from "./TabBar";

function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <div className="theme-toggle" id="theme-toggle">
      <button
        type="button"
        className={theme === "light" ? "theme-link active" : "theme-link"}
        data-theme="light"
        onClick={() => setTheme("light")}
      >
        Light
      </button>
      <span className="theme-sep" aria-hidden="true"></span>
      <button
        type="button"
        className={theme === "dark" ? "theme-link active" : "theme-link"}
        data-theme="dark"
        onClick={() => setTheme("dark")}
      >
        Dark
      </button>
    </div>
  );
}

function HeroSocials() {
  return (
    <span className="hero-socials" aria-label="Community links">
      <a
        className="hero-social-link"
        href="https://www.reddit.com/r/infinitejukebox/"
        target="_blank"
        rel="noreferrer"
        aria-label="Reddit community"
        title="Reddit"
      >
        <svg
          className="hero-social-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12a12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547l-.8 3.747c1.824.07 3.48.632 4.674 1.488c.308-.309.73-.491 1.207-.491c.968 0 1.754.786 1.754 1.754c0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87c-3.874 0-7.004-2.176-7.004-4.87c0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754c.463 0 .898.196 1.207.49c1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197a.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248c.687 0 1.248-.561 1.248-1.249c0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25c0 .687.561 1.248 1.249 1.248c.688 0 1.249-.561 1.249-1.249c0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094a.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913c.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463a.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73c-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"
          />
        </svg>
      </a>
      <a
        className="hero-social-link"
        href="https://discord.com/invite/KWN5BfD"
        target="_blank"
        rel="noreferrer"
        aria-label="Discord server"
        title="Discord"
      >
        <svg
          className="hero-social-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="12" fill="currentColor" />
          <path
            fill="var(--surface-hero)"
            transform="translate(3 3) scale(0.75)"
            d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418Z"
          />
        </svg>
      </a>
      <a
        className="hero-social-link"
        href="https://github.com/creightonlinza/forever-jukebox/"
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub repository"
        title="GitHub"
      >
        <svg
          className="hero-social-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42c-.55-1.39-1.34-1.76-1.34-1.76c-1.09-.75.08-.74.08-.74c1.21.09 1.84 1.24 1.84 1.24c1.07 1.83 2.81 1.3 3.49.99c.11-.78.42-1.3.76-1.6c-2.67-.3-5.47-1.33-5.47-5.93c0-1.31.47-2.38 1.24-3.22c-.12-.3-.54-1.52.12-3.18c0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23c.65 1.66.24 2.88.12 3.18c.77.84 1.24 1.91 1.24 3.22c0 4.61-2.81 5.63-5.48 5.93c.43.37.81 1.1.81 2.22v3.29c0 .32.21.69.82.58A12 12 0 0 0 12 .5Z"
          />
        </svg>
      </a>
    </span>
  );
}

export function Hero() {
  const goHome = useAppStore((s) => s.goHome);
  return (
    <header className="hero">
      <div className="hero-actions">
        <HeroSocials />
        <ThemeToggle />
      </div>
      <div className="hero-main">
        <button
          id="hero-title-home"
          className="hero-title"
          type="button"
          aria-label="Go to Top Tracks"
          onClick={() => goHome()}
        >
          <h1 className="hero-title-neon">
            THE FOREVER <span className="hero-title-jukebox">JUKEBOX</span>
          </h1>
        </button>
        <TabBar />
      </div>
    </header>
  );
}
