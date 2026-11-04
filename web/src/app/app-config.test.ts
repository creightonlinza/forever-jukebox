import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateFavoritesFromSync,
  updateFavorites,
} from "./favorites-actions";
import { configureMaxFavorites, maxFavorites } from "./favorites";
import { useAppStore } from "./store";
import { applyAppConfig, bootstrapAppConfig } from "./app-config";
import type { AppConfig } from "./api";

vi.mock("./favorites-actions", () => ({
  hydrateFavoritesFromSync: vi.fn(),
  updateFavorites: vi.fn(),
}));

const initialStoreState = useAppStore.getState();

describe("applyAppConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({ footerCredit: null });
  });

  it("applies configured max favorites and trims local state", () => {
    useAppStore.setState({
      favorites: [
      {
        uniqueSongId: "1",
        title: "A",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
      {
        uniqueSongId: "2",
        title: "B",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
      {
        uniqueSongId: "3",
        title: "C",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
    ]
    });

    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      max_favorites: 2,
    });

    expect(maxFavorites()).toBe(2);
    expect(updateFavorites).toHaveBeenCalledWith(
      useAppStore.getState().favorites,
      { sync: false },
    );
  });

  it("publishes host credit with URL to the shell store", () => {
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
      hosted_by_url: "https://example.com",
    });

    expect(useAppStore.getState().footerCredit).toEqual({
      hostedByName: "Example Host",
      hostedByUrl: "https://example.com",
    });
  });

  it("publishes host credit without URL to the shell store", () => {
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
    });

    expect(useAppStore.getState().footerCredit).toEqual({
      hostedByName: "Example Host",
      hostedByUrl: null,
    });
  });

  it("hydrates favorites when fresh config allows sync", () => {
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      allow_favorites_sync: true,
    });

    expect(hydrateFavoritesFromSync).toHaveBeenCalledOnce();
  });

  it("skips favorites hydration when applying cached config", () => {
    applyAppConfig(
      {
        allow_user_upload: false,
        allow_user_url: false,
        allow_favorites_sync: true,
      },
      { hydrateFavorites: false },
    );

    expect(hydrateFavoritesFromSync).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function configFrom(host: string): AppConfig {
  return {
    allow_user_upload: false,
    allow_user_url: false,
    allow_favorites_sync: true,
    hosted_by_name: host,
  };
}

const appliedHost = () => useAppStore.getState().appConfig?.hosted_by_name;

describe("bootstrapAppConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
    useAppStore.setState(initialStoreState, true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("ignores a cached config that settles after the fresh one", async () => {
    const cached = deferred<unknown>();
    const save = vi.fn(() => Promise.resolve());
    const done = bootstrapAppConfig(
      () => cached.promise,
      () => Promise.resolve(configFrom("fresh")),
      save,
    );

    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    cached.resolve(configFrom("cached"));
    await done;

    expect(appliedHost()).toBe("fresh");
    expect(save).toHaveBeenCalledWith(configFrom("fresh"));
  });

  it("applies the cached config without hydration until the fresh one arrives", async () => {
    const fresh = deferred<AppConfig>();
    const done = bootstrapAppConfig(
      () => Promise.resolve(configFrom("cached")),
      () => fresh.promise,
      () => Promise.resolve(),
    );

    await vi.waitFor(() => expect(appliedHost()).toBe("cached"));
    expect(hydrateFavoritesFromSync).not.toHaveBeenCalled();
    fresh.resolve(configFrom("fresh"));
    await done;

    expect(appliedHost()).toBe("fresh");
    expect(hydrateFavoritesFromSync).toHaveBeenCalledOnce();
  });

  it("keeps the cached config when the fetch fails", async () => {
    await bootstrapAppConfig(
      () => Promise.resolve(configFrom("cached")),
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve(),
    );

    expect(appliedHost()).toBe("cached");
  });

  it("reports a failed cache save as a save failure, keeping the fresh config", async () => {
    await bootstrapAppConfig(
      () => Promise.resolve(null),
      () => Promise.resolve(configFrom("fresh")),
      () => Promise.reject(new Error("quota")),
    );

    expect(appliedHost()).toBe("fresh");
    expect(console.warn).toHaveBeenCalledWith("App config save failed: Error: quota");
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("fetch failed"),
    );
  });

  it("applies the fresh config when the cache read fails", async () => {
    await bootstrapAppConfig(
      () => Promise.reject(new Error("blocked")),
      () => Promise.resolve(configFrom("fresh")),
      () => Promise.resolve(),
    );

    expect(appliedHost()).toBe("fresh");
  });
});
