type SymbolName =
  | "play_arrow"
  | "pause"
  | "stop"
  | "tune"
  | "info"
  | "download"
  | "arrow_drop_down"
  | "volume_up"
  | "fullscreen"
  | "fullscreen_exit"
  | "close";

type SymbolIconProps = {
  name: SymbolName;
  className?: string;
};

export function SymbolIcon({ name, className }: SymbolIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "play_arrow" ? <polygon points="8 6 19 12 8 18 8 6" fill="currentColor" stroke="none" /> : null}
      {name === "pause" ? (
        <>
          <rect x="8" y="6" width="3.5" height="12" fill="currentColor" stroke="none" />
          <rect x="12.5" y="6" width="3.5" height="12" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {name === "stop" ? <rect x="7" y="7" width="10" height="10" fill="currentColor" stroke="none" /> : null}
      {name === "tune" ? (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="17" x2="20" y2="17" />
          <circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {name === "info" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
          <path d="M12 11v6" />
        </>
      ) : null}
      {name === "download" ? (
        <>
          <path d="M12 4v10" />
          <path d="M8.5 10.5L12 14l3.5-3.5" />
          <path d="M5 19h14" />
        </>
      ) : null}
      {name === "arrow_drop_down" ? (
        <polygon points="6 9 12 15 18 9" fill="currentColor" stroke="none" />
      ) : null}
      {name === "volume_up" ? (
        <>
          <polygon points="5 10 8 10 12 7 12 17 8 14 5 14" fill="currentColor" stroke="none" />
          <path d="M15 9.5c1.3 1.3 1.3 3.7 0 5" />
          <path d="M17.5 7c2.6 2.6 2.6 7.4 0 10" />
        </>
      ) : null}
      {name === "fullscreen" ? (
        <>
          <path d="M4 9V4h5" />
          <path d="M20 9V4h-5" />
          <path d="M4 15v5h5" />
          <path d="M20 15v5h-5" />
        </>
      ) : null}
      {name === "fullscreen_exit" ? (
        <>
          <path d="M9 4v5H4" />
          <path d="M15 4v5h5" />
          <path d="M9 20v-5H4" />
          <path d="M15 20v-5h5" />
        </>
      ) : null}
      {name === "close" ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : null}
    </svg>
  );
}
