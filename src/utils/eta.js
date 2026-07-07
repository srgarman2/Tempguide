/**
 * eta.js — Estimate time until the core reaches pull temperature.
 *
 * Fits a least-squares line to the recent cook-history window and
 * extrapolates to the pull temp. A windowed fit (rather than first-to-last
 * slope) means the estimate tracks the CURRENT heating rate — it ignores the
 * fast sear at the start of a reverse sear, and it notices a barbecue stall.
 *
 * Deliberately declines to answer (returns null) when the data can't support
 * a trustworthy number: too few points, a flat/negative slope (stall,
 * resting, probe out of the meat), or an absurd extrapolation.
 */

/** Look-back window for the slope fit (minutes). Long enough to smooth
 *  sensor noise at the 10 s sample rate, short enough to track rate changes. */
const WINDOW_MINUTES = 5;

/** Minimum points for a meaningful fit (~30 s of samples). */
const MIN_POINTS = 3;

/** Below this heating rate (°F/min) an ETA would be noise-dominated —
 *  a barbecue stall reads ~0.1°F/min and can last hours. */
const MIN_SLOPE_F_PER_MIN = 0.2;

/**
 * @param {Array<{minute: number, coreTemp: number}>} history - cook curve samples
 * @param {number|null} currentTempF - latest core reading (°F)
 * @param {number|null} pullTempF    - target pull temperature (°F)
 * @returns {{ minutes: number, slopePerMin: number } | null}
 *   minutes: whole minutes to pull (0 = at/past pull temp);
 *   slopePerMin: fitted heating rate (°F/min). Null when unreliable.
 */
export function estimateTimeToPull(history, currentTempF, pullTempF) {
  if (!Array.isArray(history) || currentTempF == null || pullTempF == null) return null;
  if (currentTempF >= pullTempF) return { minutes: 0, slopePerMin: 0 };

  const lastMinute = history.length > 0 ? history[history.length - 1].minute : 0;
  const points = history.filter(
    p => p.coreTemp != null && p.minute >= lastMinute - WINDOW_MINUTES,
  );
  if (points.length < MIN_POINTS) return null;

  // Least-squares slope over the window
  const n = points.length;
  let meanX = 0, meanY = 0;
  for (const p of points) { meanX += p.minute; meanY += p.coreTemp; }
  meanX /= n; meanY /= n;

  let num = 0, den = 0;
  for (const p of points) {
    num += (p.minute - meanX) * (p.coreTemp - meanY);
    den += (p.minute - meanX) ** 2;
  }
  if (den === 0) return null;

  const slope = num / den;
  if (slope < MIN_SLOPE_F_PER_MIN) return null;

  const minutes = (pullTempF - currentTempF) / slope;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) return null;

  return {
    minutes: Math.round(minutes),
    slopePerMin: Math.round(slope * 10) / 10,
  };
}
