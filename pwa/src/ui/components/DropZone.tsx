import React from "react";

type DropZoneProps = {
  onFile: (file: File) => void;
  accept?: string;
};

export function DropZone({ onFile, accept }: DropZoneProps) {
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
        <p className="drop-zone__title">Drop an audio file</p>
        <p className="drop-zone__sub">or</p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          Choose file
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
