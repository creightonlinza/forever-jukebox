import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToastQueue } from "./toastQueue";

describe("createToastQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("shows an item and removes it in two phases", () => {
    const queue = createToastQueue<{ message: string }>();
    queue.show({ message: "Hi" });
    expect(queue.getItems()).toEqual([
      expect.objectContaining({ message: "Hi", exiting: false }),
    ]);
    vi.advanceTimersByTime(2000);
    expect(queue.getItems()[0]?.exiting).toBe(true);
    vi.advanceTimersByTime(200);
    expect(queue.getItems()).toEqual([]);
  });

  it("stacks up to max oldest-first and drops the oldest beyond it", () => {
    const queue = createToastQueue<{ message: string }>({ max: 3 });
    queue.show({ message: "One" });
    queue.show({ message: "Two" });
    queue.show({ message: "Three" });
    queue.show({ message: "Four" });
    expect(queue.getItems().map((t) => t.message)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(queue.getItems()[0]?.exiting).toBe(true);
    vi.advanceTimersByTime(200);
    expect(queue.getItems().map((t) => t.message)).toEqual([
      "Two",
      "Three",
      "Four",
    ]);
  });

  it("refreshes the timer for an identical consecutive item", () => {
    const queue = createToastQueue<{ message: string }>();
    queue.show({ message: "Same" });
    vi.advanceTimersByTime(1000);
    queue.show({ message: "Same" });
    expect(queue.getItems()).toHaveLength(1);
    vi.advanceTimersByTime(1900);
    expect(queue.getItems()[0]?.exiting).toBe(false);
    vi.advanceTimersByTime(300);
    expect(queue.getItems()).toEqual([]);
  });

  it("treats items with differing fields as distinct", () => {
    const queue = createToastQueue<{ message: string; tone: string }>();
    queue.show({ message: "Same", tone: "default" });
    queue.show({ message: "Same", tone: "error" });
    expect(queue.getItems()).toHaveLength(2);
  });

  it("updates a keyed item in place instead of stacking", () => {
    const queue = createToastQueue<{ message: string }>();
    queue.show({ message: "+1" }, "velocity");
    queue.show({ message: "Other" });
    vi.advanceTimersByTime(1000);
    queue.show({ message: "+2" }, "velocity");
    expect(queue.getItems().map((t) => t.message)).toEqual(["+2", "Other"]);
    // The update refreshed the keyed item's timer, so it outlives "Other".
    vi.advanceTimersByTime(1900);
    expect(queue.getItems().map((t) => t.message)).toEqual(["+2"]);
    expect(queue.getItems()[0]?.exiting).toBe(false);
    vi.advanceTimersByTime(300);
    expect(queue.getItems()).toEqual([]);
  });

  it("notifies subscribers on changes and stops after unsubscribe", () => {
    const queue = createToastQueue<{ message: string }>();
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.show({ message: "Hi" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    queue.show({ message: "Again" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clear cancels timers and empties the stack", () => {
    const queue = createToastQueue<{ message: string }>();
    queue.show({ message: "Hi" });
    queue.clear();
    expect(queue.getItems()).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(queue.getItems()).toEqual([]);
  });
});
