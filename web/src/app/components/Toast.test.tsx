import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useAppStore } from "../store";
import { Toast } from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ toasts: [] });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("is hidden when there are no toasts", () => {
    render(<Toast />);
    const el = document.getElementById("toast");
    expect(el?.className).toBe("toast-stack hidden");
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
  });

  it("renders a plain message", () => {
    render(<Toast />);
    act(() => {
      useAppStore.setState({
        toasts: [{ id: 1, message: "Saved", tone: "default", exiting: false }],
      });
    });
    const el = document.getElementById("toast");
    expect(el?.className).toBe("toast-stack");
    const item = el?.querySelector(".toast");
    expect(item?.className).toBe("toast");
    expect(item?.textContent).toBe("Saved");
  });

  it("renders icon and error tone", () => {
    render(<Toast />);
    act(() => {
      useAppStore.setState({
        toasts: [
          { id: 1, message: "Nope", icon: "error", tone: "error", exiting: false },
        ],
      });
    });
    const item = document.querySelector("#toast .toast");
    expect(item?.className).toBe("toast error has-icon");
    expect(item?.querySelector(".toast-icon")?.textContent).toBe("error");
    expect(item?.textContent).toContain("Nope");
  });

  it("renders stacked toasts in order and marks exiting", () => {
    render(<Toast />);
    act(() => {
      useAppStore.setState({
        toasts: [
          { id: 1, message: "First", tone: "default", exiting: true },
          { id: 2, message: "Second", tone: "default", exiting: false },
        ],
      });
    });
    const items = document.querySelectorAll("#toast .toast");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("First");
    expect(items[0]?.className).toBe("toast exiting");
    expect(items[1]?.textContent).toBe("Second");
    expect(items[1]?.className).toBe("toast");
  });
});
