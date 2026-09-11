import { Trans, useTranslation } from "react-i18next";

export function Faq() {
  const { t } = useTranslation();
  return (
    <section className="panel panel--faq">
      <h1>{t("common.faq")}</h1>
      <div className="faq">
        <h2>{t("faq.whatTitle")}</h2>
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

        <h2>{t("faq.howTitle")}</h2>
        <p>
          <Trans
            i18nKey="faq.howBody"
            components={{
              br: <br />,
              repo: <a href="https://github.com/creightonlinza/forever-jukebox/" target="_blank" rel="noreferrer">forever-jukebox</a>,
            }}
          />
        </p>

        <h2>{t("faq.tuneTitle")}</h2>
        <ul>
          <li>{t("faq.tuneThresholds")}</li>
          <li>{t("faq.tuneTypes")}</li>
          <li>{t("faq.tuneDelete")}</li>
        </ul>

        <h2>{t("faq.storageTitle")}</h2>
        <p>{t("faq.storageBody")}</p>
      </div>
    </section>
  );
}
