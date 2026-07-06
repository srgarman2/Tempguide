/**
 * alerts.js — Audible + browser-notification alerts for cook events
 *
 * Sounds are synthesized with the Web Audio API (no audio assets), so they
 * work offline. Browsers require a user gesture before audio can play, which
 * is why enabling alerts is an explicit toggle: the toggle click unlocks the
 * AudioContext and (once) requests Notification permission.
 *
 * Notifications matter more than sound for the "laptop across the room"
 * case: they surface at OS level even when the tab is hidden, and clicking
 * one refocuses the app. Sound may be suppressed in hidden tabs by the
 * browser's autoplay policy — the notification still gets through.
 *
 * Preference persists in localStorage; permission is the browser's own state.
 */

const PREF_KEY = 'tempguide_alerts_v1';

// ── Preference ────────────────────────────────────────────────────────────────

export function alertsEnabled() {
  try { return localStorage.getItem(PREF_KEY) === 'true'; } catch { return false; }
}

export function setAlertsEnabled(on) {
  try { localStorage.setItem(PREF_KEY, String(on)); } catch {}
}

/**
 * Turn alerts on from a user gesture: persists the preference, unlocks the
 * AudioContext (must happen inside the gesture), and requests Notification
 * permission if it hasn't been decided yet. Sound works even if the
 * notification permission is declined.
 */
export async function enableAlerts() {
  setAlertsEnabled(true);
  try { getCtx()?.resume?.(); } catch {}
  playAlertSound('enable');   // confirmation beep — also proves audio is unlocked
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch {}
}

// ── Sound ─────────────────────────────────────────────────────────────────────

let audioCtx = null;

function getCtx() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(ctx, atTime, freq, durationSec = 0.16, peakGain = 0.28) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Quick attack, exponential decay — a soft "ding" rather than a square buzz
  gain.gain.setValueAtTime(0.0001, atTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, atTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + durationSec + 0.05);
}

/** Beep patterns: [offsetSec, frequencyHz] pairs. */
const PATTERNS = {
  enable: [[0, 880]],                                    // single ding — "alerts armed"
  near:   [[0, 660], [0.28, 660]],                       // double — approaching pull temp
  pull:   [[0, 880], [0.22, 880], [0.44, 1175]],         // urgent triple, rising
  done:   [[0, 523.25], [0.18, 659.25], [0.36, 783.99]], // C–E–G chime — rest complete
};

export function playAlertSound(kind) {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime + 0.02;
    for (const [dt, freq] of PATTERNS[kind] ?? PATTERNS.enable) {
      beep(ctx, now + dt, freq);
    }
  } catch {}
}

// ── Notifications ─────────────────────────────────────────────────────────────

export function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'tempguide-cook',   // replaces the previous alert instead of stacking
      renotify: true,
    });
    n.onclick = () => { try { window.focus(); n.close(); } catch {} };
  } catch {}
}

/** Fire sound + notification together (both individually guarded). */
export function alert(kind, title, body) {
  playAlertSound(kind);
  notify(title, body);
}
