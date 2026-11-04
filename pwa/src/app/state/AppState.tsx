import React from "react";

type AppState = {
  file: File | null;
  // Handle the file was opened through, when the browser provides one.
  fileHandle: FileSystemFileHandle | null;
  setFile: (file: File | null, handle?: FileSystemFileHandle | null) => void;
  isListenLoading: boolean;
  setIsListenLoading: (isLoading: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;
};

const AppStateContext = React.createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelection] = React.useState<{
    file: File | null;
    handle: FileSystemFileHandle | null;
  }>({ file: null, handle: null });
  const setFile = React.useCallback(
    (file: File | null, handle: FileSystemFileHandle | null = null) => {
      setSelection({ file, handle });
    },
    [],
  );
  const [isListenLoading, setIsListenLoading] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({
      file: selection.file,
      fileHandle: selection.handle,
      setFile,
      isListenLoading,
      setIsListenLoading,
      isSettingsOpen,
      setIsSettingsOpen,
    }),
    [selection, setFile, isListenLoading, isSettingsOpen]
  );
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = React.useContext(AppStateContext);
  if (!ctx) {
    throw new Error("AppStateProvider missing");
  }
  return ctx;
}
