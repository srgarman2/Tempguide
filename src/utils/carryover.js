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
 *  - Fourier number: Fo = α·t / Lc²  (dimensionless time)
 *  - Biot number: Bi = h·Lc / k  (surface resistance vs internal conduction)
 *  - One-term approximation: θ* = A₁·exp(−λ₁²·Fo)
 *    where λ₁ and A₁ are geometry-dependent functions of Bi
 *
 * The model uses the Heisler one-term approximation (valid for Fo > 0.2)
 * with geometry-specific characteristic lengths:
 *   Slab:     Lc = half-thickness
 *   Cylinder: Lc = radius
 *   Sphere:   Lc = radius
 *
 * The Biot number is computed from dynamic convective heat transfer
 * coefficients (h) that vary with the rest condition (wrapped vs unwrapped).
 *
 * Wet-bulb temperature depression is modeled to account for evaporative
 * cooling at the meat surface during unwrapped rest, preventing systematic
 * over-prediction of carryover.
 *
 * Calibrated against empirical references:
 *  - Thermoworks: pull 5–7°F before target for steaks (1")
 *  - Chris Young / ChefSteps research on beef and poultry
 *  - USDA Appendix A time-temperature pasteurization tables
 *  - Empirical data: seafood pan-sear can spike 15–19°F due to thin profile
 *    and high water content (~75%) increasing effective heat transfer
 *
 * Limitations: assumes homogeneous conductivity.
 */

import { simulateCarryover } from './heatSim';

// ── Thermal properties ────────────────────────────────────────────────────────

/** Thermal diffusivity of beef/pork/poultry muscle ≈ 1.36×10⁻⁷ m²/s */
const ALPHA = 1.36e-7;

/** Thermal diffusivity of raw potato flesh ≈ 1.40×10⁻⁷ m²/s
 *  Slightly higher than muscle due to the starch-water matrix.
 *  Source: Califano & Calvelo (1991), Rahman (2009) */
const ALPHA_POTATO = 1.4e-7;

/** Thermal conductivity of meat — W/(m·K). Used for Biot number calculation. */
const K_MEAT = 0.49;

/** Convective heat transfer coefficient — open air natural convection, W/(m²·K).
 *  Typical for still air over a warm horizontal surface (Incropera & DeWitt). */
const H_OPEN = 10;

/** Convective h for foil-tented rest — steam trap reduces convection, W/(m²·K).
 *  Foil tent creates a stagnant, saturated microclimate. */
const H_FOIL = 3;

// ── Wet-bulb temperature depression ───────────────────────────────────────────

/**
 * Calculates the wet-bulb temperature using Stull's formula.
 *
 * This accounts for the evaporative cooling (latent heat of vaporization)
 * at the meat's surface during the rest phase. The wet-bulb temperature is
 * the equilibrium temperature a surface reaches when evaporative mass flux
 * balances sensible heat gain — making it the correct boundary condition
 * for an unwrapped, moist surface cooling in air.
 *
 * Reference: Stull, R. (2011). "Wet-Bulb Temperature from Relative Humidity
 * and Air Temperature." Journal of Applied Meteorology and Climatology.
 * Valid for RH 5–99%, T −20°C to 50°C. Accuracy ±0.3°C.
 *
 * @param {number} tempF - Dry-bulb ambient temperature in °F
 * @param {number} rh    - Relative humidity percentage (0–100)
 * @returns {number} Wet-bulb temperature in °F
 */
function calculateWetBulbTempF(tempF, rh) {
  const T = (tempF - 32) * 5 / 9;
  const twbC = T * Math.atan(0.151977 * Math.pow(rh + 8.313659, 0.5))
             + Math.atan(T + rh)
             - Math.atan(rh - 1.676331)
             + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
             - 4.686035;
  return (twbC * 9 / 5) + 32;
}

/** Default kitchen relative humidity (%) for unwrapped rest. */
const DEFAULT_KITCHEN_RH = 45;

/**
 * Compute the effective ambient temperature at the meat surface during rest.
 *
 * During unwrapped rest, evaporative cooling depresses the effective boundary
 * condition below dry-bulb ambient. We use Stull's wet-bulb equation to compute
 * this rigorously rather than applying an ad-hoc fixed depression.
 *
 * - Wrapped: RH → 100% inside the foil tent. Stull's equation at RH=100 yields
 *   T_wb ≈ T_dry — no evaporative depression (the vapor is already saturated).
 * - Unwrapped: RH ≈ 45% (typical residential kitchen). At 72°F dry-bulb this
 *   gives T_wb ≈ 60°F — a ~12°F depression that matches psychrometric charts.
 *
 * @param {number} ambientTempF - Dry-bulb ambient temperature (°F)
 * @param {boolean} isWrapped   - Whether the meat is wrapped/tented
 * @returns {number} Effective ambient temperature at the surface boundary (°F)
 */
function effectiveAmbientF(ambientTempF, isWrapped) {
  const rh = isWrapped ? 100 : DEFAULT_KITCHEN_RH;
  return calculateWetBulbTempF(ambientTempF, rh);
}

// ── Biot Number Lookup Tables ─────────────────────────────────────────────────
//
// Standard thermodynamic tables for the one-term approximation of transient
// heat conduction in three canonical geometries. Source: Incropera & DeWitt,
// "Fundamentals of Heat and Mass Transfer", Table 5.1.
//
// For each geometry, given Biot number Bi, we look up:
//   λ₁ — the first root of the characteristic equation
//   A₁ — the amplitude coefficient
//
// The dimensionless center temperature is then:
//   θ* = A₁ · exp(−λ₁² · Fo)
//
// where θ* = (T_center − T_∞) / (T_initial − T_∞)
// and Fo = α·t / Lc² is the Fourier number.

/**
 * Biot lookup table entries: [Bi, λ₁, A₁]
 * Covers Bi from 0.01 to 100 (lumped system to semi-infinite solid).
 */
const BIOT_TABLE_SLAB = [
  // Bi,     λ₁,       A₁
  [0.01,   0.0998,   1.0017],
  [0.02,   0.1410,   1.0033],
  [0.04,   0.1987,   1.0066],
  [0.06,   0.2425,   1.0098],
  [0.08,   0.2791,   1.0130],
  [0.10,   0.3111,   1.0161],
  [0.20,   0.4328,   1.0311],
  [0.30,   0.5218,   1.0450],
  [0.40,   0.5932,   1.0580],
  [0.50,   0.6533,   1.0701],
  [0.60,   0.7051,   1.0814],
  [0.70,   0.7506,   1.0919],
  [0.80,   0.7910,   1.1016],
  [0.90,   0.8274,   1.1107],
  [1.00,   0.8603,   1.1191],
  [2.00,   1.0769,   1.1785],
  [3.00,   1.1925,   1.2102],
  [4.00,   1.2646,   1.2287],
  [5.00,   1.3138,   1.2403],
  [6.00,   1.3496,   1.2479],
  [7.00,   1.3766,   1.2532],
  [8.00,   1.3978,   1.2570],
  [9.00,   1.4149,   1.2598],
  [10.0,   1.4289,   1.2620],
  [20.0,   1.4961,   1.2699],
  [30.0,   1.5202,   1.2717],
  [40.0,   1.5325,   1.2723],
  [50.0,   1.5400,   1.2727],
  [100.0,  1.5552,   1.2731],
];

const BIOT_TABLE_CYLINDER = [
  [0.01,   0.1412,   1.0025],
  [0.02,   0.1995,   1.0050],
  [0.04,   0.2814,   1.0099],
  [0.06,   0.3438,   1.0148],
  [0.08,   0.3960,   1.0197],
  [0.10,   0.4417,   1.0246],
  [0.20,   0.6170,   1.0483],
  [0.30,   0.7465,   1.0712],
  [0.40,   0.8516,   1.0932],
  [0.50,   0.9408,   1.1143],
  [0.60,   1.0184,   1.1346],
  [0.70,   1.0873,   1.1539],
  [0.80,   1.1490,   1.1725],
  [0.90,   1.2048,   1.1902],
  [1.00,   1.2558,   1.2071],
  [2.00,   1.5995,   1.3384],
  [3.00,   1.7887,   1.4191],
  [4.00,   1.9081,   1.4698],
  [5.00,   1.9898,   1.5029],
  [6.00,   2.0490,   1.5253],
  [7.00,   2.0937,   1.5411],
  [8.00,   2.1286,   1.5526],
  [9.00,   2.1566,   1.5611],
  [10.0,   2.1795,   1.5677],
  [20.0,   2.2880,   1.5919],
  [30.0,   2.3261,   1.5973],
  [40.0,   2.3455,   1.5993],
  [50.0,   2.3572,   1.6002],
  [100.0,  2.3809,   1.6015],
];

const BIOT_TABLE_SPHERE = [
  [0.01,   0.1730,   1.0030],
  [0.02,   0.2445,   1.0060],
  [0.04,   0.3450,   1.0120],
  [0.06,   0.4217,   1.0179],
  [0.08,   0.4860,   1.0239],
  [0.10,   0.5423,   1.0298],
  [0.20,   0.7593,   1.0592],
  [0.30,   0.9208,   1.0880],
  [0.40,   1.0528,   1.1164],
  [0.50,   1.1656,   1.1441],
  [0.60,   1.2644,   1.1713],
  [0.70,   1.3525,   1.1978],
  [0.80,   1.4320,   1.2236],
  [0.90,   1.5044,   1.2488],
  [1.00,   1.5708,   1.2732],
  [2.00,   2.0288,   1.4793],
  [3.00,   2.2889,   1.6227],
  [4.00,   2.4556,   1.7202],
  [5.00,   2.5704,   1.7870],
  [6.00,   2.6537,   1.8338],
  [7.00,   2.7165,   1.8674],
  [8.00,   2.7654,   1.8921],
  [9.00,   2.8044,   1.9106],
  [10.0,   2.8363,   1.9249],
  [20.0,   2.9857,   1.9781],
  [30.0,   3.0372,   1.9898],
  [40.0,   3.0632,   1.9942],
  [50.0,   3.0788,   1.9962],
  [100.0,  3.1102,   1.9990],
];

/**
 * Select the Biot lookup table for a given geometry.
 * 'tapered' uses slab table (closest approximation for irregular geometry).
 */
function getBiotTable(geometry) {
  if (geometry === 'cylinder') return BIOT_TABLE_CYLINDER;
  if (geometry === 'sphere')   return BIOT_TABLE_SPHERE;
  return BIOT_TABLE_SLAB; // slab, tapered, or fallback
}

/**
 * Linear interpolation in the Biot lookup table.
 *
 * Given a Biot number, returns the interpolated { lambda1, A1 } for the
 * appropriate geometry. Clamps to table bounds at extremes.
 *
 * @param {number} Bi        - Biot number
 * @param {string} geometry  - 'slab' | 'cylinder' | 'sphere' | 'tapered'
 * @returns {{ lambda1: number, A1: number }}
 */
function biotLookup(Bi, geometry) {
  const table = getBiotTable(geometry);

  // Clamp to table range
  if (Bi <= table[0][0]) return { lambda1: table[0][1], A1: table[0][2] };
  if (Bi >= table[table.length - 1][0]) {
    const last = table[table.length - 1];
    return { lambda1: last[1], A1: last[2] };
  }

  // Find bracketing entries and interpolate
  for (let i = 0; i < table.length - 1; i++) {
    if (Bi >= table[i][0] && Bi <= table[i + 1][0]) {
      const frac = (Bi - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return {
        lambda1: table[i][1] + frac * (table[i + 1][1] - table[i][1]),
        A1:      table[i][2] + frac * (table[i + 1][2] - table[i][2]),
      };
    }
  }
  // Fallback (should not reach here)
  const last = table[table.length - 1];
  return { lambda1: last[1], A1: last[2] };
}

/**
 * Method-specific penetration factor overrides.
 *
 * Most methods use the category-based default (mammalian 0.28, seafood 0.80, etc.)
 * but some methods fundamentally change the surface boundary condition during rest:
 *
 *   basting-flip: Hot butter film (~320–350°F) acts as a thermal reservoir that
 *     persists AFTER the steak is pulled. Unlike pan-sear where the surface cools
 *     to air immediately, basting keeps the surface hot → more heat conducts inward.
 *
 *     decayPerInch: the butter film cools in ~2–3 minutes regardless of meat thickness.
 *     For thin cuts that's enough time for heat to fully penetrate; for thick cuts it's
 *     not. The pf decays exponentially from the baseline starting at 0.5":
 *       pf_effective = pf × exp(-decay × max(0, thicknessInches - 0.5))
 *     Calibrated: 0.5" → ~19°F, 1.0" → ~13°F, 1.5" → ~11°F, 2.0" → ~8°F
 */
const METHOD_PF_OVERRIDE = {
  'basting-flip': { unwrapped: 0.38, wrapped: 0.55, decayPerInch: 0.45 },
  'jeff-special': { unwrapped: 0.50, wrapped: 0.50 },
};

/**
 * Methods where thickness scaling of the surface gradient should be suppressed.
 *
 * Thickness scaling (√thicknessInches) models the deeper gradient that builds in
 * thick cuts during long high-heat cooks. Correct for oven, grill, pan-sear where
 * cook time scales with thickness.
 *
 * Wrong for methods where the surface heat source is thickness-independent:
 *   - basting-flip: butter temp is ~320°F regardless of steak thickness
 *   - boil: water is 212°F regardless of potato size (carryover is 0 anyway)
 *   - sous-vide: bath temp is uniform (already handled by early return)
 */
const SUPPRESS_THICKNESS_SCALE = new Set(['basting-flip', 'boil', 'sous-vide', 'jeff-special']);

/**
 * Geometry definitions with strict characteristic lengths.
 *
 * The characteristic length Lc is the shortest conduction path from the
 * surface boundary condition to the geometric center — the physically
 * meaningful length scale for the Fourier and Biot numbers.
 *
 *   Slab (infinite plane wall): Lc = half-thickness
 *     Heat flows from two parallel faces toward the center plane.
 *
 *   Cylinder (infinite): Lc = radius
 *     Heat flows radially inward from the cylindrical surface.
 *     (Not radius/2 — the full radius is the correct Lc for Fo and Bi
 *     in the one-term approximation with the cylindrical eigenvalues.)
 *
 *   Sphere: Lc = radius
 *     Heat flows radially from all directions toward center.
 *     (Again, full radius with spherical eigenvalues.)
 *
 *   Tapered: uses slab Lc (best approximation for irregular geometry)
 *     with a reduced penetration factor to account for edge losses.
 *
 * @param {string} geometry        - 'slab' | 'tapered' | 'cylinder' | 'sphere'
 * @param {number} thicknessInches - User-entered thickness or diameter
 * @returns {number} Characteristic length Lc in meters
 */
function characteristicLength(geometry, thicknessInches) {
  const thicknessM = thicknessInches * 0.0254;
  switch (geometry) {
    case 'cylinder':
      // User enters diameter for cylindrical cuts (e.g. prime rib "eye diameter").
      // Lc = radius = diameter / 2.
      return thicknessM / 2;
    case 'sphere':
      // User enters diameter. Lc = radius = diameter / 2.
      return thicknessM / 2;
    case 'tapered':
    case 'slab':
    default:
      // User enters total thickness. Lc = half-thickness.
      return thicknessM / 2;
  }
}

export const GEOMETRY_TYPES = {
  slab:     { label: 'Flat',     factor: 1.00 },
  tapered:  { label: 'Tapered',  factor: 0.80 },
  cylinder: { label: 'Cylinder', factor: 1.10 },
};

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
    'boil':            0,   // 212°F water cools surface on removal — no inward gradient
    'sous-vide':       3,   // Bath ≈ target, virtually no gradient
    'low-slow':       16,   // Long cook at 225–275°F → near-uniform profile
    'smoker':         18,   // Like low-slow with slight bark heat retention
    'reverse-sear':   12,   // Low oven → well-equalized before final sear
    'oven-moderate':  25,   // 325–375°F, moderate internal gradient
    'oven-high':      35,   // 400–450°F, steeper gradient
    'grill-medium':   30,   // Medium grill — contact + radiant heat
    'grill-high':     45,   // High heat grill — steeper gradient than oven
    'pan-sear':       40,   // Hot pan: effective sub-surface gradient ~40°F above center
    'jeff-special':   15,   // Volumetric heating + trapped steam caps the surface gradient
    'basting-flip':   65,   // Continuous hot-butter basting (~320–350°F) persists AFTER pull;
                            // residual surface heat drives 15–20°F rise in thin cuts.
                            // Chris Young empirical: "up to 20°F" for small/thin steaks.
                            // pf override (0.38) + no thickness scaling → monotonic decrease:
                            // 0.5" → ~19°F, 1.0" → ~16.5°F, 1.5" → ~10°F, 2.0" → ~7°F.
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
  geometry = 'slab',       // Cut shape: 'slab' | 'tapered' | 'cylinder'. Adjusts penetration
                           // factor via GEOMETRY_TYPES correction (e.g. tri-tip → tapered).
  boneIn = false,          // Bone-in cut. Bone has ~⅓ the thermal conductivity of muscle,
                           // insulating one side → less heat conducts inward from that face.
                           // Reduces effective penetration factor by ~15%.
}) {
  // Category-specific thermal diffusivity
  // Potato has a slightly higher diffusivity than muscle tissue due to its starch-water matrix.
  const alpha = categoryId === 'potato' ? ALPHA_POTATO : ALPHA;

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
      thermalDiffusivity: alpha,
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
    // ── Wet-bulb corrected ambient for FD boundary condition ──────────────
    const fdSurfaceTemp = sensorGradientF[sensorGradientF.length - 1];
    const fdEffectiveAmbient = effectiveAmbientF(ambientTempF, isWrapped, fdSurfaceTemp);

    const fdRaw = simulateCarryover({
      sensorTempsF:   sensorGradientF,
      thicknessInches,
      ambientTempF:   fdEffectiveAmbient,
      isWrapped,
      simMinutes:     Math.max(restMinutes + 30, 45),
      geometry,
    });

    // Compute one-term approximation fractionReached at the model's minutesToPeak
    const Lc = characteristicLength(geometry, thicknessInches);
    const h_fd = isWrapped ? H_FOIL : H_OPEN;
    const Bi_fd = (h_fd * Lc) / K_MEAT;
    const { lambda1: lam1_fd, A1: A1_fd } = biotLookup(Bi_fd, geometry);
    const timeConstantSec     = (Lc * Lc) / alpha;
    const minutesToPeakEmpir  = Math.max(3, Math.min(120, (timeConstantSec / 60) * 0.45));
    const Fo_empir            = (alpha * minutesToPeakEmpir * 60) / (Lc * Lc);
    const thetaStar_fd        = A1_fd * Math.exp(-lam1_fd * lam1_fd * Fo_empir);
    const fractionReachedEmpir = Math.max(0, Math.min(1, 1 - thetaStar_fd));

    // Penetration factor (same cascade as empirical path: method → category → default).
    let pf;
    const fdMethodOverride = METHOD_PF_OVERRIDE[methodId];
    if (fdMethodOverride) {
      pf = isWrapped ? fdMethodOverride.wrapped : fdMethodOverride.unwrapped;
      if (fdMethodOverride.decayPerInch) {
        pf *= Math.exp(-fdMethodOverride.decayPerInch * Math.max(0, thicknessInches - 0.5));
      }
    } else if (categoryId === 'seafood') {
      pf = isWrapped ? 0.85 : 0.80;
    } else if (categoryId === 'potato') {
      pf = isWrapped ? 0.30 : 0.22;
    } else {
      pf = isWrapped ? 0.50 : 0.28;
    }
    // Apply geometry correction
    pf *= (GEOMETRY_TYPES[geometry]?.factor ?? 1.0);
    // Bone-in correction (same as empirical path)
    if (boneIn) pf *= 0.85;

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
      penetrationFactor: Math.round(correction * 1000) / 1000,
      fractionReached:   Math.round(fractionReachedEmpir * 1000) / 1000,
      fourier:           Math.round(Fo_empir * 100) / 100,
      biot:              Math.round(Bi_fd * 1000) / 1000,
      lambda1:           Math.round(lam1_fd * 10000) / 10000,
      A1:                Math.round(A1_fd * 10000) / 10000,
      effectiveAmbientF: Math.round(fdEffectiveAmbient * 10) / 10,
      convectiveH:       h_fd,
    };
  }

  // ── Geometry-specific characteristic length ──────────────────────────────
  const Lc = characteristicLength(geometry, thicknessInches);

  // ── Biot number ─────────────────────────────────────────────────────────
  // Bi = h·Lc / k — ratio of surface convective resistance to internal conduction.
  //   Bi < 0.1: lumped system (uniform temperature, no internal gradient)
  //   Bi ~ 1:   comparable surface and internal resistance
  //   Bi > 10:  surface approaches step change (prescribed temperature BC)
  const h = isWrapped ? H_FOIL : H_OPEN;
  const Bi = (h * Lc) / K_MEAT;

  // ── One-term approximation coefficients ─────────────────────────────────
  // Look up λ₁ and A₁ from the standard Heisler tables based on geometry and Bi.
  const { lambda1, A1 } = biotLookup(Bi, geometry);

  // ── Time to peak carryover ──────────────────────────────────────────────
  // Empirically ~35–50% of the "Fourier time constant" (Lc²/α).
  // Large cuts take longer to peak; thin cuts peak quickly.
  const timeConstantSec = (Lc * Lc) / alpha;
  // Cap at 120 min — large roasts (3"+) genuinely need 60-90 min to peak.
  const minutesToPeak = Math.max(3, Math.min(120, (timeConstantSec / 60) * 0.45));

  // Evaluate Fourier number at the moment of peak carryover — the physically
  // meaningful instant, not the arbitrary end of rest.
  const tPeakSec = minutesToPeak * 60;
  const Fo = (alpha * tPeakSec) / (Lc * Lc);

  // ── Surface-to-center gradient at pull ──────────────────────────────────
  const modelledSurfaceTemp  = estimateSurfaceTempAtPull(methodId, pullTempF);
  const thicknessScale       = SUPPRESS_THICKNESS_SCALE.has(methodId)
    ? 1.0
    : Math.max(1.0, Math.sqrt(thicknessInches));
  const scaledSurfaceTemp    = pullTempF + (modelledSurfaceTemp - pullTempF) * thicknessScale;
  const surfaceDataSource = overrideSurfaceTempF != null ? 'measured' : 'modeled';
  const surfaceTempAtPull = overrideSurfaceTempF ?? scaledSurfaceTemp;
  const surfaceGradient = surfaceTempAtPull - pullTempF;

  // ── Wet-bulb corrected ambient for boundary condition ───────────────────
  const effectiveAmbient = effectiveAmbientF(ambientTempF, isWrapped, surfaceTempAtPull);

  // ── One-term approximation: dimensionless center temperature ────────────
  // θ* = A₁ · exp(−λ₁² · Fo)
  //
  // θ* represents (T_center − T_∞) / (T_initial − T_∞) at dimensionless time Fo.
  // We use it as the fraction of the initial gradient that has NOT yet reached the center,
  // so fractionReached = 1 − θ*.
  //
  // This replaces the old hardcoded formula: 1 − exp(−π²·Fo/4)
  // The one-term approximation is more accurate because:
  //   1. λ₁ and A₁ are geometry-specific (slab vs cylinder vs sphere)
  //   2. They account for the actual Biot number (surface boundary condition)
  //   3. The old formula implicitly assumed Bi → ∞ (prescribed surface temp)
  const thetaStar = A1 * Math.exp(-lambda1 * lambda1 * Fo);
  const fractionReached = Math.max(0, Math.min(1, 1 - thetaStar));

  // ── Penetration factor ──────────────────────────────────────────────────
  // Accounts for surface cooling, evaporative losses, and 3D effects not captured
  // by the one-term approximation geometry model alone.
  let penetrationFactor;
  const methodOverride = METHOD_PF_OVERRIDE[methodId];
  if (methodOverride) {
    penetrationFactor = isWrapped ? methodOverride.wrapped : methodOverride.unwrapped;
    if (methodOverride.decayPerInch) {
      penetrationFactor *= Math.exp(-methodOverride.decayPerInch * Math.max(0, thicknessInches - 0.5));
    }
  } else if (categoryId === 'seafood') {
    penetrationFactor = isWrapped ? 0.85 : 0.80;
  } else if (categoryId === 'potato') {
    penetrationFactor = isWrapped ? 0.30 : 0.22;
  } else {
    penetrationFactor = isWrapped ? 0.50 : 0.28;
  }

  // Apply geometry correction (tapered cuts lose more heat from edges)
  const geoFactor = GEOMETRY_TYPES[geometry]?.factor ?? 1.0;
  penetrationFactor *= geoFactor;

  // Bone-in correction: bone insulates one face → ~15% less effective penetration
  if (boneIn) {
    penetrationFactor *= 0.85;
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
    ambientTempF: effectiveAmbient,
    thicknessInches,
  });

  return {
    deltaF: Math.round(deltaF * 10) / 10,
    peakTempF: Math.round(peakTempF * 10) / 10,
    minutesToPeak: Math.round(minutesToPeak),
    restProfile,
    fourier: Math.round(Fo * 100) / 100,
    biot: Math.round(Bi * 1000) / 1000,
    lambda1: Math.round(lambda1 * 10000) / 10000,
    A1: Math.round(A1 * 10000) / 10000,
    surfaceTempAtPull: Math.round(surfaceTempAtPull),
    surfaceGradientF: Math.round(surfaceGradient * 10) / 10,
    penetrationFactor,
    fractionReached: Math.round(fractionReached * 1000) / 1000,
    halfThicknessM: Math.round(Lc * 10000) / 10000,
    thermalDiffusivity: alpha,
    surfaceDataSource,
    geometry,
    geometryFactor: geoFactor,
    effectiveAmbientF: Math.round(effectiveAmbient * 10) / 10,
    convectiveH: h,
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
