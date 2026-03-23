/**
 * Microwave Cook Time Estimator — "The Jeff Special"
 *
 * Estimates time to reach a target internal temperature for protein covered
 * and microwaved at 1000W. Microwave radiation heats volumetrically by
 * exciting water molecules, so energy absorption scales with mass (∝ thickness
 * for a fixed-area slab) and required temperature rise (ΔT).
 *
 * Model:  time = baseFactor × thickness × (pullTemp − fridgeTemp) / refΔT
 *
 *   baseFactor: category-specific minutes-per-inch to raise 100°F at 1000W.
 *     Accounts for density, water content, and microwave coupling efficiency.
 *   fridgeTemp: assumed starting temp (38°F).
 *   refΔT: 100°F — the reference temperature rise the baseFactor is calibrated to.
 *
 * Limitations:
 *   - Assumes a single portion (6–12 oz). Multiple pieces absorb more slowly.
 *   - Real microwaves have hot/cold spots; times are approximate.
 *   - Covering traps steam (212°F cap), improving efficiency and evening out
 *     the surface, but doesn't eliminate internal cold spots entirely.
 */

const FRIDGE_TEMP_F = 38;
const REF_DELTA_F = 100;

/**
 * Category-specific base factors: minutes per inch of thickness to raise
 * the internal temperature by 100°F at 1000W, covered.
 *
 *   beef:    dense red muscle, moderate water content (~70%)
 *   pork:    slightly leaner, heats a touch faster
 *   poultry: lower density, higher water fraction (~75%)
 *   seafood: thin, very high water content — heats rapidly
 *   potato:  dense starch-water matrix, large thermal mass
 */
const BASE_FACTOR = {
  beef:    2.8,
  pork:    2.5,
  poultry: 2.2,
  seafood: 1.8,
  potato:  3.5,
};

/**
 * Estimate microwave cook time.
 *
 * @param {Object} params
 * @param {number} params.pullTempF       - Target internal temp to pull at (°F)
 * @param {number} params.thicknessInches - Thickness at thickest point (inches)
 * @param {string} params.categoryId      - Protein category ID
 * @param {number} [params.startTempF]    - Starting internal temp (default: 38°F / fridge)
 * @returns {{ minutes: number, rangeLow: number, rangeHigh: number, note: string }}
 */
export function estimateMicrowaveTime({
  pullTempF,
  thicknessInches = 1.0,
  categoryId = 'beef',
  startTempF = FRIDGE_TEMP_F,
}) {
  const factor = BASE_FACTOR[categoryId] ?? BASE_FACTOR.beef;
  const deltaT = Math.max(pullTempF - startTempF, 10);
  const minutes = factor * thicknessInches * (deltaT / REF_DELTA_F);

  // ±20% range accounts for microwave variability, portion size, and geometry
  const rangeLow  = Math.max(0.5, Math.round(minutes * 0.8 * 2) / 2); // round to nearest 0.5
  const rangeHigh = Math.round(minutes * 1.2 * 2) / 2;

  const note = categoryId === 'seafood'
    ? 'Seafood heats extremely fast in a microwave — check early and often.'
    : categoryId === 'potato'
    ? 'Flip halfway through. Poke several times to vent steam.'
    : 'Flip or rotate halfway through for more even heating.';

  return { minutes: Math.round(minutes * 2) / 2, rangeLow, rangeHigh, note };
}
