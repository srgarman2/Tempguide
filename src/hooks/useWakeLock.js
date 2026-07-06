/**
 * useWakeLock — keeps the screen awake while a cook or rest is in progress.
 *
 * Uses the Screen Wake Lock API (Chrome/Edge — the same browsers that have
 * Web Bluetooth). The OS releases the lock automatically whenever the tab is
 * hidden, so a visibilitychange listener re-acquires it when the user
 * returns. Silently does nothing where unsupported.
 */

import { useEffect } from 'react';

export default function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let lock = null;
    let disposed = false;

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
        // Unmounted while the request was in flight — release immediately
        if (disposed) { lock?.release?.().catch(() => {}); lock = null; }
      } catch {
        // Denied (battery saver, permissions policy) — non-fatal
        lock = null;
      }
    };

    const onVisibility = () => {
      if (!document.hidden && lock == null && !disposed) acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      lock?.release?.().catch(() => {});
      lock = null;
    };
  }, [active]);
}
