let wakeLockRequestInFlight = false;
let wakeLock: WakeLockSentinel | null = null;

export function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }
  // The grant is set asynchronously, so the null check alone lets two
  // near-simultaneous calls both proceed and leak the first lock. Gate on an
  // in-flight flag too.
  if (
    wakeLock ||
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
      if (!document.fullscreenElement || wakeLock) {
        lock.release().catch(() => {
          console.warn("Failed to release wake lock");
        });
        return;
      }
      wakeLock = lock;
      function onRelease() {
        if (wakeLock === lock) {
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
  wakeLock = null;
}

export function releaseWakeLock() {
  const lock = wakeLock;
  if (!lock) {
    return;
  }
  wakeLock = null;
  lock.release().catch(() => {
    console.warn("Failed to release wake lock");
  });
}
