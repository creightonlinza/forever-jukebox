import type { AppContext } from "../context";

export function requestWakeLock(context: AppContext) {
  if (!("wakeLock" in navigator)) {
    return;
  }
  if (context.state.wakeLock || !document.fullscreenElement) {
    return;
  }
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      context.state.wakeLock = lock;
      function onRelease() {
        if (context.state.wakeLock === lock) {
          handleWakeLockRelease(context);
        }
      }
      lock.addEventListener("release", onRelease);
    })
    .catch(() => {
      console.warn("Wake lock unavailable");
    });
}

function handleWakeLockRelease(context: AppContext) {
  context.state.wakeLock = null;
}

export function releaseWakeLock(context: AppContext) {
  const lock = context.state.wakeLock;
  if (!lock) {
    return;
  }
  context.state.wakeLock = null;
  lock.release().catch(() => {
    console.warn("Failed to release wake lock");
  });
}
