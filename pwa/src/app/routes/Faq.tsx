import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { SocialLinks } from "@forever-jukebox/shared/ui/SocialLinks";

// Sharing a name makes the browser keep one FAQ section open at a time.
function FaqItem({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details name="faq" open={open}>
      <summary>
        <h2>{title}</h2>
      </summary>
      {children}
    </details>
  );
}

export function Faq() {
  const { t } = useTranslation();
  return (
    <section className="panel panel--faq">
      <h1>{t("common.faq")}</h1>
      <div className="faq">
        <SocialLinks
          className="faq-socials"
          labels={{
            community: t("faq.communityLinks"),
            reddit: t("faq.reddit"),
            discord: t("faq.discord"),
            github: t("faq.github"),
          }}
        />
        <FaqItem title={t("faq.whatTitle")} open>
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
          <p>
            <Trans
              i18nKey="faq.playModesBody"
              components={{
                wub: <a href="https://github.com/psobot/wub-machine" target="_blank" rel="noreferrer">Wub Machine</a>,
              }}
            />
          </p>
        </FaqItem>
        <FaqItem title={t("faq.howTitle")}>
          <p>{t("faq.howBody")}</p>
          <p>
            <Trans
              i18nKey="faq.sourceBody"
              components={{
                repo: <a href="https://github.com/creightonlinza/forever-jukebox/" target="_blank" rel="noreferrer">forever-jukebox</a>,
              }}
            />
          </p>
        </FaqItem>
        <FaqItem title={t("faq.tuneTitle")}>
          <ul>
            <li>{t("faq.tuneOpen")}</li>
            <li>{t("faq.tuneThreshold")}</li>
            <li>{t("faq.tuneProbability")}</li>
            <li>{t("faq.tuneTypes")}</li>
            <li>{t("faq.tuneDelete")}</li>
          </ul>
        </FaqItem>
        <FaqItem title={t("faq.modesTitle")}>
          <ul>
            <li><Trans i18nKey="faq.modesTempo" /></li>
            <li><Trans i18nKey="faq.modes8d" /></li>
            <li><Trans i18nKey="faq.modes8bit" /></li>
            <li><Trans i18nKey="faq.modesLofi" /></li>
            <li><Trans i18nKey="faq.modesUnderwater" /></li>
            <li><Trans i18nKey="faq.modesCathedral" /></li>
            <li>
              <Trans
                i18nKey="faq.modesRemix"
                components={{
                  remix: <a href="https://github.com/echonest/remix" target="_blank" rel="noreferrer">Echo Nest Remix</a>,
                }}
              />
            </li>
            <li><Trans i18nKey="faq.modesInstrumental" /></li>
          </ul>
        </FaqItem>
        <FaqItem title={t("faq.storageTitle")}>
          <p>{t("faq.storageBody")}</p>
        </FaqItem>
      </div>
    </section>
  );
}
