import React from "react";
import { useTranslation } from "react-i18next";

// iOS WebKit maps the "audio/*" wildcard to a video UTI, greying out audio files in
// the Files picker, so list explicit MIME types + extensions (webkit.org/b/242110).
export const AUDIO_FILE_ACCEPT =
  "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/flac,audio/x-flac,audio/ogg,audio/opus,audio/webm,audio/aiff,audio/x-aiff,audio/x-ms-wma,audio/x-matroska,audio/amr,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.webm,.weba,.aiff,.aif,.wma,.mka,.amr";

type DropZoneProps = {
  onFile: (file: File) => void;
  accept?: string;
};

export function DropZone({ onFile, accept = AUDIO_FILE_ACCEPT }: DropZoneProps) {
  const { t } = useTranslation();
  const [active, setActive] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    onFile(files[0]);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const onDrag = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
  };

  return (
    <div className={`drop-zone ${active ? "is-active" : ""}`} onDrop={onDrop} onDragOver={onDrag} onDragLeave={onDragLeave}>
      <div className="drop-zone__content">
        <p className="drop-zone__title">{t("home.dropFile")}</p>
        <p className="drop-zone__sub">{t("common.or")}</p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          {t("home.chooseFile")}
        </button>
      </div>
      <input
        ref={inputRef}
        className="drop-zone__input"
        type="file"
        accept={accept}
        onChange={(event) => handleFiles(event.target.files)}
      />
    </div>
  );
}
