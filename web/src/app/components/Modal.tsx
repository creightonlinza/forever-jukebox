import { useEffect, type ReactNode } from "react";

// Modal primitive matching the legacy .modal/.modal-panel behavior:
// visibility via the "open" class, backdrop click closes, optional
// window-level Escape (the legacy app had Escape only on some modals and no
// focus trap; initial focus stays with the caller).
export function Modal({
  id,
  open,
  onClose,
  closeOnEscape = false,
  panelClassName,
  role,
  ariaModal,
  children,
}: {
  id?: string;
  open: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  panelClassName?: string;
  role?: string;
  ariaModal?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open || !closeOnEscape) {
      return;
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [open, closeOnEscape, onClose]);

  return (
    <div
      id={id}
      className={open ? "modal open" : "modal"}
      role={role}
      aria-modal={ariaModal}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
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
