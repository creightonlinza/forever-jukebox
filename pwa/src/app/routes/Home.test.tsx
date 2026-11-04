import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "../i18n";
import { Home } from "./Home";
import {
  getFileHandle,
  readFileFromHandle,
} from "@/core/infrastructure/cache/fileHandleStore";

const appState = vi.hoisted(() => ({ setFile: vi.fn() }));
vi.mock("../state/AppState", () => ({ useAppState: () => appState }));

vi.mock("@/core/infrastructure/cache/analysisCache", () => ({
  deleteCachedAnalysis: vi.fn(async () => {}),
  listCachedAnalysisTracks: vi.fn(async () => [
    {
      fingerprint: "fp-1",
      title: "Song",
      artist: "Band",
      durationSeconds: 90,
      updatedAtEpochMs: null,
    },
  ]),
}));

vi.mock("@/core/infrastructure/cache/fileHandleStore", () => ({
  getFileHandle: vi.fn(),
  readFileFromHandle: vi.fn(),
}));

const song = new File([new Uint8Array([1])], "song.mp3");
const handle = { kind: "file", name: "song.mp3" } as FileSystemFileHandle;

async function renderHome() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/listen" element={<div>Listen page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole("button", { name: /^Song — Band/ });
}

async function clickRow(row: HTMLElement) {
  await act(async () => {
    fireEvent.click(row);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Home cached tracks", () => {
  let inputClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    appState.setFile.mockReset();
    vi.mocked(getFileHandle).mockReset().mockResolvedValue(null);
    vi.mocked(readFileFromHandle).mockReset().mockResolvedValue(null);
    inputClick = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    inputClick.mockRestore();
    cleanup();
  });

  it("plays a cached track straight from its stored file handle", async () => {
    vi.mocked(getFileHandle).mockResolvedValue(handle);
    vi.mocked(readFileFromHandle).mockResolvedValue(song);

    await clickRow(await renderHome());

    expect(getFileHandle).toHaveBeenCalledWith("fp-1");
    expect(appState.setFile).toHaveBeenCalledWith(song, handle);
    expect(screen.getByText("Listen page")).toBeTruthy();
    expect(inputClick).not.toHaveBeenCalled();
  });

  it("asks for the file when no handle is stored", async () => {
    await clickRow(await renderHome());

    expect(readFileFromHandle).not.toHaveBeenCalled();
    expect(appState.setFile).not.toHaveBeenCalled();
    expect(inputClick).toHaveBeenCalledTimes(1);
  });

  it("asks for the file when the stored handle can't be read", async () => {
    vi.mocked(getFileHandle).mockResolvedValue(handle);

    await clickRow(await renderHome());

    expect(readFileFromHandle).toHaveBeenCalledWith(handle);
    expect(appState.setFile).not.toHaveBeenCalled();
    expect(inputClick).toHaveBeenCalledTimes(1);
  });
});
