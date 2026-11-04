// Every name must be in the bundled subset font (see @font-face in styles.css).
type SymbolName =
  | "play_arrow"
  | "pause"
  | "tune"
  | "info"
  | "download"
  | "delete"
  | "arrow_drop_down"
  | "swap_horiz"
  | "volume_up"
  | "volume_off"
  | "fullscreen"
  | "fullscreen_exit"
  | "close"
  | "help"
  | "science"
  | "hourglass_top"
  | "settings";

type SymbolIconProps = {
  name: SymbolName;
  className?: string;
};

export function SymbolIcon({ name, className }: SymbolIconProps) {
  return (
    <span
      className={
        className ? `material-symbols-outlined ${className}` : "material-symbols-outlined"
      }
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
