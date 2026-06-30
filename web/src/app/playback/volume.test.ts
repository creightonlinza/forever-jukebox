import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import {
  setAutocanonizerStreamPans,
  setMasterVolume,
} from "./status-ui";

function createContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    player: { setVolume: vi.fn() },
    autocanonizer: { setVolume: vi.fn(), setStreamPans: vi.fn() },
    cowbellOverlay: { setVolume: vi.fn() },
    ...overrides,
  } as unknown as AppContext;
}

describe("setMasterVolume", () => {
  it("fans a percentage out to every sink as a 0–1 fraction", () => {
    const context = createContext();

    setMasterVolume(context, 50);

    // The regression this guards: forgetting /100 ships audio 100x too loud.
    expect(context.player.setVolume).toHaveBeenCalledWith(0.5);
    expect(context.autocanonizer?.setVolume).toHaveBeenCalledWith(0.5);
    expect(context.cowbellOverlay.setVolume).toHaveBeenCalledWith(0.5);
  });

  it("passes 0 and 100 through cleanly", () => {
    const context = createContext();

    setMasterVolume(context, 0);
    expect(context.player.setVolume).toHaveBeenLastCalledWith(0);

    setMasterVolume(context, 100);
    expect(context.player.setVolume).toHaveBeenLastCalledWith(1);
  });

  it("tolerates the autocanonizer not yet being attached", () => {
    const context = createContext({
      autocanonizer: null,
    });

    expect(() => setMasterVolume(context, 70)).not.toThrow();
    expect(context.player.setVolume).toHaveBeenCalledWith(0.7);
    expect(context.cowbellOverlay.setVolume).toHaveBeenCalledWith(0.7);
  });
});

describe("setAutocanonizerStreamPans", () => {
  it("converts both -100–100 pan values to -1–1 fractions", () => {
    const context = createContext();

    setAutocanonizerStreamPans(context, -25, 75);

    expect(context.autocanonizer?.setStreamPans).toHaveBeenCalledWith(
      -0.25,
      0.75,
    );
  });
});
