import { useAppStore } from "../store";

export function Toast() {
  const toast = useAppStore((s) => s.toast);
  let className = "toast";
  if (toast?.tone === "error") {
    className += " error";
  }
  if (toast?.icon) {
    className += " has-icon";
  }
  if (!toast) {
    className += " hidden";
  }
  return (
    <div id="toast" className={className} role="status" aria-live="polite">
      {toast?.icon ? (
        <>
          <span
            className="material-symbols-outlined toast-icon"
            aria-hidden="true"
          >
            {toast.icon}
          </span>
          <span>{toast.message}</span>
        </>
      ) : (
        toast?.message ?? ""
      )}
    </div>
  );
}
