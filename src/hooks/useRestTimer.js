import { useState, useEffect, useRef, useCallback } from 'react';
import { estimateCarryover } from '../utils/carryover';

/**
 * Manages the rest timer and live carryover temperature tracking.
 *
 * @param {Object} params
 * @param {string}       params.methodId            - Cooking method ID
 * @param {number}       params.pullTempF           - Target pull temperature (from model)
 * @param {number}       params.endTempF            - Target final temperature
 * @param {number}       params.restMinutes         - Recommended rest duration (minutes)
 * @param {number}       [params.thicknessInches]   - Thickness for physics model
 * @param {string}       [params.categoryId]        - Protein category for physics model
 * @param {number|null}  [params.actualCoreTempF]   - Actual core temp from probe at moment of pull
 * @param {number|null}  [params.actualSurfaceTempF]  - Actual surface temp from probe at moment of pull
 * @param {number}       [params.ambientTempF]        - Ambient temperature (default 72°F; use probe reading when available)
 * @param {number[]|null} [params.sensorGradientF]    - Full probe gradient [T_core … T_surface] at pull (°F).
 *   When provided, triggers finite-difference simulation — highest fidelity path.
 *   Takes priority over actualCoreTempF / actualSurfaceTempF data-driven path.
 * @param {Function}     [params.onComplete]          - Called when timer finishes
 */
export default function useRestTimer({
  methodId,
  pullTempF,
  endTempF,
  restMinutes = 10,
  thicknessInches = 1.0,
  categoryId = 'beef',
  actualCoreTempF = null,
  actualSurfaceTempF = null,
  ambientTempF = 72,
  sensorGradientF = null,
  onComplete,
}) {
  const [isRunning, setIsRunning]     = useState(false);
  const [elapsedSec, setElapsedSec]   = useState(0);
  const [isComplete, setIsComplete]   = useState(false);

  const intervalRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Compute carryover physics.
  //
  // Three paths (in priority order):
  //  A-FD) Full sensor gradient available (sensorGradientF ≥ 2 readings):
  //        Runs a 1D finite-difference heat conduction simulation using the
  //        actual temperature profile across the meat as the initial condition.
  //        No empirical calibration needed — the probe data IS the physics input.
  //        This is the highest-fidelity path; deltaF and restProfile emerge from
  //        numerically integrating ∂T/∂t = α·∇²T with the real boundary conditions.
  //
  //  A)   Core + surface from probe (actualCoreTempF / actualSurfaceTempF):
  //        Use actual sensor readings — data-driven, no adjustedPull hack needed.
  //        The profile starts at the real core temp; real surface gradient drives deltaF.
  //
  //  B)   No probe data (model-only):
  //        Use the adjustedPull trick so the profile peaks at endTempF.
  //        adjustedPull = endTempF − deltaF ensures pull + carryover = target.
  const carryover = (() => {
    if (methodId === 'sous-vide') {
      return estimateCarryover({ methodId, pullTempF, thicknessInches, restMinutes, categoryId, ambientTempF });
    }

    // Path A-FD: finite-difference simulation from full probe gradient
    if (sensorGradientF != null && sensorGradientF.length >= 2) {
      return estimateCarryover({
        methodId,
        pullTempF: actualCoreTempF ?? sensorGradientF[0],
        thicknessInches,
        restMinutes,
        categoryId,
        ambientTempF,
        sensorGradientF,
      });
    }

    if (actualCoreTempF != null) {
      // Path A: data-driven — actual core at pull, actual surface gradient
      return estimateCarryover({
        methodId,
        pullTempF: actualCoreTempF,
        thicknessInches,
        restMinutes,
        categoryId,
        overrideSurfaceTempF: actualSurfaceTempF,
        ambientTempF,
      });
    }

    // Path B: model-driven — calibrate profile to peak at endTempF
    const { deltaF } = estimateCarryover({ methodId, pullTempF, thicknessInches, restMinutes, categoryId, ambientTempF });
    const adjustedPull = endTempF != null ? Math.round(endTempF - deltaF) : pullTempF;
    return estimateCarryover({ methodId, pullTempF: adjustedPull, thicknessInches, restMinutes, categoryId, ambientTempF });
  })();

  // The effective pull temp shown in UI:
  // - Real data: actual core reading from probe
  // - Model: adjusted pull derived from endTempF − deltaF
  const adjustedPullTempF = actualCoreTempF
    ?? (endTempF != null && methodId !== 'sous-vide'
      ? Math.round(endTempF - carryover.deltaF)
      : pullTempF);

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

  // Scan profile to find when temperature first reaches endTempF
  const timeToTargetMin = (() => {
    const profile = carryover.restProfile;
    if (!profile || profile.length === 0 || endTempF == null) return null;
    for (let i = 0; i < profile.length; i++) {
      if (profile[i].tempF >= endTempF) {
        // Interpolate between i-1 and i for precision
        if (i > 0) {
          const prev = profile[i - 1];
          const curr = profile[i];
          const fraction = (endTempF - prev.tempF) / (curr.tempF - prev.tempF);
          return Math.round((prev.minute + fraction * (curr.minute - prev.minute)) * 10) / 10;
        }
        return profile[i].minute;
      }
    }
    return null; // Never reaches target within the profile window
  })();

  // Estimated remaining time to target from current elapsed position
  const remainingToTargetSec = (() => {
    if (timeToTargetMin == null) return null;
    const targetSec = timeToTargetMin * 60;
    return Math.max(0, Math.round(targetSec - elapsedSec));
  })();

  // Rate of temperature change (°F/min) over last minute of elapsed time
  const tempSlopePerMin = (() => {
    const profile = carryover.restProfile;
    if (!profile || profile.length < 2) return 0;
    const minuteNow = Math.floor(elapsedMin);
    const minutePrev = Math.max(0, minuteNow - 1);
    const p0 = profile[Math.min(minutePrev, profile.length - 1)];
    const p1 = profile[Math.min(minuteNow, profile.length - 1)];
    if (!p0 || !p1 || p0.minute === p1.minute) return 0;
    return Math.round(((p1.tempF - p0.tempF) / (p1.minute - p0.minute)) * 10) / 10;
  })();

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
    timeToTargetMin,
    remainingToTargetSec,
    tempSlopePerMin,
    start,
    pause,
    resume,
    reset,
  };
}
