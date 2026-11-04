import { useEffect, useRef, type RefObject } from "react";

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

// While open, Escape calls onClose and Tab focus is trapped inside rootRef;
// focus returns to the previously focused element on close.
export function useModalKeyboard(
  rootRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Children's refs/effects may move focus into the modal before our effect
  // runs, so the restore target must be captured at the open transition,
  // before anything inside the modal commits.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
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
  }, [open, rootRef]);
}
