import { useAppStore } from "../store";

export function Toast() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div id="toast" className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => {
        let className = "toast";
        if (toast.tone === "error") {
          className += " error";
        }
        if (toast.icon) {
          className += " has-icon";
        }
        if (toast.exiting) {
          className += " exiting";
        }
        return (
          <div key={toast.id} className={className}>
            {toast.icon ? (
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
              toast.message
            )}
          </div>
        );
      })}
    </div>
  );
}
