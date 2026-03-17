import { useState, useEffect, useRef, useCallback } from 'react';
import { estimateCarryover } from '../utils/carryover';

/**
 * Manages the rest timer and live carryover temperature tracking.
 *
 * @param {Object} params
 * @param {string}  params.methodId        - Cooking method ID
 * @param {number}  params.pullTempF       - Temperature at which protein was pulled
 * @param {number}  params.endTempF        - Target final temperature
 * @param {number}  params.restMinutes     - Recommended rest duration (minutes)
 * @param {number}  [params.thicknessInches] - Thickness for physics model
 * @param {Function} [params.onComplete]   - Called when timer finishes
 */
export default function useRestTimer({
  methodId,
  pullTempF,
  endTempF,
  restMinutes = 10,
  thicknessInches = 1.0,
  onComplete,
}) {
  const [isRunning, setIsRunning]     = useState(false);
  const [elapsedSec, setElapsedSec]   = useState(0);
  const [isComplete, setIsComplete]   = useState(false);

  const intervalRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Compute carryover with adjusted pull temp so peak aligns with endTemp.
  // deltaF is independent of pullTempF (surfaceGradient = excess), so we derive
  // adjusted pull = endTemp − deltaF, then recompute for correct profile.
  const carryover = (() => {
    if (methodId === 'sous-vide') {
      return estimateCarryover({ methodId, pullTempF, thicknessInches, restMinutes });
    }
    const { deltaF } = estimateCarryover({ methodId, pullTempF, thicknessInches, restMinutes });
    const adjustedPull = endTempF != null ? Math.round(endTempF - deltaF) : pullTempF;
    return estimateCarryover({ methodId, pullTempF: adjustedPull, thicknessInches, restMinutes });
  })();

  const adjustedPullTempF = endTempF != null && methodId !== 'sous-vide'
    ? Math.round(endTempF - carryover.deltaF)
    : pullTempF;

  const totalSec = restMinutes * 60;

  const start = useCallback(() => {
    setIsRunning(true);
    setElapsedSec(0);
    setIsComplete(false);
  }, []);

  const pause = useCallback(() => setIsRunning(false), []);
  const resume = useCallback(() => setIsRunning(true), []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setElapsedSec(0);
    setIsComplete(false);
  }, []);

  useEffect(() => {
    if (!isRunning) {
      clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setElapsedSec(prev => {
        const next = prev + 1;
        if (next >= totalSec) {
          setIsRunning(false);
          setIsComplete(true);
          clearInterval(intervalRef.current);
          onCompleteRef.current?.();
          return totalSec;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [isRunning, totalSec]);

  const elapsedMin = elapsedSec / 60;
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const progressPct = Math.min(100, (elapsedSec / totalSec) * 100);

  // Interpolate current estimated temp from the carryover profile
  const getEstimatedTempNow = () => {
    const profile = carryover.restProfile;
    if (!profile || profile.length === 0) return adjustedPullTempF;

    const minuteIndex = Math.floor(elapsedMin);
    const fraction = elapsedMin - minuteIndex;

    const p0 = profile[Math.min(minuteIndex, profile.length - 1)];
    const p1 = profile[Math.min(minuteIndex + 1, profile.length - 1)];

    if (!p0 || !p1) return adjustedPullTempF;
    return Math.round((p0.tempF + (p1.tempF - p0.tempF) * fraction) * 10) / 10;
  };

  const estimatedCurrentTempF = getEstimatedTempNow();
  const hasReachedTarget = estimatedCurrentTempF >= endTempF;

  return {
    isRunning,
    isComplete,
    elapsedSec,
    elapsedMin,
    remainingSec,
    progressPct,
    totalSec,
    carryover,
    adjustedPullTempF,
    estimatedCurrentTempF,
    hasReachedTarget,
    start,
    pause,
    resume,
    reset,
  };
}
