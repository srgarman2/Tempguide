/**
 * Accumulates temperature readings over time during the cook phase.
 * Samples every ~10 seconds to keep data manageable while providing
 * a smooth chart curve (~6 points per minute).
 *
 * Works with both BLE probe data and manual temp entry.
 * surfaceTemp will be null when no multi-sensor probe is connected.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { loadSession, updateSession } from '../utils/cookSession';

const SAMPLE_INTERVAL_MS = 10_000; // 10 seconds between samples

/** Cap on persisted points (~3.5 h at 10 s sampling) to bound localStorage
 *  use on very long cooks. In-memory history is unaffected. */
const MAX_PERSISTED_POINTS = 1200;

export default function useCookHistory(coreTemp, surfaceTemp) {
  // Restore an in-progress cook curve after a reload. App.jsx clears
  // session.cook on each fresh navigation to the cook screen, so anything
  // found here belongs to THIS cook.
  const saved = useMemo(() => {
    const cook = loadSession()?.cook;
    return cook && Array.isArray(cook.history) && cook.startEpochMs ? cook : null;
  }, []);

  const [history, setHistory] = useState(saved?.history ?? []);
  const startTimeRef = useRef(saved?.startEpochMs ?? null);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    // Don't record until we have a core temp reading
    if (coreTemp == null) return;

    const now = Date.now();

    // Initialize start time on first valid reading
    if (startTimeRef.current == null) {
      startTimeRef.current = now;
    }

    // Throttle: only record if SAMPLE_INTERVAL_MS has passed
    if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleRef.current = now;

    const elapsedMin = (now - startTimeRef.current) / 60_000;

    setHistory(prev => [
      ...prev,
      {
        minute: Math.round(elapsedMin * 100) / 100,
        coreTemp,
        surfaceTemp: surfaceTemp ?? null,
      },
    ]);
  }, [coreTemp, surfaceTemp]);

  // Persist the curve so a reload can restore it (best-effort).
  useEffect(() => {
    if (history.length === 0 || startTimeRef.current == null) return;
    updateSession({
      cook: {
        startEpochMs: startTimeRef.current,
        history: history.slice(-MAX_PERSISTED_POINTS),
      },
    });
  }, [history]);

  const reset = useCallback(() => {
    setHistory([]);
    startTimeRef.current = null;
    lastSampleRef.current = 0;
    updateSession({ cook: null });
  }, []);

  // Current elapsed minutes since first reading (computed live from ref)
  const elapsedMin = startTimeRef.current != null
    ? (Date.now() - startTimeRef.current) / 60_000
    : 0;

  return { history, elapsedMin, reset };
}
