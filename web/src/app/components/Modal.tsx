import { useEffect, useRef, type ReactNode } from "react";

// Modals can stack (sleep timer opens over the tuning modal); Escape and the
// focus trap only act on the topmost open modal.
const openModalStack: HTMLElement[] = [];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function focusableElementsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) =>
    // checkVisibility is unavailable in jsdom; treat everything as visible there
    typeof el.checkVisibility === "function" ? el.checkVisibility() : true,
  );
}

// Modal primitive matching the legacy .modal/.modal-panel markup: visibility
// via the "open" class, backdrop click closes. All modals close on Escape and
// trap Tab focus while open; focus returns to the prior element on close.
export function Modal({
  id,
  open,
  onClose,
  panelClassName,
  role = "dialog",
  ariaModal = true,
  children,
}: {
  id?: string;
  open: boolean;
  onClose: () => void;
  panelClassName?: string;
  role?: string;
  ariaModal?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Children's refs/effects may move focus into the modal before our effect
  // runs, so the restore target must be captured at the open transition,
  // before anything inside the modal commits.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  if (open && !wasOpenRef.current) {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) {
      return;
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    openModalStack.push(root);
    // Only take over when the caller didn't place focus inside the modal.
    if (!root.contains(document.activeElement)) {
      focusableElementsIn(root)[0]?.focus();
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (openModalStack[openModalStack.length - 1] !== root) {
        return;
      }
      // An open modal can sit inside a tab panel the router has since
      // hidden (e.g. browser Back); while invisible it must not consume
      // Escape or trap Tab for the rest of the page.
      if (
        typeof root.checkVisibility === "function" &&
        !root.checkVisibility()
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = focusableElementsIn(root);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      const stackIndex = openModalStack.indexOf(root);
      if (stackIndex !== -1) {
        openModalStack.splice(stackIndex, 1);
      }
      const previous = previousFocusRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, [open]);

  return (
    <div
      id={id}
      ref={rootRef}
      className={open ? "modal open" : "modal"}
      role={role}
      aria-modal={ariaModal}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      // The real keyboard path is the window-level Escape listener above
      // (it must coordinate stacked modals); this local handler mirrors it
      // for direct backdrop focus and static analyzers. onClose is a
      // setState(false) everywhere, so the duplicate call is idempotent.
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={panelClassName ? `modal-panel ${panelClassName}` : "modal-panel"}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  title,
  closeId,
  onClose,
  children,
}: {
  title?: string;
  closeId?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="modal-header">
      {title !== undefined ? <h2>{title}</h2> : null}
      {children}
      <button
        id={closeId}
        className="modal-close"
        aria-label="Close"
        onClick={onClose}
      >
        <span
          className="material-symbols-outlined modal-close-icon"
          aria-hidden="true"
        >
          close
        </span>
      </button>
    </div>
  );
}
