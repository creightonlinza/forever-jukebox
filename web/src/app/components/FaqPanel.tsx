import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearCachedAudio, getCachedAudioBytes } from "../cache";
import { pathForFaqSubtab, type FaqSubtabId } from "../tabs";
import { showToast } from "../ui";

function formatMegabytes(bytes: number) {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

function CachedAudioClearButton() {
  const [label, setLabel] = useState("Clear 0MB");
  const [disabled, setDisabled] = useState(false);
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      const bytes = await getCachedAudioBytes();
      setLabel(`Clear ${formatMegabytes(bytes)}MB`);
      setDisabled(bytes <= 0);
    } catch (err) {
      console.warn(`Cache size failed: ${String(err)}`);
      setLabel("Clear 0MB");
      setDisabled(true);
    }
  }, []);

  // This component only mounts inside the FAQ tab, so refresh once on mount
  // and again when moving between FAQ subtabs.
  useEffect(() => {
    refresh().catch((err) => {
      console.warn(`Cache size refresh failed: ${String(err)}`);
    });
  }, [location, refresh]);

  const handleClear = async () => {
    setDisabled(true);
    setLabel("Clearing...");
    try {
      await clearCachedAudio();
      showToast("Cached audio cleared.");
    } catch (err) {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast("Unable to clear cached audio.");
    } finally {
      refresh().catch((err) => {
        console.warn(`Cache size refresh failed: ${String(err)}`);
      });
    }
  };

  const handleClearClick = () => {
    handleClear().catch((err) => {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast("Unable to clear cached audio.");
    });
  };

  return (
    <button
      id="cached-audio-clear"
      type="button"
      disabled={disabled}
      onClick={handleClearClick}
    >
      {label}
    </button>
  );
}

export function FaqPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const subtab: FaqSubtabId = location.pathname.startsWith("/whats-new")
    ? "whats-new"
    : "faq";

  const handleSubtabClick = (subtabId: FaqSubtabId) => {
    navigate(pathForFaqSubtab(subtabId));
  };

  return (
    <section className="panel tab-panel" data-tab-panel="faq">
      <div className="subtabs" id="faq-subtabs">
        <button
          className={subtab === "faq" ? "subtab-btn active" : "subtab-btn"}
          data-faq-subtab="faq"
          onClick={() => handleSubtabClick("faq")}
        >
          FAQ
        </button>
        <span className="subtab-spacer" aria-hidden="true"></span>
        <button
          className={subtab === "whats-new" ? "subtab-btn active" : "subtab-btn"}
          data-faq-subtab="whats-new"
          onClick={() => handleSubtabClick("whats-new")}
        >
          <span
            className="material-symbols-outlined subtab-icon subtab-icon-filled"
            aria-hidden="true"
          >
            check_circle
          </span>
          <span>What's New</span>
        </button>
      </div>
      <div className="panel-title" id="faq-panel-title">
        {subtab === "faq" ? "FAQ" : "What's New"}
      </div>
      <div
        className={subtab === "faq" ? "faq" : "faq hidden"}
        id="faq-panel"
      >
        <h4>What the what?</h4>
        <p>
          The Forever Jukebox is an open-source modernization of Paul Lamere's{" "}
          <a
            href="https://musicmachinery.com/2012/11/12/the-infinite-jukebox/"
            target="_blank"
            rel="noreferrer"
          >
            Infinite Jukebox
          </a>{" "}
          and{" "}
          <a
            href="https://musicmachinery.com/2014/03/18/how-the-autocanonizer-works/"
            target="_blank"
            rel="noreferrer"
          >
            Autocanonizer
          </a>{" "}
          — rebuilt from the ground up by{" "}
          <a href="https://creighton.dev" target="_blank" rel="noreferrer">
            Creighton Linza
          </a>. It generates a forever-evolving version of any song.
        </p>

        <h4>How does it work?</h4>
        <p>
          The app uses the Spotify Web API for track search/metadata and
          YouTube as the audio source. The audio is processed by the Forever
          Jukebox Analysis Engine, which approximates Spotify’s legacy Echo
          Nest analysis (now deprecated) by extracting beats, segments, and
          related features. Those features drive beat-synchronous playback in
          the frontend. On each beat, the player may jump to a different,
          sonically similar point in the track based on timbre, loudness,
          segment duration, and beat position. The visualizations map these
          potential jump paths for every beat.
        </p>
        <p>
          The full source code is available in the{" "}
          <a
            href="https://github.com/creightonlinza/forever-jukebox/"
            target="_blank"
            rel="noreferrer"
          >
            forever-jukebox
          </a>{" "}
          repository.
        </p>

        <h4>How can I tune the Jukebox?</h4>
        <ul>
          <li>Click the Tune button to open the tuning panel.</li>
          <li>
            Lower the threshold for higher audio continuity; raise it for more
            branches.
          </li>
          <li>
            Adjust branch probability min/max and ramp speed to shape how
            often jumps happen.
          </li>
          <li>
            Set a minimum jump distance to filter branches by beat distance
            across the track, and use the checkboxes for other branch types.
          </li>
          <li>
            Click a branch in the visualization, then press Delete to remove
            it.
          </li>
        </ul>

        <h4>What are the extra audio modes?</h4>
        <p>
          Extras can play the Jukebox normally, speed it up with Nightcore,
          slow and deepen it with Daycore, muffle and slow it with Vaporwave,
          add spatial panning with 8D Audio, bitcrush it with 8-Bit, add a
          filtered LoFi sound, submerge it with Underwater, or wash it through
          Cathedral reverb. More Cowbell and Swing are beat-aware remix toys
          inspired by{" "}
          <a
            href="https://github.com/echonest/remix"
            target="_blank"
            rel="noreferrer"
          >
            Echo Nest Remix
          </a>.
        </p>

        <h4>How do Favorites work?</h4>
        <ul>
          <li>
            Favorites are saved/unsaved by clicking the star icon on a track.
            They are stored locally in your browser and can optionally be
            synced across devices using a sync code obtained from the
            Favorites sync menu.
          </li>
          <li>
            When you favorite a track, its tuning and deleted branches are
            saved too, so future loads restore your chosen parameters.
          </li>
          <li>
            Use Reset in the Tune panel to restore default tuning and deleted
            branches (must be re-favorited to save changes).
          </li>
        </ul>

        <h4>How do Playlists work?</h4>
        <ul>
          <li>
            Load a track first, then use the add-circle button on Top,
            Trending, Recently Played, or Favorites rows to build a playlist.
          </li>
          <li>
            Use the playlist button on the Listen screen to open the playlist,
            choose another track, remove non-current tracks, or clear the list.
          </li>
          <li>
            Previous and next playlist buttons appear beside the play button
            when an active playlist has another track available.
          </li>
          <li>
            Playlists are saved only in this browser. They do not sync across
            devices or accounts.
          </li>
        </ul>

        <h4>Installable Offline App</h4>
        <p>
          For local/offline analysis and playback, open the{" "}
          <a href="/offline/" target="_blank">
            Forever Jukebox Offline app
          </a>{" "}
          and install it from your browser.
        </p>

        <h4>CACHED AUDIO</h4>
        <CachedAudioClearButton />
      </div>
      <div
        className={subtab === "whats-new" ? "faq faq-updates" : "faq faq-updates hidden"}
        id="faq-whats-new-panel"
      >
        <h4>June 2026</h4>
        <ul>
          <li>
            A few more Audio Mode options introduced on the Extras menu:{" "}
            <strong>8-bit, Underwater, Cathedral</strong>
          </li>
          <li>
            <strong>Favorites search &amp; sorting</strong> added, maximum
            saved favorites bumped to 150 tracks.
          </li>
          <li>
            Added local <strong>Playlists</strong>: queue up to 10 tracks,
            then skip between them from the Listen screen. More info in the
            FAQ.
          </li>
          <li>
            <strong>Rewrote the app in React</strong> — please report any
            issues.
          </li>
        </ul>

        <h4>May 2026</h4>
        <ul>
          <li>
            Added <strong>More Cowbell</strong> and <strong>Swing</strong>{" "}
            remix toys to Extras, giving beat-aware ways to reshape tracks
            while the Jukebox plays.
          </li>
          <li>
            Offline App (PWA) can now <strong>export audio</strong> with any
            actively selected Audio Mode.
          </li>
          <li>
            Implemented <strong>custom anchor branches</strong>: select a
            backward branch and press A to make it the forced anchor jump.
          </li>
          <li>
            Added a <strong>sleep timer</strong> to the Tuning/Extras dialog.
          </li>
        </ul>

        <h4>April 2026</h4>
        <ul>
          <li>Added a <strong>What's New</strong> section (you are here)!</li>
          <li>
            Added <strong>SoundCloud</strong> and <strong>Bandcamp</strong>{" "}
            support via Upload by URL.
          </li>
          <li>
            <strong>Extras</strong> menu added (press E on the Listen screen
            or access in the tuning menu) for experimental features.
          </li>
          <li>
            Added highly requested <strong>nightcore</strong>,{" "}
            <strong>daycore</strong>, &amp; other <strong>Audio Mode</strong>{" "}
            options to the Extras menu.
          </li>
        </ul>

        <h4>March 2026</h4>
        <ul>
          <li>
            <strong>Branch stats</strong> toggle was added to provide helpful
            data points like direction, timing, &amp; match percentage.
          </li>
          <li>
            <strong>Bring It Home mode</strong> (press H on your keyboard to
            toggle) was added for a more linear playback option that finishes
            the track cleanly.
          </li>
          <li>
            The backend moved to <strong>madmom-beats-lite</strong>, improving
            progress reporting and memory footprint, while maintaining quality
            analysis.
          </li>
        </ul>

        <h4>February 2026</h4>
        <ul>
          <li>
            The <strong>Offline App</strong> (PWA) launched, making it
            possible to analyze and play tracks directly - without an internet
            connection.
          </li>
          <li>
            <strong>Recently Played</strong> and <strong>Trending</strong>{" "}
            discovery lists were added.
          </li>
          <li>
            A new <strong>Arc visualization</strong> replaced the Spiral view.
          </li>
        </ul>

        <h4>January 2026</h4>
        <ul>
          <li>
            Happy new year! Site <strong>launched</strong> on the first of the
            year.
          </li>
          <li>
            <strong>Favorites</strong> feature added, along with{" "}
            <strong>Favorites Sync</strong> so saved tracks can travel between
            sessions &amp; devices.
          </li>
          <li>
            Support was added for <strong>user uploads</strong> and manually
            added <strong>YouTube links</strong>.
          </li>
          <li>
            <strong>Autocanonizer mode</strong> was added as a new playback
            option.
          </li>
        </ul>
      </div>
    </section>
  );
}
