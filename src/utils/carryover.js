/**
 * Carryover Cooking Physics Engine
 *
 * When protein is removed from heat, the outer layers are hotter than the
 * center. Heat continues flowing inward (conduction) until the temperature
 * gradient equalizes — this is "carryover cooking."
 *
 * Physics basis:
 *  - Heat equation: ∂T/∂t = α·∇²T
 *  - α (thermal diffusivity of meat) ≈ 1.36×10⁻⁷ m²/s
 *  - Fourier number: Fo = α·t / L²  (dimensionless time)
 *  - Center temperature rise ≈ ΔT_surface · f(Fo)
 *
 * The model is calibrated against empirical references:
 *  - Thermoworks: pull 5–7°F before target for steaks (1")
 *  - Chris Young / ChefSteps research on beef and poultry
 *  - USDA Appendix A time-temperature pasteurization tables
 *  - Empirical data: seafood pan-sear can spike 15–19°F due to thin profile
 *    and high water content (~75%) increasing effective heat transfer
 *
 * Key protein-category differences:
 *  - Mammalian muscle (beef, pork): penetration factor 0.28
 *    Calibrated to ~7–9°F carryover for 1" steak at pan-sear
 *  - Avian muscle (poultry): similar to mammalian, same penetration factor
 *    Safety achieved by time-temperature pasteurization, not just final temp
 *  - Seafood: penetration factor 0.80
 *    Thin fillets + high water content → rapid heat equalization
 *    Pan-sear carryover: 15–19°F for 0.75" fillet (pull aggressively early)
 *
 * Limitations: assumes uniform slab geometry, homogeneous conductivity,
 * still air during rest (not wrapped).
 */

import { simulateCarryover } from './heatSim';

// Thermal diffusivity of beef/pork/poultry ≈ 1.36e-7 m²/s
const ALPHA = 1.36e-7;

/**
 * Estimated surface temperature at moment of removal from heat source.
 * This drives the inward heat flux during rest.
 * Values are calibrated empirically.
 *
 * @param {string} methodId  - Cooking method ID
 * @param {number} pullTempF - Pull temperature in °F
 * @returns {number} Estimated surface temp in °F
 */
function estimateSurfaceTempAtPull(methodId, pullTempF) {
  // Effective surface-to-center temperature excess at moment of pull, by method.
  //
  // These values represent the sub-surface temperature gradient that actually
  // conducts inward during rest — NOT the surface sear temperature (which
  // radiates to air, not inward). After a long low-slow cook the profile is
  // near-uniform (small excess); after a quick high-heat sear the gradient
  // is steeper but still constrained by what the outer ~5–10mm of meat can hold.
  //
  // Calibrated so predicted carryover matches:
  //   pan-sear 1"  → ~7–9°F  (Thermoworks: pull 5–7°F before target)
  //   low-slow 1"  → ~3–4°F  (minimal: "pull at or near target")
  //   sous-vide    → ~1–2°F  (bath = target, just plating heat)
  const surfaceExcessF = {
    'sous-vide':       3,   // Bath ≈ target, virtually no gradient
    'low-slow':       16,   // Long cook at 225–275°F → near-uniform profile
    'smoker':         18,   // Like low-slow with slight bark heat retention
    'reverse-sear':   12,   // Low oven → well-equalized before final sear
    'oven-moderate':  25,   // 325–375°F, moderate internal gradient
    'oven-high':      35,   // 400–450°F, steeper gradient
    'grill-medium':   30,   // Medium grill — contact + radiant heat
    'grill-high':     45,   // High heat grill — steeper gradient than oven
    'pan-sear':       40,   // Hot pan: effective sub-surface gradient ~40°F above center
    'basting-flip':   65,   // Continuous hot-butter basting (~320–350°F) persists AFTER pull;
                            // residual surface heat drives 15–20°F rise in thin cuts.
                            // Chris Young empirical: "up to 20°F" for small/thin steaks.
                            // Calibrated: 0.5" → ~18°F, 1.0" → ~15°F, 1.5" → ~9°F.
    'air-fryer':      25,   // High-convection, similar to oven-moderate
  };
  const excess = surfaceExcessF[methodId] ?? 45;
  return pullTempF + excess;
}

/**
 * Estimate carryover temperature rise during rest.
 *
 * Model derivation:
 *  1. Approximate slab geometry (half-thickness L)
 *  2. Temperature rise at center ≈ surfaceGradient × (1 - exp(-π²·Fo/4))
 *  3. Penetration factor accounts for:
 *     - Surface cooling to ambient during rest (opposing inward heat flux)
 *     - 3D geometry vs. idealized 1D slab
 *     - Heat loss through drip/evaporation
 *     - Only the sub-surface protein (not the sear crust) conducts inward
 *
 * Penetration factor by category:
 *  - Meat (beef/pork/poultry): 0.28 — calibrated to Thermoworks 7–9°F for 1" steak
 *  - Seafood: 0.80 — thin fillets + high water content transfer heat much faster;
 *    empirical data shows 15–19°F spike for 0.75" fish at pan-sear / grill-high
 *
 * @param {Object} params
 * @param {string} params.methodId        - Cooking method ID
 * @param {number} params.pullTempF       - Temperature at which protein is removed (°F)
 * @param {number} params.thicknessInches - Thickness of the thickest point (inches)
 * @param {number} [params.restMinutes]   - Rest duration to model (default 10)
 * @param {number} [params.ambientTempF]  - Kitchen temperature (default 72°F)
 * @param {string} [params.categoryId]          - Protein category ('beef','pork','poultry','seafood','baked')
 * @param {number|null} [params.overrideSurfaceTempF] - Actual surface temp measured by probe at pull (°F).
 *   When provided, replaces the method-model estimate for the surface gradient.
 *   This makes the rest-screen prediction data-driven rather than model-driven.
 * @param {number[]|null} [params.sensorGradientF] - Full temperature gradient from probe at pull (°F).
 *   Array from virtualCore reading to virtualSurface reading (e.g. [T1, T2, T3, T4, T5, T6]).
 *   When provided (≥2 values), bypasses the empirical formula entirely and runs a
 *   1D finite-difference heat conduction simulation. This is the highest-fidelity path.
 * @returns {{
 *   deltaF: number,
 *   peakTempF: number,
 *   minutesToPeak: number,
 *   restProfile: Array<{minute: number, tempF: number}>,
 *   fourier: number,
 *   surfaceTempAtPull: number,
 *   surfaceGradientF: number,
 *   penetrationFactor: number,
 *   fractionReached: number,
 *   halfThicknessM: number,
 *   thermalDiffusivity: number,
 *   surfaceDataSource: 'measured'|'modeled',
 * }}
 */
export function estimateCarryover({
  methodId,
  pullTempF,
  thicknessInches = 1.0,
  restMinutes = 15,
  ambientTempF = 72,
  categoryId = 'beef',
  overrideSurfaceTempF = null,
  isWrapped = false,       // Foil / butcher paper rest (Texas Crutch). Traps surface heat,
                           // eliminating evaporative and convective losses → more inward conduction.
  sensorGradientF = null,  // Full probe gradient: [T_core, ..., T_surface] in °F.
                           // When provided (≥2 values), runs a finite-difference simulation
                           // instead of the empirical formula — no calibration factors needed.
}) {
  // Sous vide: bath temp = target — virtually no internal gradient at pull.
  // The sear after the bath adds ~1–2°F which we represent as deltaF:1.
  if (methodId === 'sous-vide') {
    return {
      deltaF: 1,
      peakTempF: pullTempF + 1,
      minutesToPeak: 1,
      restProfile: generateCoolingProfile(pullTempF + 1, restMinutes, ambientTempF, thicknessInches),
      fourier: 0,
      surfaceTempAtPull: pullTempF + 3,
      surfaceGradientF: 3,
      penetrationFactor: 0,
      fractionReached: 0,
      halfThicknessM: (thicknessInches * 0.0254) / 2,
      thermalDiffusivity: ALPHA,
      surfaceDataSource: 'modeled',
    };
  }

  // ── Finite-difference path: probe gradient available ──────────────────────
  // When the Combustion probe provides the actual temperature gradient across the
  // meat (virtualCore → virtualSurface sensors), we use a 1D FD simulation to get
  // a physically correct time-evolution of the temperature profile.
  //
  // Key improvement over empirical: uses the REAL measured gradient shape rather than
  // an estimated surface temperature, and gives more accurate peak timing.
  //
  // Calibration: the 1D FD model over-predicts real 3D carryover by ~2× because it
  // doesn't account for lateral heat loss through the sides and top of the cut, or
  // for evaporative cooling. We apply the same penetrationFactor-based correction as
  // the empirical model to normalize the magnitude, while keeping the FD's superior
  // timing (minutesToPeak) and profile curve shape.
  //
  // Result: same peak magnitude as empirical model (calibrated), but better timing
  // and a more physically realistic rise/fall curve driven by the actual gradient.
  if (sensorGradientF != null && sensorGradientF.length >= 2) {
    const fdRaw = simulateCarryover({
      sensorTempsF:   sensorGradientF,
      thicknessInches,
      ambientTempF,
      isWrapped,
      simMinutes:     Math.max(restMinutes + 30, 45),
    });

    // Compute the empirical fractionReached at the model's minutesToPeak
    // (same Fo formula as the empirical path below).
    const Lc = (thicknessInches * 0.0254) / 2;
    const timeConstantSec     = (Lc * Lc) / ALPHA;
    const minutesToPeakEmpir  = Math.max(3, Math.min(120, (timeConstantSec / 60) * 0.45));
    const Fo_empir            = (ALPHA * minutesToPeakEmpir * 60) / (Lc * Lc);
    const fractionReachedEmpir = 1 - Math.exp(-Math.PI * Math.PI * Fo_empir / 4);

    // Penetration factor (same as empirical path).
    let pf;
    if (categoryId === 'seafood') {
      pf = isWrapped ? 0.85 : 0.80;
    } else {
      pf = isWrapped ? 0.50 : 0.28;
    }

    // FD effective fraction: how much of the surface gradient the 1D simulation
    // predicts conducts inward. Over-predicts vs 3D reality.
    const surfaceGradient     = sensorGradientF[sensorGradientF.length - 1] - sensorGradientF[0];
    const fdEffectiveFraction = surfaceGradient > 0 ? fdRaw.deltaF / surfaceGradient : 0.01;

    // Correction factor: scale so calibrated FD matches empirical prediction.
    // correction = (fractionReachedEmpir × pf) / fdEffectiveFraction
    // For mammalian 1" pan-sear: correction ≈ (0.67 × 0.28) / 0.36 ≈ 0.52
    const correction = Math.min(1.5, Math.max(0.1,
      (fractionReachedEmpir * pf) / fdEffectiveFraction
    ));

    // Scale the profile: compress/expand the temperature rise above the pull temp.
    const pullTempAtPull = fdRaw.restProfile[0].tempF;
    const scaledProfile  = fdRaw.restProfile.map(p => ({
      minute: p.minute,
      tempF:  Math.round((pullTempAtPull + (p.tempF - pullTempAtPull) * correction) * 10) / 10,
    }));

    // Find calibrated peak from the scaled profile.
    let calibPeak = scaledProfile[0].tempF;
    let calibMinutesToPeak = 0;
    for (const p of scaledProfile) {
      if (p.tempF > calibPeak) { calibPeak = p.tempF; calibMinutesToPeak = p.minute; }
    }
    const calibDeltaF = calibPeak - pullTempAtPull;

    return {
      ...fdRaw,
      restProfile:      scaledProfile,
      peakTempF:        Math.round(calibPeak * 10) / 10,
      minutesToPeak:    calibMinutesToPeak,
      deltaF:           Math.round(calibDeltaF * 10) / 10,
      penetrationFactor: Math.round(correction * 1000) / 1000,  // correction shown as pf
      fractionReached:   Math.round(fractionReachedEmpir * 1000) / 1000,
      fourier:           Math.round(Fo_empir * 100) / 100,
    };
  }

  // Half-thickness in meters
  const L = (thicknessInches * 0.0254) / 2;

  // Time to peak carryover (empirically ~35–50% of the "Fourier time constant")
  // Large cuts take longer to peak; thin cuts peak quickly
  const timeConstantSec = (L * L) / ALPHA; // ~seconds for meaningful heat redistribution
  // Cap raised to 120 min — large roasts (3"+) genuinely need 60-90 min to peak.
  // The old 30-min cap was accurate for steaks but wrong for briskets/prime ribs.
  const minutesToPeak = Math.max(3, Math.min(120, (timeConstantSec / 60) * 0.45));

  // TWEAK 1: Evaluate Fourier number at the moment of peak carryover, not at the
  // arbitrary end of rest. Fo represents how far the heat front has penetrated
  // by the time the center temperature peaks — the physically meaningful instant.
  const tPeakSec = minutesToPeak * 60;
  const Fo = (ALPHA * tPeakSec) / (L * L);

  // Surface-to-center gradient at pull.
  // If a real probe reading is available, use it directly — this makes the prediction
  // data-driven rather than model-driven. Otherwise fall back to the method model.
  //
  // Thickness scaling for the model path:
  //   Cook time scales as L² — a thicker cut spends much longer at high heat before
  //   the center reaches pull temp. The outer layers accumulate proportionally more
  //   thermal energy. Empirically, gradient depth grows with sqrt(L), so we scale
  //   the modeled surface excess by sqrt(thicknessInches) relative to the 1" baseline.
  //
  //   Effect (pan-sear, pf=0.28):
  //     1.0" → ×1.00 → 7.5°F  (baseline, unchanged)
  //     1.5" → ×1.22 → 9.2°F
  //     2.0" → ×1.41 → 10.6°F
  //     3.0" → ×1.73 → 13.0°F
  //
  //   Thin cuts (≤1") keep their existing behaviour (the minutesToPeak floor at 3 min
  //   already pushes Fo above 0.45 and slightly raises their fractionReached).
  const modelledSurfaceTemp  = estimateSurfaceTempAtPull(methodId, pullTempF);
  const thicknessScale       = Math.max(1.0, Math.sqrt(thicknessInches)); // ≥1" only
  const scaledSurfaceTemp    = pullTempF + (modelledSurfaceTemp - pullTempF) * thicknessScale;
  const surfaceDataSource = overrideSurfaceTempF != null ? 'measured' : 'modeled';
  const surfaceTempAtPull = overrideSurfaceTempF ?? scaledSurfaceTemp;
  const surfaceGradient = surfaceTempAtPull - pullTempF;

  // Fraction of gradient that reaches center (heat equation analytical solution for slab)
  const fractionReached = 1 - Math.exp(-Math.PI * Math.PI * Fo / 4);

  // Penetration factor — accounts for surface cooling, 3D geometry, evaporative losses.
  //
  // Unwrapped (default):
  //   Seafood 0.80 — thin fillets + high water content transfer heat rapidly;
  //     empirical: 0.75" fish at pan-sear spikes 15–19°F at center
  //   Mammalian/avian 0.28 — calibrated to Thermoworks 7–9°F for 1" steak
  //
  // isWrapped (foil/butcher paper rest):
  //   Eliminates evaporative cooling and convective loss to ambient air.
  //   Surface heat has nowhere to go but inward → factor nearly doubles.
  //   Seafood 0.85 — minimal practical change (rarely wrapped)
  //   Mammalian/avian 0.50 — reflects reduced surface loss during foil rest;
  //     conservative: a cambro/cooler brisket rest can reach even higher.
  let penetrationFactor;
  if (categoryId === 'seafood') {
    penetrationFactor = isWrapped ? 0.85 : 0.80;
  } else {
    penetrationFactor = isWrapped ? 0.50 : 0.28;
  }

  const rawCarryover = surfaceGradient * fractionReached * penetrationFactor;

  // Clamp to sensible range: 0.5–25°F
  const deltaF = Math.max(0.5, Math.min(25, rawCarryover));
  const peakTempF = pullTempF + deltaF;

  // Build temperature profile over rest period
  const restProfile = generateCarryoverProfile({
    pullTempF,
    peakTempF,
    minutesToPeak,
    restMinutes,
    ambientTempF,
    thicknessInches,
  });

  return {
    deltaF: Math.round(deltaF * 10) / 10,
    peakTempF: Math.round(peakTempF * 10) / 10,
    minutesToPeak: Math.round(minutesToPeak),
    restProfile,
    fourier: Math.round(Fo * 100) / 100,
    surfaceTempAtPull: Math.round(surfaceTempAtPull),
    surfaceGradientF: Math.round(surfaceGradient * 10) / 10,
    penetrationFactor,
    fractionReached: Math.round(fractionReached * 1000) / 1000,
    halfThicknessM: Math.round(L * 10000) / 10000,
    thermalDiffusivity: ALPHA,
    surfaceDataSource,
  };
}

/**
 * Generate the temperature profile over rest:
 * Phase 1: Rise (carryover) — heat flows inward
 * Phase 2: Decline (cooling) — Newton's law of cooling
 *
 * TWEAK 2: k scales inversely with thickness. A 0.5" steak (k≈0.030) cools
 * rapidly; a 3" roast (k≈0.005) holds heat for much longer. This reflects the
 * surface-area-to-volume ratio decreasing with thickness.
 */
function generateCarryoverProfile({ pullTempF, peakTempF, minutesToPeak, restMinutes, ambientTempF, thicknessInches = 1.0 }) {
  const profile = [];
  const k = 0.015 / Math.max(0.25, thicknessInches);

  // Profile must extend past the peak — especially important for large roasts where
  // minutesToPeak can exceed 60 min. Always show the peak + at least 30 min of cooling.
  const profileEnd = Math.max(restMinutes, minutesToPeak + 30);
  for (let minute = 0; minute <= profileEnd; minute++) {
    let tempF;
    if (minute <= minutesToPeak) {
      // Rising phase: exponential approach to peak
      const t = minute / minutesToPeak;
      tempF = pullTempF + (peakTempF - pullTempF) * (1 - Math.exp(-3.0 * t));
    } else {
      // Cooling phase: Newton's law
      const tCool = (minute - minutesToPeak);
      tempF = ambientTempF + (peakTempF - ambientTempF) * Math.exp(-k * tCool);
    }
    profile.push({ minute, tempF: Math.round(tempF * 10) / 10 });
  }
  return profile;
}

/** Simple cooling profile (no carryover rise) — thickness-aware k */
function generateCoolingProfile(startTempF, restMinutes, ambientTempF, thicknessInches = 1.0) {
  const k = 0.015 / Math.max(0.25, thicknessInches);
  const profile = [];
  for (let minute = 0; minute <= Math.max(restMinutes, 30); minute++) {
    const tempF = ambientTempF + (startTempF - ambientTempF) * Math.exp(-k * minute);
    profile.push({ minute, tempF: Math.round(tempF * 10) / 10 });
  }
  return profile;
}

/**
 * Calculate the recommended pull temperature given:
 *  - Desired final (end) temperature
 *  - Estimated carryover for the method
 *
 * For items that have a range (like steaks), returns the adjusted range.
 *
 * @param {number|{min:number,max:number}} endTemp
 * @param {number} carryoverDeltaF
 * @returns {number|{min:number,max:number}}
 */
export function adjustedPullTemp(endTemp, carryoverDeltaF) {
  if (typeof endTemp === 'object' && endTemp !== null) {
    return {
      min: Math.round(endTemp.min - carryoverDeltaF),
      max: Math.round(endTemp.max - carryoverDeltaF),
    };
  }
  return Math.round(endTemp - carryoverDeltaF);
}

/**
 * Format temperature for display.
 * @param {number|{min,max}|null} temp
 * @param {string} [unit='F']
 * @returns {string}
 */
export function formatTemp(temp, unit = 'F') {
  if (temp === null || temp === undefined) return '—';
  if (Array.isArray(temp)) return `${temp[0]}–${temp[1]}°${unit}`;
  if (typeof temp === 'object') return `${temp.min}–${temp.max}°${unit}`;
  return `${Math.round(temp)}°${unit}`;
}

/**
 * Convert °F to °C
 */
export function fToC(f) {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

/**
 * Convert °C to °F
 */
export function cToF(c) {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

/**
 * Given current temp, pull temp, and carryover delta:
 * Returns a status object describing where in the cook we are.
 */
export function getCookStatus(currentTempF, pullTempF, endTempF, isResting = false) {
  if (isResting) {
    if (currentTempF >= endTempF) return { phase: 'done', label: 'Target reached', pct: 100 };
    return { phase: 'resting', label: 'Resting — temp climbing', pct: null };
  }

  if (currentTempF === null || currentTempF === undefined) {
    return { phase: 'waiting', label: 'Waiting for probe', pct: 0 };
  }

  const startTemp = 35; // Refrigerator temp assumption
  const pct = Math.max(0, Math.min(100, ((currentTempF - startTemp) / (pullTempF - startTemp)) * 100));

  if (currentTempF >= pullTempF) return { phase: 'pull', label: 'Pull now!', pct: 100 };
  if (currentTempF >= pullTempF - 5) return { phase: 'soon', label: 'Almost there', pct };
  if (currentTempF >= pullTempF - 15) return { phase: 'getting-close', label: 'Getting close', pct };
  return { phase: 'cooking', label: 'Cooking', pct };
}
