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

  it("closes on Escape only when enabled and open", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal id="m" open onClose={onClose}>
        <div>body</div>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <Modal id="m" open onClose={onClose} closeOnEscape>
        <div>body</div>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <Modal id="m" open={false} onClose={onClose} closeOnEscape>
        <div>body</div>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
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
