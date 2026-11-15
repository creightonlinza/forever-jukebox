import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/app/i18n";
import { ExportModal } from "./ExportModal";

describe("ExportModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("is a modal dialog named by its title", () => {
    render(
      <ExportModal
        form={{ durationSeconds: 600, format: "mp3", bitrateKbps: 192 }}
        setForm={() => {}}
        isExporting={false}
        progress={null}
        error={null}
        onClose={() => {}}
        onExport={() => {}}
        playMode="jukebox"
        remixDurationSeconds={120}
      />,
    );
    const title = screen.getByRole("heading", { level: 2 }).textContent!;
    const dialog = screen.getByRole("dialog", { name: title });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
