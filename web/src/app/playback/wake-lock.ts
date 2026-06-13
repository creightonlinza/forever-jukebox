import { useAppStore } from "../store";

let wakeLockRequestInFlight = false;

export function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }
  // The store grant is set asynchronously, so the null check alone lets two
  // near-simultaneous calls both proceed and leak the first lock. Gate on an
  // in-flight flag too.
  if (
    useAppStore.getState().wakeLock ||
    wakeLockRequestInFlight ||
    !document.fullscreenElement
  ) {
    return;
  }
  wakeLockRequestInFlight = true;
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      wakeLockRequestInFlight = false;
      // The request can resolve after we've left fullscreen (or after another
      // grant landed); a lock nobody will release. Drop it immediately.
      if (!document.fullscreenElement || useAppStore.getState().wakeLock) {
        lock.release().catch(() => {
          console.warn("Failed to release wake lock");
        });
        return;
      }
      useAppStore.setState({ wakeLock: lock });
      function onRelease() {
        if (useAppStore.getState().wakeLock === lock) {
          handleWakeLockRelease();
        }
      }
      lock.addEventListener("release", onRelease);
    })
    .catch(() => {
      wakeLockRequestInFlight = false;
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
