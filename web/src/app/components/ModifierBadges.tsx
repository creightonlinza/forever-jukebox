import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";

export function ModifierBadges() {
  const { t } = useTranslation();
  const shiftBranching = useAppStore((s) => s.shiftBranching);
  const freezeBeat = useAppStore((s) => s.freezeBeat);
  if (!shiftBranching && !freezeBeat) {
    return null;
  }
  return (
    <div className="modifier-badges" role="status" aria-live="polite">
      {shiftBranching ? (
        <span className="modifier-badge">{t("playback.forceBranchBadge")}</span>
      ) : null}
      {freezeBeat ? (
        <span className="modifier-badge">{t("playback.freezeBeatBadge")}</span>
      ) : null}
    </div>
  );
}
