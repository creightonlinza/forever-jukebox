import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../analytics";
import { submitFeedback } from "../feedback";
import { useAppStore } from "../store";
import { showToast } from "../ui";
import { Modal, ModalHeader } from "./Modal";

export function FeedbackModal() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.feedbackModalOpen);
  const [text, setText] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      textRef.current?.focus();
    }
  }, [open]);

  const close = () => useAppStore.setState({ feedbackModalOpen: false });
  const trimmed = text.trim();

  // The dialog closes on Send and the toast arrives later, so the request must
  // not be awaited here: this component unmounts its content before it settles.
  const send = () => {
    close();
    void submitFeedback(trimmed).then((sent) => {
      trackEvent("feedback", { result: sent ? "sent" : "failed" });
      showToast(
        sent ? t("feedback.sent") : t("feedback.failed"),
        sent
          ? { icon: "check_circle" }
          : { tone: "error", icon: "error" },
      );
    });
  };

  return (
    <Modal
      id="feedback-modal"
      open={open}
      onClose={close}
      panelClassName="feedback-panel"
    >
      <ModalHeader
        title={t("feedback.title")}
        closeId="feedback-close"
        onClose={close}
      />
      <div className="modal-body">
        <p className="modal-hint">{t("feedback.description")}</p>
        <textarea
          id="feedback-text"
          ref={textRef}
          className="feedback-textarea"
          rows={5}
          value={text}
          aria-label={t("feedback.placeholder")}
          placeholder={t("feedback.placeholder")}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="modal-footer feedback-footer">
        <button id="feedback-cancel" type="button" onClick={close}>
          {t("common.cancel")}
        </button>
        <button
          id="feedback-send"
          type="button"
          disabled={trimmed.length === 0}
          onClick={send}
        >
          {t("feedback.send")}
        </button>
      </div>
    </Modal>
  );
}
