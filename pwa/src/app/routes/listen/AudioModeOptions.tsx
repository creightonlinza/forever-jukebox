import { useTranslation } from "react-i18next";
import type { JukeboxAudioMode } from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import {
  MAX_AUDIO_MODE_INTENSITY,
  MIN_AUDIO_MODE_INTENSITY,
  audioModeSupportsIntensity,
} from "@forever-jukebox/shared/audio/audioModes";
import {
  AUDIO_MODE_SECTIONS,
  audioModeLabel,
  getAudioModeInputId,
  type AudioModeSection,
} from "./audioMode";

function AudioModeRadio({
  option,
  checked,
  disabled,
  onChange,
  className = "",
}: {
  option: JukeboxAudioMode;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={`audio-mode-option ${className}`.trim()}>
      <input
        id={getAudioModeInputId(option)}
        type="radio"
        name="audio-mode"
        value={option}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span>{audioModeLabel(option, t)}</span>
    </label>
  );
}

function AudioModeSectionGroup({
  section,
  selectedAudioMode,
  disabled,
  onChange,
  intensityPct,
  onIntensityChange,
}: {
  section: AudioModeSection;
  selectedAudioMode: JukeboxAudioMode;
  disabled: boolean;
  onChange: (mode: JukeboxAudioMode) => void;
  intensityPct: number;
  onIntensityChange: (intensityPct: number) => void;
}) {
  const { t } = useTranslation();
  const showIntensity =
    section.options.includes(selectedAudioMode) &&
    audioModeSupportsIntensity(selectedAudioMode);
  return (
    <div className="audio-mode-section">
      <div className="audio-mode-section-title">{t(section.titleKey)}</div>
      <div className="audio-mode-section-options">
        {section.options.map((option) => (
          <AudioModeRadio
            key={option}
            option={option}
            checked={selectedAudioMode === option}
            disabled={disabled}
            onChange={() => onChange(option)}
          />
        ))}
      </div>
      {showIntensity ? (
        <label>
          <div className="label-line">
            <span>{t("audioModes.intensity")}</span>
            <span>{intensityPct}%</span>
          </div>
          <input
            id="audio-intensity"
            type="range"
            aria-label={t("audioModes.intensity")}
            min={MIN_AUDIO_MODE_INTENSITY}
            max={MAX_AUDIO_MODE_INTENSITY}
            step={5}
            value={intensityPct}
            disabled={disabled}
            onChange={(event) => onIntensityChange(Number(event.target.value))}
          />
        </label>
      ) : null}
    </div>
  );
}

export function AudioModeOptions({
  selectedAudioMode,
  disabled,
  onChange,
  intensityPct,
  onIntensityChange,
}: {
  selectedAudioMode: JukeboxAudioMode;
  disabled: boolean;
  onChange: (mode: JukeboxAudioMode) => void;
  intensityPct: number;
  onIntensityChange: (intensityPct: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="audio-mode-options"
      role="radiogroup"
      aria-label={t("tuning.audioMode")}
    >
      <AudioModeRadio
        option="off"
        className="audio-mode-default-option"
        checked={selectedAudioMode === "off"}
        disabled={disabled}
        onChange={() => onChange("off")}
      />
      {AUDIO_MODE_SECTIONS.map((section) => (
        <AudioModeSectionGroup
          key={section.titleKey}
          section={section}
          selectedAudioMode={selectedAudioMode}
          disabled={disabled}
          onChange={onChange}
          intensityPct={intensityPct}
          onIntensityChange={onIntensityChange}
        />
      ))}
    </div>
  );
}
