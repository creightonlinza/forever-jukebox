import type React from "react";
import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";

export function VolumePopover({
  isOpen,
  panelRef,
  buttonRef,
  volume,
  onVolumeChange,
  onToggle,
}: {
  isOpen: boolean;
  panelRef: React.RefObject<HTMLDivElement>;
  buttonRef: React.RefObject<HTMLButtonElement>;
  volume: number;
  onVolumeChange: (value: number) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="volume-control-wrap">
      <div
        className={`volume-control-panel ${
          isOpen ? "" : "is-hidden"
        }`}
        ref={panelRef}
      >
        <label>
          <input
            className="volume-slider"
            type="range"
            aria-label={t("listen.volume")}
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(event) =>
              onVolumeChange(Number(event.target.value))
            }
          />
          <div className="label-line">
            <span className="volume-value">{volume}</span>
          </div>
        </label>
      </div>
      <button
        id="volume-button"
        className="volume-button"
        type="button"
        ref={buttonRef}
        onClick={onToggle}
        title={t("listen.volume")}
        aria-label={t("listen.volume")}
      >
        <SymbolIcon className="volume-icon" name="volume_up" />
      </button>
    </div>
  );
}
