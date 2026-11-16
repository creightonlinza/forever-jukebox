import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/app/i18n";
import { InfoModal } from "./InfoModal";

describe("InfoModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("is a modal dialog named by its title", () => {
    render(
      <InfoModal
        trackDurationSeconds={120}
        totalBeats={200}
        totalBranches={10}
        deletedBranches={0}
        onClose={() => {}}
      />,
    );
    const title = screen.getByRole("heading", { level: 2 }).textContent!;
    const dialog = screen.getByRole("dialog", { name: title });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
