import { useRef, useState } from "react";
import { formatTrackDuration } from "../format";
import { selectSpotify, selectYoutube, submitSearch } from "../search";
import { useAppStore } from "../store";
import { uploadFile, uploadUrl } from "../upload";

function setOf(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function SearchResults() {
  const results = useAppStore((s) => s.searchResults);
  if (results.kind === "message") {
    return (
      <div className="search-results" id="search-results">
        {results.text}
      </div>
    );
  }
  if (results.kind === "spotify") {
    return (
      <div className="search-results" id="search-results">
        <ol className="search-list" role="listbox" aria-label="Search results">
          {results.items.map((item, index) => {
            const name = typeof item.name === "string" ? item.name : "Untitled";
            const artist = typeof item.artist === "string" ? item.artist : "";
            const title = artist ? `${name} — ${artist}` : name;
            const duration =
              typeof item.duration === "number" ? item.duration : 0;
            return (
              <li
                key={index}
                className="search-item"
                role="option"
                tabIndex={0}
                data-track-name={name}
                data-track-artist={artist}
                onClick={() =>
                  selectSpotify({ name, artist, duration })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectSpotify({ name, artist, duration });
                  }
                }}
              >
                <strong>{title}</strong>
                <span>{formatTrackDuration(item.duration)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }
  return (
    <div className="search-results" id="search-results">
      <ol className="search-list" role="listbox" aria-label="Search results">
        {results.items.map(({ item, name, artist }, index) => {
          const title = typeof item.title === "string" ? item.title : "Untitled";
          const ytDuration =
            typeof item.duration === "number" ? item.duration : 0;
          const youtubeId = item.id ? String(item.id) : "";
          return (
            <li
              key={index}
              className="search-item"
              role="option"
              tabIndex={0}
              data-youtube-id={youtubeId}
              data-track-name={name}
              data-track-artist={artist}
              onClick={() =>
                selectYoutube({
                  youtubeId,
                  name,
                  artist,
                  duration: ytDuration,
                })
              }
              onKeyDown={(event) => {
                // Enter on the nested open-on-YouTube link must keep its
                // native behavior, not select the result.
                if (event.target !== event.currentTarget) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectYoutube({
                    youtubeId,
                    name,
                    artist,
                    duration: ytDuration,
                  });
                }
              }}
            >
              <strong>{title}</strong>
              <span className="search-meta">
                <span>{formatTrackDuration(item.duration)}</span>
                {item.id ? (
                  <a
                    className="search-open"
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(String(item.id))}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on YouTube"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <span
                      className="material-symbols-outlined search-open-icon"
                      aria-hidden="true"
                    >
                      open_in_new
                    </span>
                  </a>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function SearchPanel() {
  const activeTab = useAppStore((s) => s.activeTabId);
  const searchTab = useAppStore((s) => s.searchTab);
  const appConfig = useAppStore((s) => s.appConfig);
  const query = useAppStore((s) => s.searchQuery);
  const hint = useAppStore((s) => s.searchHint);
  const [searchBusy, setSearchBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allowUpload = Boolean(appConfig?.allow_user_upload);
  const allowUrl = Boolean(appConfig?.allow_user_url);
  const showUpload = allowUpload || allowUrl;
  const extList = (appConfig?.allowed_upload_exts || []).join(", ");
  const maxSize = appConfig?.max_upload_size
    ? `${Math.round(appConfig.max_upload_size / (1024 * 1024))} MB`
    : "unknown";

  const triggerSearch = async () => {
    if (searchBusy) {
      return;
    }
    setSearchBusy(true);
    try {
      await submitSearch();
    } finally {
      setSearchBusy(false);
    }
  };

  const handleUploadFile = async () => {
    if (fileBusy) {
      return;
    }
    setFileBusy(true);
    try {
      await uploadFile(
        fileInputRef.current?.files?.[0] ?? null,
        () => {
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        },
      );
    } finally {
      setFileBusy(false);
    }
  };

  const handleUploadUrl = async () => {
    if (urlBusy) {
      return;
    }
    setUrlBusy(true);
    try {
      await uploadUrl(urlValue, () => setUrlValue(""));
    } finally {
      setUrlBusy(false);
    }
  };

  return (
    <section
      className={setOf("panel", "tab-panel", activeTab !== "search" && "hidden")}
      data-tab-panel="search"
    >
      <div
        className={setOf("subtabs", !showUpload && "hidden")}
        id="search-subtabs"
      >
        <button
          className={setOf("subtab-btn", searchTab === "search" && "active")}
          data-search-subtab="search"
          onClick={() => useAppStore.setState({ searchTab: "search" })}
        >
          Search
        </button>
        <span className="subtab-spacer" aria-hidden="true"></span>
        <button
          className={setOf("subtab-btn", searchTab === "upload" && "active")}
          data-search-subtab="upload"
          onClick={() => useAppStore.setState({ searchTab: "upload" })}
        >
          Upload
        </button>
      </div>
      <div className="panel-title" id="search-panel-title">
        {searchTab === "search" ? "Search" : "Upload"}
      </div>
      <div
        className={setOf("search-panel", searchTab !== "search" && "hidden")}
        id="search-panel"
      >
        <div className="search-hint" id="search-hint">
          {hint}
        </div>
        <div className="search-bar search-bar-inline">
          <input
            id="search-input"
            className="search-input"
            type="search"
            placeholder="Search by artist or track"
            maxLength={100}
            autoComplete="off"
            value={query}
            onChange={(event) =>
              useAppStore.setState({ searchQuery: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void triggerSearch();
              }
            }}
          />
          <button
            id="search-button"
            className={setOf("search-inline-action", searchBusy && "is-loading")}
            type="button"
            aria-label="Search"
            aria-busy={searchBusy}
            disabled={searchBusy}
            onClick={() => void triggerSearch()}
          >
            <span
              className="material-symbols-outlined search-inline-icon"
              aria-hidden="true"
            >
              search
            </span>
          </button>
        </div>
        <SearchResults />
      </div>
      <div
        className={setOf("upload-panel", searchTab !== "upload" && "hidden")}
        id="upload-panel"
      >
        <div
          className={setOf("upload-section", !allowUpload && "hidden")}
          id="upload-file-section"
        >
          <div className="upload-title">Upload by File</div>
          <div className="upload-hint" id="upload-file-hint">
            {allowUpload ? `Max file size: ${maxSize}. Allowed: ${extList}` : ""}
          </div>
          <div className="search-bar">
            <input
              id="upload-file-input"
              ref={fileInputRef}
              className="search-input"
              type="file"
              accept={
                allowUpload
                  ? (appConfig?.allowed_upload_exts || []).join(",")
                  : undefined
              }
            />
            <button
              id="upload-file-button"
              className={setOf(fileBusy && "is-loading") || undefined}
              aria-busy={fileBusy}
              disabled={fileBusy}
              onClick={() => void handleUploadFile()}
            >
              Load
            </button>
          </div>
        </div>
        <div
          className={setOf("upload-section", !allowUrl && "hidden")}
          id="upload-youtube-section"
        >
          <div className="upload-title">Upload by URL</div>
          <div className="upload-hint">Supported: YouTube, SoundCloud, Bandcamp</div>
          <form
            className="search-bar"
            id="upload-youtube-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleUploadUrl();
            }}
          >
            <input
              id="upload-youtube-input"
              className="search-input"
              type="url"
              placeholder="https://www.youtube.com/watch?v=... or https://soundcloud.com/... or https://artist.bandcamp.com/track/..."
              autoComplete="off"
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
            />
            <button
              id="upload-youtube-button"
              className={setOf(urlBusy && "is-loading") || undefined}
              aria-busy={urlBusy}
              disabled={urlBusy}
              type="submit"
            >
              Load
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
