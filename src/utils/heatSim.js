/**
 * 1D Finite-Difference Heat Conduction Simulator
 *
 * Models carryover cooking during the rest phase using the actual temperature
 * gradient measured by the probe's 8 sensors at the moment of pull.
 *
 * Physical model:
 *   - 1D slab, half-thickness L (center at x=0, surface at x=L)
 *   - Heat equation: ∂T/∂t = α · ∂²T/∂x²
 *   - BC at center (x=0): symmetry — dT/dx = 0 (ghost node T[-1] = T[1])
 *   - BC at surface (x=L): convection — -k·dT/dx = h·(T_surface − T_ambient)
 *   - Scheme: explicit forward Euler (conditionally stable, fast in JS)
 *   - Stability criterion: r = α·Δt/Δx² ≤ 0.4 (enforced by Δt selection)
 *
 * Why this is better than the empirical model when probe data is available:
 *   - The empirical model assumes uniform initial temperature (T_i = constant)
 *     and applies calibrated correction factors (penetrationFactor, surfaceExcessF)
 *   - Carryover cooking is fundamentally about NON-uniform initial conditions:
 *     the surface is 20–60°F hotter than the core at pull time
 *   - With T1–T8 readings from the Combustion probe, we have the actual gradient
 *   - The finite-difference simulation uses this real initial condition directly,
 *     requiring no empirical calibration for the initial temperature profile
 *
 * Characteristic accuracy improvement:
 *   - Empirical model must guess the surface temperature from cooking method
 *   - FD simulation uses the measured surface temp (probe T_surface sensor)
 *   - The FD simulation naturally handles thickness variation (thin vs thick cuts)
 *     without needing calibrated penetration factors
 *
 * Runtime: ~2ms for N=20, simMinutes=45 in modern JS (well within 60fps budget)
 */

// ── Physics constants ────────────────────────────────────────────────────────

/** Thermal diffusivity of beef/pork/poultry muscle tissue — m²/s */
const ALPHA = 1.36e-7;

/** Thermal conductivity of meat — W/(m·K) */
const K_MEAT = 0.49;

/** Convective heat transfer coefficient — open air natural convection, W/(m²·K) */
const H_OPEN = 10;

/** Convective h for foil-tented rest — steam trap reduces convection, W/(m²·K) */
const H_FOIL = 3;

/** Number of spatial nodes from center (0) to surface (N_NODES). Higher = more accurate
 *  but slower. N=20 gives sub-1°F spatial error and runs in ~2ms. */
const N_NODES = 20;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Interpolate probe sensor readings (core → surface) onto the N+1 simulation grid.
 *
 * The probe gives us 2–6 temperature readings between the virtual core sensor
 * and the virtual surface sensor. We map these onto N+1 grid points via linear
 * interpolation. The result is our initial condition T(x, 0).
 *
 * @param {number[]} sensorTempsF - Temperatures from virtual core to virtual surface (°F)
 *   sensorTempsF[0] = core reading, sensorTempsF[last] = surface reading
 * @param {number}   nNodes       - Number of intervals (grid has nNodes+1 points)
 * @returns {Float64Array} Temperature at each grid point (°F)
 */
function interpolateToNodes(sensorTempsF, nNodes) {
  const T = new Float64Array(nNodes + 1);
  const nSensors = sensorTempsF.length;

  for (let i = 0; i <= nNodes; i++) {
    const frac   = i / nNodes;                     // position 0..1 (center to surface)
    const pos    = frac * (nSensors - 1);           // fractional sensor index
    const lo     = Math.floor(pos);
    const hi     = Math.min(lo + 1, nSensors - 1);
    const weight = pos - lo;                        // interpolation weight
    T[i] = sensorTempsF[lo] + weight * (sensorTempsF[hi] - sensorTempsF[lo]);
  }
  return T;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the finite-difference heat conduction simulation.
 *
 * Starting from the probe's actual temperature gradient at pull time,
 * numerically integrates the heat equation forward in time to predict
 * how the core temperature evolves during rest.
 *
 * @param {Object} params
 * @param {number[]} params.sensorTempsF
 *   Temperature readings from virtual core through virtual surface, in °F.
 *   sensorTempsF[0] = core (T_virtualCore), sensorTempsF[last] = surface (T_virtualSurface).
 *   Must have at least 2 values.
 * @param {number}  params.thicknessInches
 *   Total thickness of the meat (or diameter for cylindrical/spherical geometry).
 * @param {number}  [params.ambientTempF=72]
 *   Effective ambient temperature (°F). Caller should apply wet-bulb depression
 *   before passing this value. Used for convective BC at surface.
 * @param {boolean} [params.isWrapped=false]
 *   True if meat is foil-tented or tightly wrapped during rest.
 *   Reduces h from H_OPEN to H_FOIL — steam traps surface heat → more inward conduction.
 * @param {number}  [params.simMinutes=60]
 *   How many minutes to simulate. Should be restMinutes + 30 to capture full peak + cooling.
 * @param {string}  [params.geometry='slab']
 *   Geometry type: 'slab' | 'cylinder' | 'sphere' | 'tapered'.
 *   Determines the characteristic length Lc used for the spatial grid.
 *
 * @returns {{
 *   restProfile:        Array<{minute: number, tempF: number}>,
 *   peakTempF:          number,
 *   minutesToPeak:      number,
 *   deltaF:             number,
 *   surfaceTempAtPull:  number,
 *   surfaceGradientF:   number,
 *   halfThicknessM:     number,
 *   thermalDiffusivity: number,
 *   method:             'finite-difference',
 *   fourier:            null,
 *   fractionReached:    null,
 *   penetrationFactor:  null,
 *   surfaceDataSource:  'sensor-gradient',
 * }}
 */
export function simulateCarryover({
  sensorTempsF,
  thicknessInches,
  ambientTempF   = 72,
  isWrapped      = false,
  simMinutes     = 60,
  geometry       = 'slab',
}) {
  if (!sensorTempsF || sensorTempsF.length < 2) {
    throw new Error('[heatSim] sensorTempsF must have at least 2 readings');
  }

  // ── Geometry-specific characteristic length ───────────────────────────────
  // Slab/Tapered: Lc = half-thickness.  Cylinder/Sphere: Lc = radius = diameter/2.
  const thicknessM = thicknessInches * 0.0254;
  const L  = thicknessM / 2; // For all geometries, user enters total thickness/diameter
  const dx = L / N_NODES;

  // ── Boundary condition ────────────────────────────────────────────────────
  const h = isWrapped ? H_FOIL : H_OPEN;

  // ── Time step selection for stability ─────────────────────────────────────
  // Stability requires r = α·Δt/Δx² ≤ 0.4
  // Surface node: also requires r ≤ 1 / (2 + 2·BiNode) — always looser for small BiNode
  const dt      = 0.4 * dx * dx / ALPHA;                // seconds
  const r       = ALPHA * dt / (dx * dx);                // Fourier mesh number ≈ 0.4
  const BiNode  = h * dx / K_MEAT;                      // node-level Biot number

  // ── Initial condition ─────────────────────────────────────────────────────
  let T    = interpolateToNodes(sensorTempsF, N_NODES);
  let Tnew = new Float64Array(N_NODES + 1);

  const pullTempF = T[0];   // core temp at pull = starting point of prediction

  // ── Simulation loop ───────────────────────────────────────────────────────
  const totalSteps = Math.ceil((simMinutes * 60) / dt);

  const profile = [{ minute: 0, tempF: Math.round(pullTempF * 10) / 10 }];
  let nextRecordMin = 1;
  let peakTempF     = pullTempF;
  let minutesToPeak = 0;

  for (let step = 1; step <= totalSteps; step++) {
    // Center node — symmetry BC: ghost node T[-1] = T[1]
    Tnew[0] = T[0] + 2 * r * (T[1] - T[0]);

    // Interior nodes — standard 3-point stencil
    for (let i = 1; i < N_NODES; i++) {
      Tnew[i] = T[i] + r * (T[i - 1] - 2 * T[i] + T[i + 1]);
    }

    // Surface node — half-cell energy balance with convective BC
    // ρ·cp·(Δx/2)·ΔT/Δt = k·(T[N-1]-T[N])/Δx − h·(T[N]−T_amb)
    // Using α = k/(ρ·cp) → ρ·cp = k/α:
    // Tnew[N] = T[N] + 2r·[(T[N-1]-T[N]) − BiNode·(T[N]−T_amb)]
    Tnew[N_NODES] = T[N_NODES]
      + 2 * r * ((T[N_NODES - 1] - T[N_NODES]) - BiNode * (T[N_NODES] - ambientTempF));

    // Swap buffers
    [T, Tnew] = [Tnew, T];

    // Record core temp at each whole elapsed minute
    const elapsedMin = (step * dt) / 60;
    if (elapsedMin >= nextRecordMin) {
      const coreTemp = T[0];
      profile.push({ minute: nextRecordMin, tempF: Math.round(coreTemp * 10) / 10 });
      if (coreTemp > peakTempF) {
        peakTempF     = coreTemp;
        minutesToPeak = nextRecordMin;
      }
      nextRecordMin++;
    }
  }

  // ── Return value — compatible with estimateCarryover() shape ─────────────
  const surfaceTempAtPull = sensorTempsF[sensorTempsF.length - 1];
  const surfaceGradientF  = surfaceTempAtPull - pullTempF;

  return {
    restProfile:   profile,
    peakTempF:     Math.round(peakTempF * 10) / 10,
    minutesToPeak,
    deltaF:        Math.round((peakTempF - pullTempF) * 10) / 10,
    surfaceTempAtPull:  Math.round(surfaceTempAtPull * 10) / 10,
    surfaceGradientF:   Math.round(surfaceGradientF * 10) / 10,
    halfThicknessM:     Math.round(L * 10000) / 10000,
    thermalDiffusivity: ALPHA,
    method:             'finite-difference',
    // Empirical-model fields — not applicable for FD simulation:
    fourier:            null,
    fractionReached:    null,
    penetrationFactor:  null,
    surfaceDataSource:  'sensor-gradient',
  };
}
