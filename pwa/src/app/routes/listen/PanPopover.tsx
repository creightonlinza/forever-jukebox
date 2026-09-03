import type React from "react";
import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/shared/autocanonizer/AutocanonizerViz";

export function PanPopover({
  isOpen,
  panelRef,
  buttonRef,
  mainPan,
  otherPan,
  onPanChange,
  onToggle,
}: {
  isOpen: boolean;
  panelRef: React.RefObject<HTMLDivElement>;
  buttonRef: React.RefObject<HTMLButtonElement>;
  mainPan: number;
  otherPan: number;
  onPanChange: (stream: "main" | "other", value: number) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="pan-control-wrap">
      <div
        className={`pan-control-panel ${
          isOpen ? "" : "is-hidden"
        }`}
        ref={panelRef}
      >
        <label className="stream-pan-control">
          <div className="label-line">
            <span className="pan-end-label">
              {t("listen.balanceLeft")}
            </span>
            <span style={{ color: AUTOCANONIZER_MAIN_COLOR }}>
              {t("listen.blueBalance")}
            </span>
            <span className="pan-end-label">
              {t("listen.balanceRight")}
            </span>
          </div>
          <input
            id="autocanonizer-main-pan"
            className="pan-slider stream-pan-slider"
            type="range"
            aria-label={t("listen.blueBalance")}
            min={-100}
            max={100}
            step={1}
            list="autocanonizer-pan-ticks"
            value={mainPan}
            style={{ accentColor: AUTOCANONIZER_MAIN_COLOR }}
            onChange={(event) =>
              onPanChange(
                "main",
                Number(event.target.value),
              )
            }
          />
        </label>
        <label className="stream-pan-control">
          <div className="label-line">
            <span className="pan-end-label">
              {t("listen.balanceLeft")}
            </span>
            <span style={{ color: AUTOCANONIZER_OTHER_COLOR }}>
              {t("listen.greenBalance")}
            </span>
            <span className="pan-end-label">
              {t("listen.balanceRight")}
            </span>
          </div>
          <input
            id="autocanonizer-other-pan"
            className="pan-slider stream-pan-slider"
            type="range"
            aria-label={t("listen.greenBalance")}
            min={-100}
            max={100}
            step={1}
            list="autocanonizer-pan-ticks"
            value={otherPan}
            style={{ accentColor: AUTOCANONIZER_OTHER_COLOR }}
            onChange={(event) =>
              onPanChange(
                "other",
                Number(event.target.value),
              )
            }
          />
        </label>
        <datalist id="autocanonizer-pan-ticks">
          <option value={-100} />
          <option value={0} />
          <option value={100} />
        </datalist>
      </div>
      <button
        id="autocanonizer-pan-button"
        className="volume-button pan-button"
        type="button"
        ref={buttonRef}
        onClick={onToggle}
        title={t("listen.audioBalance")}
        aria-label={t("listen.audioBalance")}
      >
        <SymbolIcon className="pan-icon" name="swap_horiz" />
      </button>
    </div>
  );
}
