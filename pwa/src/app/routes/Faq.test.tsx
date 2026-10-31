import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../i18n";
import { Faq } from "./Faq";

describe("Faq", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders collapsible sections with only the first open", () => {
    const { container } = render(<Faq />);
    const sections = [...container.querySelectorAll("details")];
    expect(sections.length).toBe(5);
    expect(sections.every((section) => section.getAttribute("name") === "faq")).toBe(true);
    expect(sections.map((section) => section.open)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(screen.getByText("What the what?")).toBeTruthy();
  });

  it("links the community channels", () => {
    render(<Faq />);
    expect(screen.getByLabelText("Reddit community").getAttribute("href")).toContain("reddit.com");
    expect(screen.getByLabelText("Discord server").getAttribute("href")).toContain("discord.com");
    expect(screen.getByLabelText("GitHub repository").getAttribute("href")).toContain("github.com");
  });
});
