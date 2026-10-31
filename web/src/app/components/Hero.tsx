import { SocialLinks } from "@forever-jukebox/shared/ui/SocialLinks";
import { useAppStore } from "../store";
import { TabBar } from "./TabBar";
import { useTranslation } from "react-i18next";

export function SettingsButton({
  id,
  className = "settings-button",
}: { id?: string; className?: string } = {}) {
  const { t } = useTranslation();
  return (
    <button
      id={id}
      className={className}
      type="button"
      aria-label={t("settings.open")}
      title={t("settings.open")}
      onClick={() => useAppStore.setState({ settingsModalOpen: true })}
    >
      <span
        className="material-symbols-outlined settings-button-icon"
        aria-hidden="true"
      >
        settings
      </span>
    </button>
  );
}

export function HeroSocials({ className = "hero-socials" }: { className?: string } = {}) {
  const { t } = useTranslation();
  return (
    <SocialLinks
      className={className}
      labels={{
        community: t("hero.communityLinks"),
        reddit: t("hero.reddit"),
        discord: t("hero.discord"),
        github: t("hero.github"),
      }}
    />
  );
}

export function Hero() {
  const { t } = useTranslation();
  const goHome = useAppStore((s) => s.goHome);
  return (
    <header className="hero">
      <div className="hero-actions">
        <HeroSocials />
        <SettingsButton className="settings-button settings-button-hero" />
      </div>
      <div className="hero-main">
        <button
          id="hero-title-home"
          className="hero-title"
          type="button"
          aria-label={t("navigation.goToTopTracks")}
          onClick={() => goHome()}
        >
          <h1 className="hero-title-neon">
            FOREVER <span className="hero-title-jukebox">JUKEBOX</span>
          </h1>
        </button>
        <TabBar />
      </div>
    </header>
  );
}
