import React from "react";
import { useTranslation } from "react-i18next";

// iOS WebKit maps the "audio/*" wildcard to a video UTI, greying out audio files in
// the Files picker, so list explicit MIME types + extensions (webkit.org/b/242110).
export const AUDIO_FILE_ACCEPT =
  "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/flac,audio/x-flac,audio/ogg,audio/opus,audio/webm,audio/aiff,audio/x-aiff,audio/x-ms-wma,audio/x-matroska,audio/amr,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.webm,.weba,.aiff,.aif,.wma,.mka,.amr";

// The handle is null where the browser can't hand one out (no File System Access).
export type AudioFileHandler = (file: File, handle: FileSystemFileHandle | null) => void;

function pickerTypes(accept: string) {
  const extensions = accept.split(",").filter((entry) => entry.startsWith("."));
  return [{ accept: { "audio/*": extensions } }];
}

// Opens the File System Access picker where available, so the chosen file
// comes with a handle; otherwise falls back to the returned hidden input.
export function useAudioFilePicker(onFile: AudioFileHandler, accept = AUDIO_FILE_ACCEPT) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const open = React.useCallback(async () => {
    if (!window.showOpenFilePicker) {
      inputRef.current?.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({ types: pickerTypes(accept) });
      if (handle) {
        onFile(await handle.getFile(), handle);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        inputRef.current?.click();
      }
    }
  }, [accept, onFile]);

  const input = (
    <input
      ref={inputRef}
      className="drop-zone__input"
      type="file"
      accept={accept}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) {
          onFile(file, null);
        }
        event.target.value = "";
      }}
    />
  );

  return { open, input };
}

type DropZoneProps = {
  onFile: AudioFileHandler;
  accept?: string;
};

export function DropZone({ onFile, accept = AUDIO_FILE_ACCEPT }: DropZoneProps) {
  const { t } = useTranslation();
  const [active, setActive] = React.useState(false);
  const picker = useAudioFilePicker(onFile, accept);

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    // Drop items are only readable during the event, so ask for the handle now.
    const item = Array.from(event.dataTransfer.items ?? []).find(
      (entry) => entry.kind === "file",
    );
    const pendingHandle = item?.getAsFileSystemHandle?.();
    if (!pendingHandle) {
      onFile(file, null);
      return;
    }
    pendingHandle
      .then((handle) => {
        onFile(file, handle?.kind === "file" ? (handle as FileSystemFileHandle) : null);
      })
      .catch(() => onFile(file, null));
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
          onClick={() => {
            void picker.open();
          }}
        >
          {t("home.chooseFile")}
        </button>
      </div>
      {picker.input}
    </div>
  );
}
