import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useAppStore } from "../store";
import { Toast } from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ toast: null });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("is hidden when there is no toast", () => {
    render(<Toast />);
    const el = document.getElementById("toast");
    expect(el?.className).toBe("toast hidden");
    expect(el?.getAttribute("role")).toBe("status");
  });

  it("renders a plain message", () => {
    render(<Toast />);
    act(() => {
      useAppStore.setState({
        toast: { message: "Saved", tone: "default" },
      });
    });
    const el = document.getElementById("toast");
    expect(el?.className).toBe("toast");
    expect(el?.textContent).toBe("Saved");
  });

  it("renders icon and error tone", () => {
    render(<Toast />);
    act(() => {
      useAppStore.setState({
        toast: { message: "Nope", icon: "error", tone: "error" },
      });
    });
    const el = document.getElementById("toast");
    expect(el?.className).toBe("toast error has-icon");
    expect(el?.querySelector(".toast-icon")?.textContent).toBe("error");
    expect(el?.textContent).toContain("Nope");
  });
});
