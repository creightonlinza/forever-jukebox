import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/app/i18n";
import { TuningModal } from "./TuningModal";

describe("TuningModal", () => {
  afterEach(() => {
    cleanup();
  });

  it.each(["tuning", "extras"] as const)(
    "is a modal dialog named by its %s title",
    (activeTab) => {
      render(
        <TuningModal
          playMode="jukebox"
          activeTab={activeTab}
          onTabChange={() => {}}
          tuneForm={{
            threshold: 30,
            computedThreshold: 30,
            minProb: 18,
            maxProb: 50,
            ramp: 10,
            volume: 50,
            highlightAnchorBranch: false,
            justBackwards: false,
            minLongBranchPercent: 0,
            removeSequentialBranches: false,
          }}
          setTuneForm={() => {}}
          extrasForm={{
            branchStatsEnabled: false,
            bringItHomeMode: false,
            customAnchorEnabled: false,
            audioMode: "off",
            audioIntensity: 50,
          }}
          setExtrasForm={() => {}}
          onClose={() => {}}
          showReset={false}
          onReset={() => {}}
          onApply={() => {}}
        />,
      );
      const title = screen.getByRole("heading", { level: 2 }).textContent!;
      const dialog = screen.getByRole("dialog", { name: title });
      expect(dialog.getAttribute("aria-modal")).toBe("true");
    },
  );
});
