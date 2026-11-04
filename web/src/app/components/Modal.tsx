import { useRef, type ReactNode } from "react";
import { useModalKeyboard } from "@forever-jukebox/shared/ui/useModalKeyboard";
import "../i18n";
import { useTranslation } from "react-i18next";

// Modal primitive matching the existing .modal/.modal-panel CSS: visibility
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
  useModalKeyboard(rootRef, open, onClose);

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
      // The real keyboard path is the window-level Escape listener in
      // useModalKeyboard (it must coordinate stacked modals); this local handler mirrors it
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
  const { t } = useTranslation();
  return (
    <div className="modal-header">
      {title !== undefined ? <h2>{title}</h2> : null}
      {children}
      <button
        type="button"
        id={closeId}
        className="modal-close"
        aria-label={t("common.close")}
        title={t("common.close")}
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
