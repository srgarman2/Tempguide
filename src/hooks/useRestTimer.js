import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { estimateCarryover } from '../utils/carryover';

/**
 * Manages the rest timer and live carryover temperature tracking.
 *
 * ## Data assimilation
 *
 * When the Combustion probe is connected during rest, the hook periodically
 * re-runs the FD simulation using the probe's LIVE sensor gradient as the new
 * initial condition.  This produces a self-correcting prediction that adapts
 * in real time — if someone wraps in foil, moves the meat to a cold counter,
 * or the initial prediction was off, the curve adjusts automatically.
 *
 * The assimilation loop runs every ASSIMILATION_INTERVAL_SEC seconds.
 * Between assimilations, `estimatedCurrentTempF` returns the live probe core
 * reading (ground truth) instead of interpolating the predicted curve.
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
 * @param {number|null}  [params.liveCoreTemp]         - Live core temp from probe during rest (°F)
 * @param {number[]|null} [params.liveSensors]         - Live sensor array from probe during rest
 * @param {number|null}  [params.liveVirtualCoreIndex]    - Live virtual core sensor index
 * @param {number|null}  [params.liveVirtualSurfaceIndex] - Live virtual surface sensor index
 * @param {number|null}  [params.liveAmbientTempF]     - Live ambient temp from probe during rest
 * @param {boolean}      [params.isProbeConnected]     - Whether probe is connected with gradient data
 * @param {Function}     [params.onComplete]           - Called when timer finishes
 */

const ASSIMILATION_INTERVAL_SEC = 30;
const HISTORY_SAMPLE_SEC        = 10;

export default function useRestTimer({
  methodId,
  pullTempF,
  endTempF,
  restMinutes = 10,
  thicknessInches = 1.0,
  categoryId = 'beef',
  geometry = 'slab',
  isWrapped = false,
  boneIn = false,
  actualCoreTempF = null,
  actualSurfaceTempF = null,
  ambientTempF = 72,
  sensorGradientF = null,
  // ── Live probe data for assimilation ──────────────────────────────
  liveCoreTemp = null,
  liveSensors = null,
  liveVirtualCoreIndex = null,
  liveVirtualSurfaceIndex = null,
  liveAmbientTempF = null,
  isProbeConnected = false,
  onComplete,
}) {
  const [isRunning, setIsRunning]     = useState(false);
  const [elapsedSec, setElapsedSec]   = useState(0);
  const [isComplete, setIsComplete]   = useState(false);

  // ── Assimilation state ──────────────────────────────────────────────
  const [assimilatedCarryover, setAssimilatedCarryover] = useState(null);
  const [assimilationCount, setAssimilationCount]       = useState(0);
  const [liveHistory, setLiveHistory]                   = useState([]);   // [{minute, tempF}]

  const intervalRef    = useRef(null);
  const onCompleteRef  = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Refs for values that change at 10 Hz — avoids re-renders per BLE notification
  const liveSensorsRef    = useRef(liveSensors);
  const liveCoreTempRef   = useRef(liveCoreTemp);
  const liveAmbientRef    = useRef(liveAmbientTempF);
  const elapsedSecRef     = useRef(elapsedSec);
  liveSensorsRef.current  = liveSensors;
  liveCoreTempRef.current = liveCoreTemp;
  liveAmbientRef.current  = liveAmbientTempF;
  elapsedSecRef.current   = elapsedSec;

  // ── Initial carryover (computed once at mount, same as before) ──────
  const initialCarryover = useMemo(() => {
    if (methodId === 'sous-vide') {
      return estimateCarryover({ methodId, pullTempF, thicknessInches, restMinutes, categoryId, ambientTempF, geometry, isWrapped, boneIn });
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
        geometry,
        isWrapped,
        boneIn,
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
        geometry,
        isWrapped,
        boneIn,
      });
    }

    // Path B: model-driven — calibrate profile to peak at endTempF
    const { deltaF } = estimateCarryover({ methodId, pullTempF, thicknessInches, restMinutes, categoryId, ambientTempF, geometry, isWrapped, boneIn });
    const adjustedPull = endTempF != null ? Math.round(endTempF - deltaF) : pullTempF;
    return estimateCarryover({ methodId, pullTempF: adjustedPull, thicknessInches, restMinutes, categoryId, ambientTempF, geometry, isWrapped, boneIn });
  }, [methodId, pullTempF, endTempF, thicknessInches, categoryId, geometry, isWrapped, boneIn,
      actualCoreTempF, actualSurfaceTempF, ambientTempF, sensorGradientF, restMinutes]);

  // The effective pull temp shown in UI:
  // - Real data: actual core reading from probe
  // - Model: adjusted pull derived from endTempF − deltaF
  const adjustedPullTempF = actualCoreTempF
    ?? (endTempF != null && methodId !== 'sous-vide'
      ? Math.round(endTempF - initialCarryover.deltaF)
      : pullTempF);

  const totalSec = restMinutes * 60;

  // ── Timer controls ──────────────────────────────────────────────────
  const start = useCallback(() => {
    setIsRunning(true);
    setElapsedSec(0);
    setIsComplete(false);
    setAssimilatedCarryover(null);
    setAssimilationCount(0);
    setLiveHistory([]);
  }, []);

  const pause  = useCallback(() => setIsRunning(false), []);
  const resume = useCallback(() => setIsRunning(true), []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setElapsedSec(0);
    setIsComplete(false);
    setAssimilatedCarryover(null);
    setAssimilationCount(0);
    setLiveHistory([]);
  }, []);

  // ── Main timer tick (1 Hz) ──────────────────────────────────────────
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

  // ── Live history recording (every HISTORY_SAMPLE_SEC) ───────────────
  // Records actual probe core readings into liveHistory for the chart.
  useEffect(() => {
    if (!isRunning || !isProbeConnected) return;

    const record = () => {
      const temp = liveCoreTempRef.current;
      if (temp == null) return;
      const minute = Math.round((elapsedSecRef.current / 60) * 100) / 100;
      setLiveHistory(prev => {
        // Avoid duplicate minutes — replace if same minute bucket
        if (prev.length > 0 && Math.abs(prev[prev.length - 1].minute - minute) < 0.1) {
          return [...prev.slice(0, -1), { minute, tempF: Math.round(temp * 10) / 10 }];
        }
        return [...prev, { minute, tempF: Math.round(temp * 10) / 10 }];
      });
    };

    // Record immediately on start
    record();
    const id = setInterval(record, HISTORY_SAMPLE_SEC * 1000);
    return () => clearInterval(id);
  }, [isRunning, isProbeConnected]);

  // ── Assimilation loop (every ASSIMILATION_INTERVAL_SEC) ─────────────
  // Re-runs the FD simulation with the probe's current live gradient as a
  // new initial condition. Produces an updated forward prediction that is
  // merged with liveHistory to form the final rest profile.
  useEffect(() => {
    if (!isRunning || !isProbeConnected) return;

    const assimilate = () => {
      const sensors = liveSensorsRef.current;
      if (!sensors || sensors.length < 2) return;
      if (liveVirtualCoreIndex == null || liveVirtualSurfaceIndex == null) return;

      const gradient = sensors.slice(liveVirtualCoreIndex, liveVirtualSurfaceIndex + 1);
      if (gradient.length < 2) return;

      const currentCore    = liveCoreTempRef.current ?? gradient[0];
      const currentAmbient = liveAmbientRef.current ?? ambientTempF;
      const elapsedMinNow  = elapsedSecRef.current / 60;

      // How many minutes to simulate forward: enough to capture the remaining peak + 30 min tail
      const forwardMinutes = Math.max(15, restMinutes - elapsedMinNow + 30);

      const forwardCarryover = estimateCarryover({
        methodId,
        pullTempF: currentCore,
        thicknessInches,
        restMinutes: forwardMinutes,
        categoryId,
        ambientTempF: currentAmbient,
        sensorGradientF: gradient,
        geometry,
        isWrapped,
        boneIn,
      });

      // Offset the forward profile's minutes to absolute time (from pull)
      const offsetProfile = forwardCarryover.restProfile.map(p => ({
        minute: Math.round((p.minute + elapsedMinNow) * 100) / 100,
        tempF:  p.tempF,
      }));

      // Store the assimilated result with the offset profile and absolute peak time
      setAssimilatedCarryover({
        ...forwardCarryover,
        restProfile:   offsetProfile,
        minutesToPeak: Math.round(forwardCarryover.minutesToPeak + elapsedMinNow),
        // deltaF from original pull (not from current core)
        deltaF:        Math.round((currentCore + forwardCarryover.deltaF - adjustedPullTempF) * 10) / 10,
        peakTempF:     Math.round((currentCore + forwardCarryover.deltaF) * 10) / 10,
        _elapsedAtAssimilation: elapsedMinNow,
        _forwardDeltaF:         forwardCarryover.deltaF,
      });
      setAssimilationCount(c => c + 1);
    };

    // Run first assimilation after a short delay (let probe stabilize after screen nav)
    const initialDelay = setTimeout(assimilate, 5000);
    const id = setInterval(assimilate, ASSIMILATION_INTERVAL_SEC * 1000);
    return () => { clearTimeout(initialDelay); clearInterval(id); };
  }, [isRunning, isProbeConnected, liveVirtualCoreIndex, liveVirtualSurfaceIndex,
      methodId, thicknessInches, categoryId, geometry, ambientTempF, restMinutes, adjustedPullTempF]);

  // ── Merged carryover object ─────────────────────────────────────────
  // Combines live history (actual past) with the latest assimilated forward
  // prediction (future). Falls back to initialCarryover when no assimilation
  // has happened yet.
  const carryover = useMemo(() => {
    if (!assimilatedCarryover || liveHistory.length === 0) return initialCarryover;

    const spliceMinute = assimilatedCarryover._elapsedAtAssimilation;

    // Actual points: everything from liveHistory up to the splice point
    const actualPoints = liveHistory.filter(p => p.minute <= spliceMinute + 0.1);

    // Future points: assimilated profile from splice point onward
    const futurePoints = assimilatedCarryover.restProfile.filter(p => p.minute > spliceMinute);

    // Merge: actual + future
    const mergedProfile = [...actualPoints, ...futurePoints];

    return {
      ...assimilatedCarryover,
      restProfile: mergedProfile.length >= 2 ? mergedProfile : initialCarryover.restProfile,
    };
  }, [initialCarryover, assimilatedCarryover, liveHistory]);

  const elapsedMin = elapsedSec / 60;
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const progressPct = Math.min(100, (elapsedSec / totalSec) * 100);

  // ── Estimated current temp ──────────────────────────────────────────
  // Prefer live probe reading (ground truth) over profile interpolation.
  const getEstimatedTempNow = () => {
    // Ground truth from probe when available
    if (isProbeConnected && liveCoreTemp != null) {
      return Math.round(liveCoreTemp * 10) / 10;
    }

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

  // Rate of temperature change (°F/min) — use live history if available
  const tempSlopePerMin = (() => {
    // If we have live history with at least 2 points, compute slope from actual data
    if (liveHistory.length >= 2) {
      const recent = liveHistory.slice(-2);
      const dt = recent[1].minute - recent[0].minute;
      if (dt > 0) {
        return Math.round(((recent[1].tempF - recent[0].tempF) / dt) * 10) / 10;
      }
    }

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
    // ── Assimilation extras ──────────────────────────────────────────
    isAssimilating:   assimilationCount > 0,
    assimilationCount,
    initialCarryover,
    liveHistory,
    isLiveTemp:       isProbeConnected && liveCoreTemp != null,
  };
}
