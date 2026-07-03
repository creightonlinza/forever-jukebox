import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAllAnalysisCache,
  getAnalysisCacheBytes,
} from "@/core/infrastructure/cache/analysisCache";
import { Trans, useTranslation } from "react-i18next";

function formatMegabytes(bytes: number) {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

export function Faq() {
  const { t } = useTranslation();
  const [usageBytes, setUsageBytes] = useState(0);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  const usageMb = useMemo(() => formatMegabytes(usageBytes), [usageBytes]);

  const refreshUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    try {
      const bytes = await getAnalysisCacheBytes();
      setUsageBytes(bytes);
    } catch (err) {
      console.warn(`Failed to load cache usage: ${String(err)}`);
      setUsageBytes(0);
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    refreshUsage().catch((err) => {
      console.warn(`Failed to refresh cache usage: ${String(err)}`);
    });
  }, [refreshUsage]);

  const onClearCache = useCallback(async () => {
    setIsClearing(true);
    setCacheMessage(null);
    try {
      await clearAllAnalysisCache();
      await refreshUsage();
    } catch (err) {
      console.warn(`Failed to clear analysis cache: ${String(err)}`);
      setCacheMessage(t("faq.clearFailed"));
    } finally {
      setIsClearing(false);
    }
  }, [refreshUsage, t]);

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
        <button
          className="tab-btn"
          type="button"
          disabled={isClearing || isLoadingUsage || usageBytes <= 0}
          onClick={onClearCache}
        >
          {isClearing
            ? t("faq.clearing")
            : t("faq.clearSize", { size: usageMb })}
        </button>
        {cacheMessage ? <p>{cacheMessage}</p> : null}
      </div>
    </section>
  );
}
