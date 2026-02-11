import React from "react";

type AppState = {
  file: File | null;
  setFile: (file: File | null) => void;
  isListenLoading: boolean;
  setIsListenLoading: (isLoading: boolean) => void;
};

const AppStateContext = React.createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isListenLoading, setIsListenLoading] = React.useState(false);
  const value = React.useMemo(
    () => ({ file, setFile, isListenLoading, setIsListenLoading }),
    [file, isListenLoading]
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
