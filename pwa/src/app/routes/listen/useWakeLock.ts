import React from "react";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
};

export function useWakeLock() {
  const wakeLockRef = React.useRef<WakeLockSentinelLike | null>(null);

  const requestWakeLock = React.useCallback(async () => {
    if (!("wakeLock" in navigator) || wakeLockRef.current) {
      return;
    }
    try {
      wakeLockRef.current = await (navigator as Navigator & {
        wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      }).wakeLock.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const releaseWakeLock = React.useCallback(async () => {
    if (!wakeLockRef.current) {
      return;
    }
    try {
      await wakeLockRef.current.release();
    } catch {
      // ignore
    }
    wakeLockRef.current = null;
  }, []);

  return { requestWakeLock, releaseWakeLock };
}
