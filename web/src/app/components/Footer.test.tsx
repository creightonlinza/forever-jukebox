import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useAppStore } from "../store";
import { Footer } from "./Footer";

describe("Footer", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ footerCredit: null });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the default credit when no config has arrived", () => {
    render(<Footer />);
    const credit = document.getElementById("site-footer-credit");
    expect(credit?.textContent).toBe(
      "The Forever Jukebox & Analysis Engine by Creighton",
    );
    const link = screen.getByText("Creighton") as HTMLAnchorElement;
    expect(link.href).toBe("https://creighton.dev/");
    expect(link.rel).toBe("noreferrer");
  });

  it("renders host credit as a link when name and URL are configured", () => {
    act(() => {
      useAppStore.getState().setFooterCredit({
        hostedByName: "Example Host",
        hostedByUrl: "https://example.com",
      });
    });
    render(<Footer />);
    const credit = document.getElementById("site-footer-credit");
    expect(credit?.textContent).toBe(
      "The Forever Jukebox & Analysis Engine by Creighton. This instance is hosted by Example Host.",
    );
    const hostLink = screen.getByText("Example Host") as HTMLAnchorElement;
    expect(hostLink.href).toBe("https://example.com/");
  });

  it("renders host credit as plain text when no URL is configured", () => {
    act(() => {
      useAppStore.getState().setFooterCredit({
        hostedByName: "Example Host",
        hostedByUrl: null,
      });
    });
    render(<Footer />);
    const credit = document.getElementById("site-footer-credit");
    expect(credit?.textContent).toBe(
      "The Forever Jukebox & Analysis Engine by Creighton. This instance is hosted by Example Host.",
    );
    const links = credit?.querySelectorAll("a") ?? [];
    expect(links.length).toBe(1);
    expect(links[0].textContent).toBe("Creighton");
  });
});
