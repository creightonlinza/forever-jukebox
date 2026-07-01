import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
          className={subtab === "faq" ? "subtab-btn active" : "subtab-btn"}
          data-faq-subtab="faq"
          onClick={() => handleSubtabClick("faq")}
        >
          {t("common.faq")}
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
              infinite: <a href="https://musicmachinery.com/2012/11/12/the-infinite-jukebox/" target="_blank" rel="noreferrer" />,
              canon: <a href="https://musicmachinery.com/2014/03/18/how-the-autocanonizer-works/" target="_blank" rel="noreferrer" />,
              author: <a href="https://creighton.dev" target="_blank" rel="noreferrer" />,
            }}
          />
        </p>

        <h4>{t("faq.howTitle")}</h4>
        <p>{t("faq.howBody")}</p>
        <p>
          <Trans
            i18nKey="faq.sourceBody"
            components={{
              repo: <a href="https://github.com/creightonlinza/forever-jukebox/" target="_blank" rel="noreferrer" />,
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
              remix: <a href="https://github.com/echonest/remix" target="_blank" rel="noreferrer" />,
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
            components={{ offline: <a href="/offline/" target="_blank" /> }}
          />
        </p>

        <h4>{t("faq.cachedAudio")}</h4>
        <CachedAudioClearButton />
      </div>
      <div
        className={subtab === "whats-new" ? "faq faq-updates" : "faq faq-updates hidden"}
        id="faq-whats-new-panel"
      >
        <h4>{t("faq.july2026")}</h4>
        <p>{t("faq.julyIntro")}</p>
        <ul>
          <li>
            <Trans i18nKey="faq.julyPanning" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.julyThumbnails" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.julyVelocity" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.julyBranchLength" components={{ strong: <strong /> }} />
          </li>
        </ul>

        <h4>{t("faq.june2026")}</h4>
        <ul>
          <li>
            <Trans i18nKey="faq.juneModes" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.juneFavorites" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.junePlaylists" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.juneReact" components={{ strong: <strong /> }} />
          </li>
        </ul>

        <h4>{t("faq.may2026")}</h4>
        <ul>
          <li>
            <Trans i18nKey="faq.mayRemix" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.mayExport" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.mayAnchor" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.mayTimer" components={{ strong: <strong /> }} />
          </li>
        </ul>

        <h4>{t("faq.april2026")}</h4>
        <ul>
          <li>
            <Trans i18nKey="faq.aprilWhatsNew" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.aprilSources" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.aprilExtras" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.aprilModes" components={{ strong: <strong /> }} />
          </li>
        </ul>

        <h4>{t("faq.march2026")}</h4>
        <ul>
          <li>
            <Trans i18nKey="faq.marchStats" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.marchHome" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.marchBackend" components={{ strong: <strong /> }} />
          </li>
        </ul>

        <h4>{t("faq.february2026")}</h4>
        <ul>
          <li>
            <Trans i18nKey="faq.februaryOffline" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.februaryLists" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.februaryArc" components={{ strong: <strong /> }} />
          </li>
        </ul>

        <h4>{t("faq.january2026")}</h4>
        <ul>
          <li>
            <Trans i18nKey="faq.januaryLaunch" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.januaryFavorites" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.januaryUploads" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="faq.januaryCanon" components={{ strong: <strong /> }} />
          </li>
        </ul>
      </div>
    </section>
  );
}
