import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal, ModalHeader } from "./Modal";

describe("Modal", () => {
  afterEach(() => {
    cleanup();
  });

  it("toggles the open class", () => {
    const { rerender } = render(
      <Modal id="m" open={false} onClose={vi.fn()}>
        <div>body</div>
      </Modal>,
    );
    expect(document.getElementById("m")?.className).toBe("modal");
    rerender(
      <Modal id="m" open onClose={vi.fn()}>
        <div>body</div>
      </Modal>,
    );
    expect(document.getElementById("m")?.className).toBe("modal open");
  });

  it("closes on backdrop click but not on panel click", async () => {
    const onClose = vi.fn();
    render(
      <Modal id="m" open onClose={onClose}>
        <div>body</div>
      </Modal>,
    );
    await userEvent.click(document.querySelector(".modal-panel")!);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(document.getElementById("m")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape while open", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal id="m" open onClose={onClose}>
        <div>body</div>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <Modal id="m" open={false} onClose={onClose}>
        <div>body</div>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape and Tab while the modal is open but not visible", async () => {
    // e.g. a route change hid the tab panel containing an open modal
    const onClose = vi.fn();
    render(
      <Modal id="m" open onClose={onClose}>
        <button>inside</button>
      </Modal>,
    );
    const root = document.getElementById("m") as HTMLElement & {
      checkVisibility?: () => boolean;
    };
    root.checkVisibility = () => false;
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    root.checkVisibility = () => true;
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape only closes the topmost of stacked modals", async () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Modal id="bottom" open onClose={closeBottom}>
          <div>bottom</div>
        </Modal>
        <Modal id="top" open onClose={closeTop}>
          <div>top</div>
        </Modal>
      </>,
    );
    await userEvent.keyboard("{Escape}");
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it("focuses the first focusable element on open and traps Tab", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal id="m" open={false} onClose={onClose}>
        <button id="first">first</button>
        <button id="last">last</button>
      </Modal>,
    );
    rerender(
      <Modal id="m" open onClose={onClose}>
        <button id="first">first</button>
        <button id="last">last</button>
      </Modal>,
    );
    expect(document.activeElement?.id).toBe("first");

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement?.id).toBe("last");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.id).toBe("first");
  });

  it("leaves caller-placed focus alone and restores focus on close", () => {
    const onClose = vi.fn();
    function Body() {
      return (
        <input
          id="inner"
          ref={(node) => {
            node?.focus();
          }}
        />
      );
    }
    const { rerender } = render(
      <>
        <button id="trigger">open</button>
        <Modal id="m" open={false} onClose={onClose}>
          <Body key="closed" />
        </Modal>
      </>,
    );
    document.getElementById("trigger")!.focus();
    rerender(
      <>
        <button id="trigger">open</button>
        <Modal id="m" open onClose={onClose}>
          <Body key="open" />
        </Modal>
      </>,
    );
    expect(document.activeElement?.id).toBe("inner");
    rerender(
      <>
        <button id="trigger">open</button>
        <Modal id="m" open={false} onClose={onClose}>
          <Body key="closed-again" />
        </Modal>
      </>,
    );
    expect(document.activeElement?.id).toBe("trigger");
  });

  it("renders a header with title and close button", async () => {
    const onClose = vi.fn();
    render(
      <Modal id="m" open onClose={onClose}>
        <ModalHeader title="Hello" closeId="m-close" onClose={onClose} />
      </Modal>,
    );
    expect(document.querySelector(".modal-header h2")?.textContent).toBe(
      "Hello",
    );
    await userEvent.click(document.getElementById("m-close")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
