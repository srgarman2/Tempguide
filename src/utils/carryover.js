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
 * @param {string} [params.categoryId]    - Protein category ('beef','pork','poultry','seafood','baked')
 * @returns {{
 *   deltaF: number,
 *   peakTempF: number,
 *   minutesToPeak: number,
 *   restProfile: Array<{minute: number, tempF: number}>,
 *   fourier: number,
 *   surfaceTempAtPull: number,
 * }}
 */
export function estimateCarryover({
  methodId,
  pullTempF,
  thicknessInches = 1.0,
  restMinutes = 15,
  ambientTempF = 72,
  categoryId = 'beef',
}) {
  // Sous vide: bath temp = target — virtually no internal gradient at pull.
  // The sear after the bath adds ~1–2°F which we represent as deltaF:1.
  if (methodId === 'sous-vide') {
    return {
      deltaF: 1,
      peakTempF: pullTempF + 1,
      minutesToPeak: 1,
      restProfile: generateCoolingProfile(pullTempF + 1, restMinutes, ambientTempF),
      fourier: 0,
      surfaceTempAtPull: pullTempF + 3,
    };
  }

  // Half-thickness in meters
  const L = (thicknessInches * 0.0254) / 2;

  // Time to peak carryover (empirically ~35–50% of the "Fourier time constant")
  // Large cuts take longer to peak; thin cuts peak quickly
  const timeConstantSec = (L * L) / ALPHA; // ~seconds for meaningful heat redistribution
  const minutesToPeak = Math.max(3, Math.min(30, (timeConstantSec / 60) * 0.45));

  // Fourier number at rest duration (minimum 4 min to model plating carryover)
  const t = Math.max(restMinutes, 4) * 60;
  const Fo = (ALPHA * t) / (L * L);

  // Surface-to-center gradient at pull
  const surfaceTempAtPull = estimateSurfaceTempAtPull(methodId, pullTempF);
  const surfaceGradient = surfaceTempAtPull - pullTempF;

  // Fraction of gradient that reaches center (heat equation analytical solution for slab)
  const fractionReached = 1 - Math.exp(-Math.PI * Math.PI * Fo / 4);

  // Penetration factor — accounts for surface cooling, 3D geometry, evaporative losses.
  //
  // Seafood gets a higher factor (0.80) because:
  //  - Thin fillets (0.5–1.0") have short heat-conduction paths
  //  - High water content (~75%) improves thermal conductivity vs. mammalian muscle
  //  - Empirical data: 0.75" fish fillet at pan-sear spikes 15–19°F at the center
  //    (vs ~7–9°F for a 1" beef steak) — the full surface gradient transfers rapidly
  //  - Practical consequence: pull seafood aggressively early at high heat
  //
  // Mammalian / avian muscle: 0.28 (calibrated to Thermoworks 5–7°F for steaks)
  const penetrationFactor = categoryId === 'seafood' ? 0.80 : 0.28;

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
  });

  return {
    deltaF: Math.round(deltaF * 10) / 10,
    peakTempF: Math.round(peakTempF * 10) / 10,
    minutesToPeak: Math.round(minutesToPeak),
    restProfile,
    fourier: Math.round(Fo * 100) / 100,
    surfaceTempAtPull: Math.round(surfaceTempAtPull),
  };
}

/**
 * Generate the temperature profile over rest:
 * Phase 1: Rise (carryover) — heat flows inward
 * Phase 2: Decline (cooling) — Newton's law of cooling
 */
function generateCarryoverProfile({ pullTempF, peakTempF, minutesToPeak, restMinutes, ambientTempF }) {
  const profile = [];
  // Cooling constant k ≈ 0.008–0.015 /min for typical roasts in still air
  const k = 0.010;

  for (let minute = 0; minute <= Math.max(restMinutes, 60); minute++) {
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

/** Simple cooling profile (no carryover rise) */
function generateCoolingProfile(startTempF, restMinutes, ambientTempF) {
  const k = 0.010;
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
