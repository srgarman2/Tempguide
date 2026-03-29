/**
 * claudeAnalysis.js — Calls the Anthropic Messages API directly from the browser
 * to perform a full model audit of a cook log entry.
 *
 * The user must supply their own API key, stored in localStorage.
 * This never leaves the browser except in the Authorization header to api.anthropic.com.
 */

const API_KEY_STORAGE = 'tempguide_claude_key';
const MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 2048;

// ── Fixed model constants ─────────────────────────────────────────────────────
// These are the hardcoded values in carryover.js — included verbatim so Claude
// can audit whether each assumption is physically reasonable.
const MODEL_CONSTANTS = {
  ALPHA_M2_S:       1.36e-7,   // Thermal diffusivity of muscle tissue (m²/s)
  K_MEAT_W_MK:      0.49,      // Thermal conductivity of muscle tissue (W/m·K)
  H_OPEN_W_M2K:     10,        // Convective h, unwrapped / still air (W/m²·K)
  H_FOIL_W_M2K:     3,         // Convective h, foil-wrapped (W/m²·K)
  WET_BULB_RH_PCT:  45,        // Assumed kitchen relative humidity (%)
  PF_MAMMALIAN_OPEN: 0.28,     // Base penetration factor, mammalian, unwrapped
  PF_MAMMALIAN_WRAP: 0.50,     // Base penetration factor, mammalian, wrapped
  PF_SEAFOOD_OPEN:  0.80,
  PF_SEAFOOD_WRAP:  0.85,
  PF_POTATO_OPEN:   0.22,
  PF_POTATO_WRAP:   0.30,
  BONE_IN_CORRECTION: 0.85,    // Bone-in reduces penetration factor by ~15%
  // Carryover eigenvalues (Bi → ∞ limit, internal redistribution)
  CARRY_EIGEN_SLAB:     { lambda1: Math.PI / 2,       A1: 4 / Math.PI },
  CARRY_EIGEN_CYLINDER: { lambda1: 2.4048,             A1: 1.6021 },
  CARRY_EIGEN_SPHERE:   { lambda1: Math.PI,            A1: 2.0 },
  TAPERED_FACTOR:       0.88,  // Geometry correction for tapered cuts (e.g. tri-tip)
};

// ── Key management ────────────────────────────────────────────────────────────

export function getStoredApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; }
}

export function storeApiKey(key) {
  try { localStorage.setItem(API_KEY_STORAGE, key.trim()); } catch {}
}

export function clearApiKey() {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch {}
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function fmt(v, decimals = 1) {
  return v != null ? v.toFixed(decimals) : 'N/A';
}

function fmtSci(v) {
  if (v == null) return 'N/A';
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const coeff = v / Math.pow(10, exp);
  return `${coeff.toFixed(2)}×10^${exp}`;
}

function buildUserMessage(entry) {
  const lines = [];
  const e = entry;

  // ── Section 1: Cook inputs ────────────────────────────────────────────────
  lines.push('## Cook Inputs');
  lines.push(`- Protein: ${e.categoryLabel} – ${e.itemLabel}${e.donenessLabel ? ` (${e.donenessLabel})` : ''}`);
  lines.push(`- Method: ${e.methodLabel}`);
  lines.push(`- Thickness (entered): ${e.thicknessInches}"`);
  lines.push(`- Geometry: ${e.geometry}${e.boneIn ? ', bone-in' : ''}`);
  lines.push(`- Wrapped during rest: ${e.isWrapped ? 'Yes (foil/tent)' : 'No (uncovered)'}`);
  lines.push(`- Pull temp (core): ${e.pullCoreTempF != null ? `${fmt(e.pullCoreTempF)}°F (measured)` : 'N/A'}`);
  lines.push(`- Surface temp at pull: ${e.pullSurfaceTempF != null ? `${fmt(e.pullSurfaceTempF)}°F (measured)` : 'not measured'}`);
  lines.push(`- Ambient temp: ${e.pullAmbientTempF != null ? `${fmt(e.pullAmbientTempF)}°F (probe)` : '72°F (assumed)'}`);
  if (e.sensorReadingsAtPull) {
    lines.push(`- 8-sensor gradient at pull: [${e.sensorReadingsAtPull.map(t => fmt(t)).join(', ')}]°F`);
    lines.push(`  (virtual core: T${(e.virtualCoreIndexAtPull ?? 0) + 1}, virtual surface: T${(e.virtualSurfaceIndexAtPull ?? 7) + 1})`);
    if (e.isDegenerateGradient) lines.push('  ⚠ Core === surface sensor — full probe span used for gradient estimation');
  }
  lines.push('');

  // ── Section 2: Fixed model constants ─────────────────────────────────────
  lines.push('## Fixed Model Constants (hardcoded assumptions)');
  lines.push(`- Thermal diffusivity α = ${fmtSci(MODEL_CONSTANTS.ALPHA_M2_S)} m²/s  (homogeneous muscle tissue)`);
  lines.push(`- Thermal conductivity k = ${MODEL_CONSTANTS.K_MEAT_W_MK} W/(m·K)`);
  lines.push(`- Convective h (unwrapped, still air) = ${MODEL_CONSTANTS.H_OPEN_W_M2K} W/(m²·K)`);
  lines.push(`- Convective h (foil-wrapped) = ${MODEL_CONSTANTS.H_FOIL_W_M2K} W/(m²·K)`);
  lines.push(`- Applied h this cook: ${e.convectiveH != null ? e.convectiveH : (e.isWrapped ? MODEL_CONSTANTS.H_FOIL_W_M2K : MODEL_CONSTANTS.H_OPEN_W_M2K)} W/(m²·K)`);
  lines.push(`- Assumed kitchen RH: ${MODEL_CONSTANTS.WET_BULB_RH_PCT}% (used for wet-bulb ambient depression when unwrapped)`);
  lines.push(`- Effective ambient used: ${e.effectiveAmbientF != null ? `${fmt(e.effectiveAmbientF)}°F` : 'N/A'} (dry-bulb minus wet-bulb depression)`);
  lines.push(`- Base penetration factor (${e.categoryLabel}, ${e.isWrapped ? 'wrapped' : 'unwrapped'}): ${
    e.categoryId === 'seafood' ? (e.isWrapped ? MODEL_CONSTANTS.PF_SEAFOOD_WRAP : MODEL_CONSTANTS.PF_SEAFOOD_OPEN)
    : e.categoryId === 'potato' ? (e.isWrapped ? MODEL_CONSTANTS.PF_POTATO_WRAP : MODEL_CONSTANTS.PF_POTATO_OPEN)
    : (e.isWrapped ? MODEL_CONSTANTS.PF_MAMMALIAN_WRAP : MODEL_CONSTANTS.PF_MAMMALIAN_OPEN)
  }`);
  if (e.geometryFactor != null && Math.abs(e.geometryFactor - 1.0) > 0.001) {
    lines.push(`- Geometry correction factor (${e.geometry}): ×${fmt(e.geometryFactor, 3)}`);
  }
  if (e.boneIn) {
    lines.push(`- Bone-in correction: ×${MODEL_CONSTANTS.BONE_IN_CORRECTION}`);
  }
  lines.push('');

  // ── Section 3: Characteristic length and Biot number ─────────────────────
  lines.push('## Geometry and Biot Number');
  const LcMM = e.halfThicknessM != null ? (e.halfThicknessM * 1000) : null;
  const LcCalc = e.thicknessInches != null
    ? `${e.thicknessInches}" / 2 × 25.4 = ${(e.thicknessInches * 25.4 / 2).toFixed(1)} mm`
    : 'N/A';
  lines.push(`- Characteristic length Lc = half-thickness = ${LcMM != null ? `${fmt(LcMM)} mm (stored)` : LcCalc}`);
  lines.push(`- Biot number: Bi = h × Lc / k`);
  if (e.biot != null && e.convectiveH != null && e.halfThicknessM != null) {
    lines.push(`  = ${e.convectiveH} × ${fmt(e.halfThicknessM * 1000)} mm / 1000 / ${MODEL_CONSTANTS.K_MEAT_W_MK}`);
    lines.push(`  = ${fmt(e.biot, 4)}`);
  } else {
    lines.push(`  = ${fmt(e.biot, 4)} (stored)`);
  }
  lines.push(`  (Bi < 0.1 = lumped system; Bi ≈ 1 = comparable resistance; Bi > 10 = strong gradient)`);
  lines.push('');

  // ── Section 4: One-term approximation eigenvalues ─────────────────────────
  lines.push('## One-Term Eigenvalues (from Biot lookup table)');
  lines.push(`  NOTE: These model surface cooling of a uniform body — NOT the internal redistribution`);
  lines.push(`  that drives carryover. They are displayed on the physics card for educational value.`);
  lines.push(`- λ₁ = ${fmt(e.lambda1, 4)}, A₁ = ${fmt(e.A1, 4)}  (geometry: ${e.geometry}, Bi: ${fmt(e.biot, 4)})`);
  lines.push('');

  // ── Section 5: Carryover eigenvalues and Fourier number ──────────────────
  lines.push('## Carryover Calculation (Heisler One-Term, Bi → ∞ eigenvalues)');
  lines.push(`  The model uses Bi → ∞ eigenvalues for carryover (internal redistribution),`);
  lines.push(`  NOT the Biot-table eigenvalues above.`);
  const geo = e.geometry === 'cylinder' ? 'cylinder'
            : e.geometry === 'sphere'   ? 'sphere'
            : 'slab';
  const carryEigen = MODEL_CONSTANTS[`CARRY_EIGEN_${geo.toUpperCase()}`] ?? MODEL_CONSTANTS.CARRY_EIGEN_SLAB;
  lines.push(`- Carryover eigenvalues (${geo}, Bi → ∞): λ₁ = ${carryEigen.lambda1.toFixed(4)}, A₁ = ${carryEigen.A1.toFixed(4)}`);
  lines.push('');
  lines.push(`- Time to peak: t_peak = 0.45 × (Lc² / α)  (empirical factor)`);
  if (e.halfThicknessM != null && e.thermalDiffusivity != null) {
    const tConstSec = (e.halfThicknessM ** 2) / e.thermalDiffusivity;
    const tPeakSec  = 0.45 * tConstSec;
    lines.push(`  = 0.45 × (${fmt(e.halfThicknessM * 1000)} mm)² / α`);
    lines.push(`  = 0.45 × ${(tConstSec).toFixed(0)} s = ${(tPeakSec / 60).toFixed(1)} min`);
  }
  lines.push(`  Stored predicted minutes to peak: ${e.predictedMinutesToPeak} min`);
  lines.push('');
  lines.push(`- Fourier number at t_peak: Fo = α × t_peak_sec / Lc²`);
  lines.push(`  = ${fmt(e.fourier, 3)} (stored)`);
  lines.push(`  (Fo > 0.2 required for one-term approximation accuracy)`);
  lines.push('');
  lines.push(`- Dimensionless temperature deficit: θ* = A₁ × exp(−λ₁² × Fo)`);
  if (e.fractionReached != null && e.fourier != null) {
    const thetaStar = 1 - e.fractionReached;
    lines.push(`  = ${carryEigen.A1.toFixed(4)} × exp(−${(carryEigen.lambda1 ** 2).toFixed(4)} × ${fmt(e.fourier, 3)})`);
    lines.push(`  = ${fmt(thetaStar, 4)}`);
  }
  lines.push(`- Fraction of gradient reaching center: fractionReached = 1 − θ* = ${fmt(e.fractionReached, 4)}`);
  lines.push('');

  // ── Section 6: Surface gradient and penetration factor ───────────────────
  lines.push('## Surface Gradient and Penetration Factor');
  lines.push(`- Surface temp at pull: ${e.surfaceTempAtPull != null ? `${fmt(e.surfaceTempAtPull)}°F` : 'N/A'} (source: ${e.surfaceDataSource ?? 'unknown'})`);
  lines.push(`- Core temp at pull:    ${e.pullCoreTempF != null ? `${fmt(e.pullCoreTempF)}°F` : 'N/A'}`);
  lines.push(`- Surface gradient:     ${fmt(e.surfaceGradientF)}°F (= surface − core)`);
  lines.push(`- Final penetration factor: ${fmt(e.penetrationFactor, 4)} (after all corrections)`);
  lines.push('');

  // ── Section 7: The full carryover formula ─────────────────────────────────
  lines.push('## Carryover Formula Evaluation');
  lines.push('  ΔT = surfaceGradient × fractionReached × penetrationFactor');
  if (e.surfaceGradientF != null && e.fractionReached != null && e.penetrationFactor != null) {
    const raw = e.surfaceGradientF * e.fractionReached * e.penetrationFactor;
    lines.push(`     = ${fmt(e.surfaceGradientF)} × ${fmt(e.fractionReached, 4)} × ${fmt(e.penetrationFactor, 4)}`);
    lines.push(`     = ${fmt(raw)} °F  (clamped to [0.5, 25] → stored as ${fmt(e.predictedDeltaF)}°F)`);
  }
  lines.push(`- Predicted peak: ${fmt(e.pullCoreTempF ?? 0)}°F (pull) + ${fmt(e.predictedDeltaF)}°F = ${fmt(e.predictedPeakF)}°F`);
  lines.push('');

  // ── Section 8: Model path note ───────────────────────────────────────────
  if (e.surfaceDataSource === 'fd-simulation' || e.surfaceDataSource?.includes('fd') || e.surfaceDataSource === 'gradient') {
    lines.push('## Model Path: Finite-Difference Simulation');
    lines.push('  The FD simulator was used. It solves ∂T/∂t = α·∇²T numerically using the');
    lines.push('  8-sensor gradient as initial condition, then the empirical penetration factor');
    lines.push('  is applied as a correction factor to match the empirical prediction.');
    lines.push(`  This correction factor is: (fractionReachedEmpir × PF) / fdEffectiveFraction`);
    lines.push('');
  }

  // ── Section 9: Actual outcome and error ──────────────────────────────────
  lines.push('## Actual Outcome');
  if (e.actualPeakF != null) {
    lines.push(`- Actual peak temp:    ${fmt(e.actualPeakF)}°F (measured by probe during rest)`);
    lines.push(`- Actual time to peak: ~${fmt(e.actualMinutesToPeak)} min`);
    const sign = e.errorF >= 0 ? '+' : '';
    lines.push(`- Error:               ${sign}${fmt(e.errorF)}°F (actual − predicted)`);
    lines.push(`  → The model ${e.errorF > 0 ? 'UNDER-predicted' : 'OVER-predicted'} carryover by ${Math.abs(e.errorF).toFixed(1)}°F`);
  } else {
    lines.push('- No live probe data during rest — prediction unverified');
  }
  lines.push('');

  // ── Section 10: Cook phase history ───────────────────────────────────────
  if (e.cookPhaseHistory && e.cookPhaseHistory.length > 0) {
    lines.push('## Cook Phase Temperature History (core, °F by elapsed minute)');
    const pts = e.cookPhaseHistory;
    lines.push(pts.map(p => `${p.minute.toFixed(1)}m: ${p.coreTemp?.toFixed(1)}°`).join('  '));
    if (pts.some(p => p.surfaceTemp != null)) {
      lines.push('Surface: ' + pts.filter(p => p.surfaceTemp != null).map(p => `${p.minute.toFixed(1)}m: ${p.surfaceTemp.toFixed(1)}°`).join('  '));
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Please audit the math and assumptions above. Identify:');
  lines.push('1. Any calculation that appears incorrect or uses questionable assumptions');
  lines.push('2. Which specific assumptions likely caused the prediction error, and why');
  lines.push('3. Concrete suggestions for improving the model (e.g., better constant values, formula changes, or factors being ignored)');
  lines.push('4. What the cook could do differently next time to get closer to the target');

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a thermal physics expert reviewing a carryover cooking prediction model. The model uses the Heisler one-term approximation and a 1D finite-difference simulator to predict how much a protein's core temperature rises after removal from heat.

You are given the complete model evaluation for a specific cook: all input parameters, fixed constants, intermediate calculations, and the actual measured outcome. Your job is to:

1. **Audit the math**: Verify each calculation step. Flag anything that is numerically inconsistent or where the formula doesn't match what was claimed.

2. **Critique the assumptions**: The model uses fixed constants (α, k, h, penetration factors, eigenvalues). Evaluate whether these are appropriate for the specific protein, method, and conditions. Flag any that are likely wrong or oversimplified.

3. **Diagnose the error**: Given the prediction error, identify which specific model component or assumption most likely caused it. Be quantitative where possible.

4. **Suggest model improvements**: Propose specific, concrete changes to constants, formulas, or model structure that would improve accuracy. These are suggestions for the model developer, not UI tweaks.

5. **Actionable cook advice**: Also give 1–2 practical suggestions for what the cook could do differently (e.g., adjust thickness entry, use probe differently, change rest method).

Be precise and technical. Reference specific variable names and numbers. Use markdown. Aim for depth over breadth — a well-reasoned analysis of the 2–3 most significant issues is more valuable than listing every possible problem.`;

// ── API call ──────────────────────────────────────────────────────────────────

export async function analyzeWithClaude(entry, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(entry) }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}
