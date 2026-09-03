import React from "react";
import type { ToastQueue } from "@forever-jukebox/shared/ui/toastQueue";

export type ShortcutToastQueue = ToastQueue<{ message: string }>;

export function ShortcutToastStack({ queue }: { queue: ShortcutToastQueue }) {
  const toasts = React.useSyncExternalStore(queue.subscribe, queue.getItems);
  return (
    <div className="shortcut-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={
            toast.exiting ? "shortcut-toast exiting" : "shortcut-toast"
          }
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
