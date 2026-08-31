import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { trackEvent } from "../analytics";
import { clearCachedAudio, getCachedAudioBytes } from "../cache";
import { pathForFaqSubtab, type FaqSubtabId } from "../tabs";
import { showToast } from "../ui";
import { Trans, useTranslation } from "react-i18next";
import { HeroSocials } from "./Hero";

function formatMegabytes(bytes: number) {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

function CachedAudioClearButton() {
  const { t } = useTranslation();
  const [label, setLabel] = useState(() => t("faq.clearSize", { size: 0 }));
  const [disabled, setDisabled] = useState(false);
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      const bytes = await getCachedAudioBytes();
      setLabel(t("faq.clearSize", { size: formatMegabytes(bytes) }));
      setDisabled(bytes <= 0);
    } catch (err) {
      console.warn(`Cache size failed: ${String(err)}`);
      setLabel(t("faq.clearSize", { size: 0 }));
      setDisabled(true);
    }
  }, [t]);

  // This component only mounts inside the FAQ tab, so refresh once on mount
  // and again when moving between FAQ subtabs.
  useEffect(() => {
    refresh().catch((err) => {
      console.warn(`Cache size refresh failed: ${String(err)}`);
    });
  }, [location, refresh]);

  const handleClear = async () => {
    setDisabled(true);
    setLabel(t("faq.clearing"));
    try {
      await clearCachedAudio();
      showToast(t("faq.cachedCleared"));
    } catch (err) {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast(t("faq.cachedClearFailed"));
    } finally {
      refresh().catch((err) => {
        console.warn(`Cache size refresh failed: ${String(err)}`);
      });
    }
  };

  const handleClearClick = () => {
    handleClear().catch((err) => {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast(t("faq.cachedClearFailed"));
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
  const { t } = useTranslation();
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
          type="button"
          className={subtab === "faq" ? "subtab-btn active" : "subtab-btn"}
          data-faq-subtab="faq"
          onClick={() => handleSubtabClick("faq")}
        >
          {t("common.faq")}
        </button>
        <span className="subtab-spacer" aria-hidden="true"></span>
        <button
          type="button"
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
          <span>{t("faq.whatsNew")}</span>
        </button>
      </div>
      <div className="panel-title" id="faq-panel-title">
        {subtab === "faq" ? t("common.faq") : t("faq.whatsNew")}
      </div>
      <div
        className={subtab === "faq" ? "faq" : "faq hidden"}
        id="faq-panel"
      >
        <HeroSocials className="faq-socials" />
        <h4>{t("faq.whatTitle")}</h4>
        <p>
          <Trans
            i18nKey="faq.whatBody"
            components={{
              infinite: <a href="https://musicmachinery.com/2012/11/12/the-infinite-jukebox/" target="_blank" rel="noreferrer">Infinite Jukebox</a>,
              canon: <a href="https://musicmachinery.com/2014/03/18/how-the-autocanonizer-works/" target="_blank" rel="noreferrer">Autocanonizer</a>,
              author: <a href="https://creighton.dev" target="_blank" rel="noreferrer">Creighton Linza</a>,
            }}
          />
        </p>

        <h4>{t("faq.howTitle")}</h4>
        <p>{t("faq.howBody")}</p>
        <p>
          <Trans
            i18nKey="faq.sourceBody"
            components={{
              repo: <a href="https://github.com/creightonlinza/forever-jukebox/" target="_blank" rel="noreferrer">forever-jukebox</a>,
            }}
          />
        </p>

        <h4>{t("faq.tuneTitle")}</h4>
        <ul>
          <li>{t("faq.tuneOpen")}</li>
          <li>{t("faq.tuneThreshold")}</li>
          <li>{t("faq.tuneProbability")}</li>
          <li>{t("faq.tuneTypes")}</li>
          <li>{t("faq.tuneDelete")}</li>
        </ul>

        <h4>{t("faq.modesTitle")}</h4>
        <p>
          <Trans
            i18nKey="faq.modesBody"
            components={{
              remix: <a href="https://github.com/echonest/remix" target="_blank" rel="noreferrer">Echo Nest Remix</a>,
            }}
          />
        </p>

        <h4>{t("faq.favoritesTitle")}</h4>
        <ul>
          <li>{t("faq.favoritesSave")}</li>
          <li>{t("faq.favoritesTuning")}</li>
          <li>{t("faq.favoritesReset")}</li>
        </ul>

        <h4>{t("faq.playlistsTitle")}</h4>
        <ul>
          <li>{t("faq.playlistsBuild")}</li>
          <li>{t("faq.playlistsUse")}</li>
          <li>{t("faq.playlistsNavigate")}</li>
          <li>{t("faq.playlistsLocal")}</li>
        </ul>

        <h4>{t("faq.offlineTitle")}</h4>
        <p>
          <Trans
            i18nKey="faq.offlineBody"
            components={{ offline: <a href="/offline/" target="_blank" onClick={() => trackEvent("open_pwa", { source: "faq" })}>Forever Jukebox Offline app</a> }}
          />
        </p>

        <h4>{t("faq.cachedAudio")}</h4>
        <CachedAudioClearButton />
      </div>
      <div
        className={subtab === "whats-new" ? "faq faq-updates" : "faq faq-updates hidden"}
        id="faq-whats-new-panel"
      >
        {/* What's New is intentionally hardcoded English, not i18n tokens: it's a
            high-churn changelog that is never translated (untranslated tokens would
            just force a locale-completeness exemption). Adding a new entry is a plain
            JSX edit here. Keep the FAQ above fully tokenized. */}
        <h4>August 2026</h4>
        <ul>
          <li>
            There is now a native <strong>Android app</strong> —{" "}
            <a href="https://play.google.com/store/apps/details?id=com.foreverjukebox.app.play" target="_blank" rel="noreferrer">get it on Google Play</a>. On every other platform, the offline app still installs straight from your browser.
          </li>
          <li>
            New <strong>Report a bug</strong> option in Settings — send feedback or bug reports without leaving the app.
          </li>
          <li>
            Favorited tracks now show a <strong>modified indicator</strong> near the star icon when current tuning options have changed from the saved tuning.
          </li>
          <li>
            Fixes: choosing audio files works again on <strong>iOS</strong>, and tuning no longer resets when switching Audio Modes.
          </li>
          <li>
            Improved reliability when <strong>fetching audio</strong> — fewer failed imports.
          </li>
        </ul>

        <h4>July 2026</h4>
        <p>July community feature request extravaganza — all suggested by you:</p>
        <ul>
          <li>
            Added <strong>left/right panning</strong> to the Autocanonizer, providing more control over the stereo field.
          </li>
          <li>
            YouTube sources now show <strong>video thumbnails</strong> (click the popup icon).
          </li>
          <li>
            Added a <strong>velocity</strong> control for nudging playback speed, plus <strong>Ctrl+freeze</strong> to lock onto the current beat.
          </li>
          <li>
            New <strong>minimum branch length slider</strong> — filter out short jumps for longer runs before the Jukebox branches.
          </li>
          <li>
            Nightcore, Daycore and Vaporwave Audio Modes now have an <strong>intensity slider</strong> — dial the effect anywhere from 50% to 150%.
          </li>
          <li>
            Added <strong>translations</strong>: German and Spanish now available in Settings.
          </li>
        </ul>

        <h4>June 2026</h4>
        <ul>
          <li>
            A few more Audio Mode options introduced on the Extras menu: <strong>8-bit, Underwater, Cathedral</strong>
          </li>
          <li>
            <strong>Favorites search &amp; sorting</strong> added, maximum saved favorites bumped to 150 tracks.
          </li>
          <li>
            Added local <strong>Playlists</strong>: queue up to 10 tracks, then skip between them from the Listen screen. More info in the FAQ.
          </li>
          <li>
            <strong>Rewrote the app in React</strong> — please report any issues.
          </li>
        </ul>

        <h4>May 2026</h4>
        <ul>
          <li>
            Added <strong>More Cowbell</strong> and <strong>Swing</strong> remix toys to Extras, giving beat-aware ways to reshape tracks while the Jukebox plays.
          </li>
          <li>
            Offline App (PWA) can now <strong>export audio</strong> with any actively selected Audio Mode.
          </li>
          <li>
            Implemented <strong>custom anchor branches</strong>: select a backward branch and press A to make it the forced anchor jump.
          </li>
          <li>
            Added a <strong>sleep timer</strong> to the Tuning/Extras dialog.
          </li>
        </ul>

        <h4>April 2026</h4>
        <ul>
          <li>
            Added a <strong>What's New</strong> section (you are here)!
          </li>
          <li>
            Added <strong>SoundCloud</strong> and <strong>Bandcamp</strong> support via Upload by URL.
          </li>
          <li>
            <strong>Extras</strong> menu added (press E on the Listen screen or access in the tuning menu) for experimental features.
          </li>
          <li>
            Added highly requested <strong>nightcore</strong>, <strong>daycore</strong>, &amp; other <strong>Audio Mode</strong> options to the Extras menu.
          </li>
        </ul>

        <h4>March 2026</h4>
        <ul>
          <li>
            <strong>Branch stats</strong> toggle was added to provide helpful data points like direction, timing, &amp; match percentage.
          </li>
          <li>
            <strong>Bring It Home mode</strong> (press H on your keyboard to toggle) was added for a more linear playback option that finishes the track cleanly.
          </li>
          <li>
            The backend moved to <strong>madmom-beats-lite</strong>, improving progress reporting and memory footprint, while maintaining quality analysis.
          </li>
        </ul>

        <h4>February 2026</h4>
        <ul>
          <li>
            The <strong>Offline App</strong> (PWA) launched, making it possible to analyze and play tracks directly - without an internet connection.
          </li>
          <li>
            <strong>Recently Played</strong> and <strong>Trending</strong> discovery lists were added.
          </li>
          <li>
            A new <strong>Arc visualization</strong> replaced the Spiral view.
          </li>
        </ul>

        <h4>January 2026</h4>
        <ul>
          <li>
            Happy new year! Site <strong>launched</strong> on the first of the year.
          </li>
          <li>
            <strong>Favorites</strong> feature added, along with <strong>Favorites Sync</strong> so saved tracks can travel between sessions &amp; devices.
          </li>
          <li>
            Support was added for <strong>user uploads</strong> and manually added <strong>YouTube links</strong>.
          </li>
          <li>
            <strong>Autocanonizer mode</strong> was added as a new playback option.
          </li>
        </ul>
      </div>
    </section>
  );
}
