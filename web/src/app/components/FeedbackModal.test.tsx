import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { trackEvent } from "../analytics";
import { submitFeedback } from "../feedback";
import { useAppStore } from "../store";
import { showToast } from "../ui";
import { FeedbackModal } from "./FeedbackModal";

vi.mock("../analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../feedback", () => ({ submitFeedback: vi.fn() }));
vi.mock("../ui", () => ({ showToast: vi.fn() }));

function textarea() {
  return document.getElementById("feedback-text") as HTMLTextAreaElement;
}

function sendButton() {
  return document.getElementById("feedback-send") as HTMLButtonElement;
}

function open() {
  act(() => {
    useAppStore.setState({ feedbackModalOpen: true });
  });
}

describe("FeedbackModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (submitFeedback as Mock).mockResolvedValue(true);
    act(() => {
      useAppStore.setState({ feedbackModalOpen: false });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps Send disabled for blank and whitespace-only input", async () => {
    render(<FeedbackModal />);
    open();
    expect(sendButton().disabled).toBe(true);

    await userEvent.type(textarea(), "   ");
    expect(sendButton().disabled).toBe(true);

    await userEvent.type(textarea(), "x");
    expect(sendButton().disabled).toBe(false);
  });

  it("closes immediately and submits the trimmed text", async () => {
    render(<FeedbackModal />);
    open();
    await userEvent.type(textarea(), "  playback stalls  ");
    await userEvent.click(sendButton());

    expect(useAppStore.getState().feedbackModalOpen).toBe(false);
    expect(submitFeedback).toHaveBeenCalledWith("playback stalls");
  });

  it("toasts success after the dialog has closed", async () => {
    let settle: (sent: boolean) => void = () => {};
    (submitFeedback as Mock).mockReturnValue(
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
    );
    render(<FeedbackModal />);
    open();
    await userEvent.type(textarea(), "hello");
    await userEvent.click(sendButton());
    expect(showToast).not.toHaveBeenCalled();

    await act(async () => {
      settle(true);
    });
    expect(showToast).toHaveBeenCalledWith("Thanks — your feedback was sent.", {
      icon: "check_circle",
    });
    expect(trackEvent).toHaveBeenCalledWith("feedback", { result: "sent" });
  });

  it("toasts an error when the submission fails", async () => {
    (submitFeedback as Mock).mockResolvedValue(false);
    render(<FeedbackModal />);
    open();
    await userEvent.type(textarea(), "hello");
    await act(async () => {
      await userEvent.click(sendButton());
    });

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't send your feedback. Check your connection and try again.",
      { tone: "error", icon: "error" },
    );
    expect(trackEvent).toHaveBeenCalledWith("feedback", { result: "failed" });
  });

  it("clears the text when the dialog is reopened", async () => {
    render(<FeedbackModal />);
    open();
    await userEvent.type(textarea(), "draft");
    await userEvent.click(document.getElementById("feedback-cancel")!);
    open();
    expect(textarea().value).toBe("");
  });

  it("labels the text field", () => {
    render(<FeedbackModal />);
    open();
    expect(screen.getByLabelText("What's on your mind?")).toBe(textarea());
  });
});
