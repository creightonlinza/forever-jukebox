import { useAppStore } from "../store";

export function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }
  if (useAppStore.getState().wakeLock || !document.fullscreenElement) {
    return;
  }
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      useAppStore.setState({ wakeLock: lock });
      function onRelease() {
        if (useAppStore.getState().wakeLock === lock) {
          handleWakeLockRelease();
        }
      }
      lock.addEventListener("release", onRelease);
    })
    .catch(() => {
      console.warn("Wake lock unavailable");
    });
}

function handleWakeLockRelease() {
  useAppStore.setState({ wakeLock: null });
}

export function releaseWakeLock() {
  const lock = useAppStore.getState().wakeLock;
  if (!lock) {
    return;
  }
  useAppStore.setState({ wakeLock: null });
  lock.release().catch(() => {
    console.warn("Failed to release wake lock");
  });
}
