/**
 * Accumulates temperature readings over time during the cook phase.
 * Samples every ~10 seconds to keep data manageable while providing
 * a smooth chart curve (~6 points per minute).
 *
 * Works with both BLE probe data and manual temp entry.
 * surfaceTemp will be null when no multi-sensor probe is connected.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const SAMPLE_INTERVAL_MS = 10_000; // 10 seconds between samples

export default function useCookHistory(coreTemp, surfaceTemp) {
  const [history, setHistory] = useState([]);
  const startTimeRef = useRef(null);
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

  const reset = useCallback(() => {
    setHistory([]);
    startTimeRef.current = null;
    lastSampleRef.current = 0;
  }, []);

  // Current elapsed minutes since first reading (computed live from ref)
  const elapsedMin = startTimeRef.current != null
    ? (Date.now() - startTimeRef.current) / 60_000
    : 0;

  return { history, elapsedMin, reset };
}
