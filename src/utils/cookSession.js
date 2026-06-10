/**
 * cookSession.js — Active cook session persistence via localStorage
 *
 * Persists the in-progress cook (screen, selection, nav stack, cook-curve
 * history, rest-timer state) so a page reload, browser crash, or laptop
 * sleep doesn't lose the cook. App.jsx offers a "Resume?" prompt on load.
 *
 * The rest timer stores wall-clock epochs rather than tick counts, so a
 * rest that continues across a reload picks up at the correct elapsed time.
 *
 * Session shape (all fields optional):
 *   {
 *     savedAt:    epoch ms of last write (drives the max-age expiry),
 *     screen:     SCREENS value,
 *     selection:  App selection object (category/item/method/pull data…),
 *     navHistory: screen stack for the back button,
 *     cook: { startEpochMs, history: [{minute, coreTemp, surfaceTemp}] } | null,
 *     rest: { startEpochMs, accumSec, isRunning, isComplete, logSaved } | null,
 *   }
 */

const STORAGE_KEY = 'tempguide_session_v1';

/** Sessions older than this are discarded. Generous because brisket. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || typeof session !== 'object') return null;
    if (!session.savedAt || Date.now() - session.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Shallow-merge a patch into the stored session. Top-level keys in the patch
 * replace the existing value entirely (pass `cook: null` to clear the cook
 * curve while keeping the rest of the session).
 */
export function updateSession(patch) {
  try {
    const existing = loadSession() ?? {};
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...existing, ...patch, savedAt: Date.now() }),
    );
  } catch {
    // Quota exceeded / private mode — persistence is best-effort.
  }
}

export function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
