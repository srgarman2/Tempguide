import { useMemo } from 'react';
import { getCategoryById, getItemById, getMethodById } from '../data/temperatures';
import { estimateCarryover } from '../utils/carryover';
import { THERMOMETER_STATE } from '../constants/thermometer';
import useRestTimer from '../hooks/useRestTimer';
import NavBar from './NavBar';
import CarryoverChart from './CarryoverChart';

export default function RestScreen({ selection, thermo, navigate, goBack, startOver, SCREENS }) {
  const category = getCategoryById(selection.categoryId);
  const item = getItemById(selection.categoryId, selection.itemId);
  const method = getMethodById(selection.methodId);

  if (!category || !item || !method) return null;

  const doneness = item.hasDoneness && selection.donenessIndex != null
    ? item.doneness[selection.donenessIndex]
    : null;

  const isBasting = method.usesBastingPullTemps;

  // Resolve pull / end / rest values
  const pullTempF = (() => {
    if (doneness) {
      if (isBasting) return doneness.bastingPullTemp ?? doneness.pullTemp?.min;
      if (doneness.pullTemp != null && typeof doneness.pullTemp === 'object') return doneness.pullTemp.min;
      return doneness.pullTemp;
    }
    return item.pullTemp;
  })() ?? 125;

  const endTempF = (() => {
    if (doneness) {
      if (doneness.endTemp != null && typeof doneness.endTemp === 'object') return doneness.endTemp.min;
      return doneness.endTemp ?? doneness.sousVideTemp;
    }
    if (Array.isArray(item.endTempRange)) return item.endTempRange[0];
    return item.endTemp ?? item.pullTemp;
  })() ?? 135;

  const restMinutes = isBasting
    ? (doneness?.bastingRestMinutes ?? item.restMinutes ?? 10)
    : (Array.isArray(item.restRangeMinutes)
        ? item.restRangeMinutes[0]
        : (item.restMinutes ?? 10));

  const hasMeasuredData = selection.actualCoreTempF != null && selection.actualSurfaceTempF != null;

  // Extract core-to-surface gradient slice from the full sensor snapshot captured at pull.
  // sensorReadingsAtPull is all 8 sensor temps; we slice from virtualCore to virtualSurface (inclusive).
  // Expected shape: sensorTempsF[0] = core (coldest), sensorTempsF[last] = surface (hottest).
  const sensorGradientF = (() => {
    if (
      selection.sensorReadingsAtPull == null ||
      selection.virtualCoreIndexAtPull == null ||
      selection.virtualSurfaceIndexAtPull == null
    ) return null;

    const sensors = selection.sensorReadingsAtPull;
    const coreIdx = selection.virtualCoreIndexAtPull;
    const surfIdx = selection.virtualSurfaceIndexAtPull;

    // Normal case: core and surface are distinct sensors.
    const normalSlice = sensors.slice(coreIdx, surfIdx + 1);
    if (normalSlice.length >= 2) return normalSlice;

    // Degenerate case: Combustion assigned core === surface (e.g. thin chicken breast).
    // The stored heat is distributed across the FULL probe span. Try both directions
    // from the core sensor and use whichever side has the larger temperature spread
    // — that side represents the sear surface driving carryover.
    // T8 (index 7) is the ambient sensor; exclude it from internal gradient estimation.
    const ambientIdx = sensors.length - 1;

    // Toward T1 (lower indices = sear-side tip, reversed so core is first)
    const lowerSlice = coreIdx > 0
      ? sensors.slice(0, coreIdx + 1).reverse()
      : [];

    // Toward T7 (higher indices, stop before ambient T8)
    const upperSlice = coreIdx < ambientIdx - 1
      ? sensors.slice(coreIdx, ambientIdx)
      : [];

    const lowerSpread = lowerSlice.length >= 2
      ? lowerSlice[lowerSlice.length - 1] - lowerSlice[0]
      : -Infinity;
    const upperSpread = upperSlice.length >= 2
      ? upperSlice[upperSlice.length - 1] - upperSlice[0]
      : -Infinity;

    if (lowerSpread >= upperSpread && lowerSlice.length >= 2) return lowerSlice;
    if (upperSlice.length >= 2) return upperSlice;

    return normalSlice; // Fallback: single-element, FD path will be skipped
  })();

  const hasSensorGradient = sensorGradientF != null && sensorGradientF.length >= 2;
  const isDegenerateGradient =
    selection.virtualCoreIndexAtPull != null &&
    selection.virtualSurfaceIndexAtPull != null &&
    selection.virtualCoreIndexAtPull === selection.virtualSurfaceIndexAtPull;

  // ── Live probe state during rest ────────────────────────────────────
  const isConnected = thermo.state === THERMOMETER_STATE.CONNECTED;
  const hasLiveGradient = isConnected && !thermo.isInstantRead
    && thermo.sensors?.length >= 2 && thermo.virtualSurfaceIndex != null;

  const timer = useRestTimer({
    methodId: selection.methodId,
    pullTempF,
    endTempF,
    restMinutes,
    thicknessInches: selection.thicknessInches,
    categoryId: selection.categoryId,
    geometry: selection.geometry ?? 'slab',
    isWrapped: selection.isWrapped ?? false,
    boneIn: selection.boneIn ?? false,
    actualCoreTempF: selection.actualCoreTempF ?? null,
    actualSurfaceTempF: selection.actualSurfaceTempF ?? null,
    ambientTempF: selection.actualAmbientTempF ?? 72,
    sensorGradientF,
    // ── Live probe data for assimilation ──────────────────────────────
    liveCoreTemp:            isConnected ? thermo.coreTemp : null,
    liveSensors:             hasLiveGradient ? thermo.sensors : null,
    liveVirtualCoreIndex:    hasLiveGradient ? thermo.virtualCoreIndex : null,
    liveVirtualSurfaceIndex: hasLiveGradient ? thermo.virtualSurfaceIndex : null,
    liveAmbientTempF:        isConnected ? thermo.ambientTemp : null,
    isProbeConnected:        hasLiveGradient,
    onComplete: () => {},
  });

  const { carryover } = timer;

  const endTempDisplay = doneness
    ? (doneness.endTemp != null && typeof doneness.endTemp === 'object'
        ? `${doneness.endTemp.min}–${doneness.endTemp.max}°F`
        : `${doneness.endTemp ?? doneness.sousVideTemp ?? '—'}°F`)
    : (() => {
        if (Array.isArray(item.endTempRange)) return `${item.endTempRange[0]}–${item.endTempRange[1]}°F`;
        return `${item.endTemp ?? '—'}°F`;
      })();

  const formatTime = (totalSec) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Ring progress circle
  const RING_R = 80;
  const RING_C = 180;
  const circumference = 2 * Math.PI * RING_R;
  const dashOffset = circumference * (1 - timer.progressPct / 100);

  // Physics display helpers
  const thicknessDisplay = selection.thicknessInches
    ? `${selection.thicknessInches}"` : '1.0"';

  const categoryLabel = {
    beef: 'Mammalian', pork: 'Mammalian', poultry: 'Avian',
    seafood: 'Seafood', baked: 'Baked',
  }[selection.categoryId] || selection.categoryId;

  return (
    <div className="screen rest-screen" style={{ '--accent': category.accentColor }}>
      <div className="category-bg" style={{ background: category.gradient, opacity: 0.35 }} />

      <NavBar onBack={goBack} title="Resting" />

      {/* Done banner */}
      {timer.isComplete && (
        <div className="rest-done-banner">
          <span style={{ fontSize: '1.5rem' }}>✅</span>
          <div>
            <div>Rest complete — time to eat!</div>
            <div style={{ fontSize: 13, fontWeight: 400, marginTop: 2, opacity: 0.7 }}>
              Peak temp reached: ~{carryover.peakTempF.toFixed(1)}°F
            </div>
          </div>
        </div>
      )}

      {/* Ring timer display */}
      <div className="rest-timer-display">
        <div style={{ position: 'relative', width: RING_C, height: RING_C, margin: '0 auto' }}>
          <svg width={RING_C} height={RING_C} viewBox={`0 0 ${RING_C} ${RING_C}`}>
            {/* Track */}
            <circle
              cx={RING_C / 2}
              cy={RING_C / 2}
              r={RING_R}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={10}
            />
            {/* Progress */}
            <circle
              cx={RING_C / 2}
              cy={RING_C / 2}
              r={RING_R}
              fill="none"
              stroke={timer.isComplete ? '#4cde80' : category.accentColor}
              strokeWidth={10}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${RING_C / 2} ${RING_C / 2})`}
              style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s' }}
            />
          </svg>

          {/* Center content */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {timer.isRunning || timer.isComplete ? (
              <>
                <div className="rest-time">
                  {formatTime(timer.remainingSec)}
                </div>
                <div className="rest-time-label">remaining</div>
              </>
            ) : (
              <>
                <div className="rest-time" style={{ fontSize: '3rem' }}>
                  {restMinutes}:00
                </div>
                <div className="rest-time-label">to rest</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Timer controls */}
      <div className="rest-actions">
        {!timer.isRunning && !timer.isComplete && (
          <button
            className="action-btn --primary"
            style={{ background: category.accentColor }}
            onClick={timer.start}
          >
            Start rest timer
          </button>
        )}
        {timer.isRunning && (
          <button className="action-btn --secondary" onClick={timer.pause}>
            ⏸ Pause
          </button>
        )}
        {!timer.isRunning && timer.elapsedSec > 0 && !timer.isComplete && (
          <button
            className="action-btn --primary"
            style={{ background: category.accentColor }}
            onClick={timer.resume}
          >
            ▶ Resume
          </button>
        )}
        {timer.elapsedSec > 0 && (
          <button className="action-btn --secondary" onClick={timer.reset}>
            Reset
          </button>
        )}
      </div>

      {/* ── Prediction Card: primary output ──────────────────────────── */}
      <div className="cook-card prediction-card" style={{ margin: '0 20px 12px', position: 'relative', zIndex: 1 }}>
        <div className="cook-card-header">
          <span className="cook-card-title">Prediction</span>
          <span className="cook-card-value" style={{
            color: timer.hasReachedTarget ? '#4cde80' : '#f5a623',
          }}>
            {timer.isLiveTemp ? '' : '~'}{timer.estimatedCurrentTempF}°F
            {timer.isLiveTemp && (
              <span style={{ fontSize: 10, marginLeft: 4, color: '#4cde80' }}>🌡 live</span>
            )}
          </span>
        </div>

        {/* Time to target — the hero number */}
        {timer.timeToTargetMin != null && (
          <div className="prediction-hero">
            <div className="prediction-hero-label">Est. time to reach {endTempDisplay}</div>
            <div className="prediction-hero-value" style={{ color: category.accentColor }}>
              {timer.isRunning && timer.remainingToTargetSec != null ? (
                timer.remainingToTargetSec <= 0
                  ? 'Target reached!'
                  : formatTime(timer.remainingToTargetSec)
              ) : (
                `~${timer.timeToTargetMin} min`
              )}
            </div>
          </div>
        )}
        {timer.timeToTargetMin == null && (
          <div className="prediction-hero">
            <div className="prediction-hero-label">Est. time to reach {endTempDisplay}</div>
            <div className="prediction-hero-value" style={{ color: 'var(--text-tertiary)', fontSize: 16 }}>
              Carryover may not reach target
            </div>
          </div>
        )}

        {/* Core tracking rows */}
        <div className="carryover-row">
          <span className="label">
            {timer.isLiveTemp ? '🌡 Core temp (live)' : 'Est. core temp'}
          </span>
          <span className="val" style={{ color: timer.isLiveTemp ? '#4cde80' : '#f5a623' }}>
            {timer.isLiveTemp ? '' : '~'}{timer.estimatedCurrentTempF}°F
          </span>
        </div>
        <div className="carryover-row">
          <span className="label">
            {hasMeasuredData ? '🌡 Surface temp at pull (measured)' : 'Est. surface temp at pull'}
          </span>
          <span className="val" style={{ color: hasMeasuredData ? '#4cde80' : 'var(--text-primary)' }}>
            {carryover.surfaceTempAtPull}°F
          </span>
        </div>
        <div className="carryover-row">
          <span className="label">Ambient {selection.actualAmbientTempF != null ? '🌡' : ''}</span>
          <span className="val">
            {selection.actualAmbientTempF != null
              ? `${selection.actualAmbientTempF.toFixed(1)}°F (probe)`
              : '72°F (assumed)'}
          </span>
        </div>
        {timer.isRunning && (
          <div className="carryover-row">
            <span className="label">
              Temp slope {timer.isLiveTemp ? '🌡' : ''}
            </span>
            <span className="val" style={{
              color: timer.tempSlopePerMin > 0 ? '#f5a623' : timer.tempSlopePerMin < 0 ? '#66bbff' : 'var(--text-primary)',
            }}>
              {timer.tempSlopePerMin > 0 ? '+' : ''}{timer.tempSlopePerMin}°F/min
            </span>
          </div>
        )}
        <div className="carryover-row">
          <span className="label">Pull temp</span>
          <span className="val">{timer.adjustedPullTempF}°F</span>
        </div>
        <div className="carryover-row">
          <span className="label">Target final</span>
          <span className="val">{endTempDisplay}</span>
        </div>
        <div className="carryover-row">
          <span className="label">Est. peak (+{carryover.deltaF}°F)</span>
          <span className="val" style={{ color: '#f5a623' }}>{carryover.peakTempF.toFixed(1)}°F</span>
        </div>
        <div className="carryover-row">
          <span className="label">Time to peak</span>
          <span className="val">~{carryover.minutesToPeak} min</span>
        </div>
      </div>

      {/* ── Physics Card: carryover model internals ──────────────────── */}
      <div className="cook-card physics-card" style={{ margin: '0 20px 12px', position: 'relative', zIndex: 1 }}>
        <div className="cook-card-header">
          <span className="cook-card-title">Physics Model</span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 7px', borderRadius: 20,
            background: timer.isAssimilating
              ? 'rgba(102,187,255,0.12)'
              : hasSensorGradient
                ? 'rgba(102,187,255,0.12)'
                : hasMeasuredData
                  ? 'rgba(76,222,128,0.12)'
                  : 'rgba(255,255,255,0.06)',
            border: `1px solid ${timer.isAssimilating
              ? 'rgba(102,187,255,0.35)'
              : hasSensorGradient
                ? 'rgba(102,187,255,0.35)'
                : hasMeasuredData
                  ? 'rgba(76,222,128,0.35)'
                  : 'rgba(255,255,255,0.12)'}`,
            color: timer.isAssimilating ? '#66bbff' : hasSensorGradient ? '#66bbff' : hasMeasuredData ? '#4cde80' : 'var(--text-tertiary)',
          }}>
            {timer.isAssimilating
              ? `🔄 Live ×${timer.assimilationCount}`
              : hasSensorGradient
                ? '🔬 Finite Diff'
                : hasMeasuredData
                  ? '🌡 Measured'
                  : 'Modeled'}
          </span>
        </div>

        {/* Sensor snapshot at pull — only shown when real data is available */}
        {hasMeasuredData && selection.sensorReadingsAtPull && (
          <div className="physics-sensor-snapshot">
            <div className="physics-sensor-label">
              {isDegenerateGradient && hasSensorGradient
                ? `Probe at pull — core: T${(selection.virtualCoreIndexAtPull ?? 0) + 1} (full-span gradient used — core = surface sensor)`
                : `Probe at pull — core: T${(selection.virtualCoreIndexAtPull ?? 0) + 1}, surface: T${(selection.virtualSurfaceIndexAtPull ?? selection.sensorReadingsAtPull.length - 1) + 1}`}
            </div>
            <div className="physics-sensor-row">
              {selection.sensorReadingsAtPull.map((temp, i) => {
                const minT = Math.min(...selection.sensorReadingsAtPull);
                const maxT = Math.max(...selection.sensorReadingsAtPull);
                const norm = maxT > minT ? (temp - minT) / (maxT - minT) : 0;
                const r = Math.round(60 + norm * 195);
                const g = Math.round(200 - norm * 130);
                const b = Math.round(220 - norm * 200);
                const isCore    = i === selection.virtualCoreIndexAtPull;
                const isSurface = i === selection.virtualSurfaceIndexAtPull;
                return (
                  <div
                    key={i}
                    className={`physics-sensor-pip${isCore ? ' physics-sensor-pip--core' : isSurface ? ' physics-sensor-pip--surface' : ''}`}
                    style={{ background: `rgb(${r},${g},${b})` }}
                  >
                    <div className="physics-sensor-temp">{Math.round(temp)}°</div>
                    <div className="physics-sensor-id">T{i + 1}</div>
                    {isCore    && <div className="physics-sensor-role">core</div>}
                    {isSurface && <div className="physics-sensor-role">surf</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="physics-grid">
          <PhysicsParam
            label="Biot Number"
            symbol="Bi = h·Lc / k"
            value={carryover.biot != null ? carryover.biot : 'N/A'}
            detail={carryover.biot == null
              ? 'Not used in finite-difference mode'
              : carryover.biot < 0.1
                ? 'Bi < 0.1 — near-lumped system (uniform temp)'
                : carryover.biot > 10
                  ? 'Bi > 10 — strong internal gradient'
                  : 'Moderate: comparable surface and internal resistance'}
          />
          <PhysicsParam
            label="Fourier Number"
            symbol="Fo = α·t / Lc²"
            value={carryover.fourier ?? 'N/A'}
            detail={carryover.fourier == null
              ? 'Not used in finite-difference mode'
              : 'Dimensionless time — higher = more equilibrated'}
          />
          <PhysicsParam
            label="Surface Gradient"
            symbol={hasSensorGradient
              ? isDegenerateGradient
                ? `🔬 T_core → T_hottest (${sensorGradientF.length} sensors, full-span)`
                : `🔬 T_core → T_surface (${sensorGradientF.length} sensors)`
              : hasMeasuredData
                ? '🌡 T_surface − T_core (probe)'
                : 'ΔT surface→core (model)'}
            value={`${carryover.surfaceGradientF}°F`}
            detail={`Surface ${carryover.surfaceTempAtPull}°F → Core ${timer.adjustedPullTempF}°F at pull`}
          />
          <PhysicsParam
            label="Fraction Reached"
            symbol={carryover.lambda1 != null
              ? `θ* = A₁·e^(−λ₁²·Fo) — λ₁=${carryover.lambda1}`
              : '1 − θ*'}
            value={carryover.fractionReached ?? 'N/A'}
            detail={carryover.fractionReached == null
              ? 'Not used in finite-difference mode'
              : 'One-term approximation: heat fraction reaching center'}
          />
          <PhysicsParam
            label="Penetration Factor"
            symbol={categoryLabel}
            value={carryover.penetrationFactor ?? 'N/A'}
            detail={carryover.penetrationFactor == null
              ? 'Not used in finite-difference mode'
              : carryover.penetrationFactor >= 0.5
                ? 'High: thin + high water content → fast transfer'
                : 'Standard: accounts for 3D geometry, surface cooling'}
          />
          <PhysicsParam
            label="Characteristic Length"
            symbol={`Lc (${selection.geometry ?? 'slab'})`}
            value={`${(carryover.halfThicknessM * 1000).toFixed(1)} mm`}
            detail={selection.geometry === 'cylinder' ? 'Lc = radius (cylindrical eigenvalues)'
              : selection.geometry === 'sphere' ? 'Lc = radius (spherical eigenvalues)'
              : 'Lc = half-thickness (plane wall)'}
          />
          <PhysicsParam
            label="Convective h"
            symbol={selection.isWrapped ? 'Wrapped (foil/tent)' : 'Unwrapped (still air)'}
            value={carryover.convectiveH != null ? `${carryover.convectiveH} W/(m²·K)` : 'N/A'}
            detail=""
          />
          <PhysicsParam
            label="Thermal Diffusivity"
            symbol="α (muscle tissue)"
            value={(() => {
              const a = carryover.thermalDiffusivity;
              const exp = Math.floor(Math.log10(Math.abs(a)));
              const coeff = a / Math.pow(10, exp);
              return `${coeff.toFixed(2)} × 10${exp < 0 ? '⁻' : ''}${String(Math.abs(exp)).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('')} m²/s`;
            })()}
            detail=""
          />
        </div>

        {/* The formula summary */}
        <div className="physics-formula">
          {hasSensorGradient ? (
            <>
              <div className="physics-formula-label">Finite-Difference Model</div>
              <div className="physics-formula-eq">∂T/∂t = α · ∇²T (numerically integrated)</div>
              <div className="physics-formula-eq" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {sensorGradientF.length}-sensor gradient → <span style={{ color: '#f5a623' }}>+{carryover.deltaF}°F</span>
              </div>
            </>
          ) : (
            <>
              <div className="physics-formula-label">One-Term Approximation (Heisler)</div>
              <div className="physics-formula-eq">
                θ* = A₁·exp(−λ₁²·Fo) — Bi = {carryover.biot}
              </div>
              <div className="physics-formula-eq">
                ΔT = gradient × (1 − θ*) × penetration
              </div>
              <div className="physics-formula-eq" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {carryover.surfaceGradientF}°F × {carryover.fractionReached} × {carryover.penetrationFactor?.toFixed(3)} = <span style={{ color: '#f5a623' }}>+{carryover.deltaF}°F</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Carryover chart */}
      <CarryoverChart
        profile={carryover.restProfile}
        pullTempF={timer.adjustedPullTempF}
        endTempF={endTempF}
        peakTempF={carryover.peakTempF}
        currentMinute={timer.elapsedMin}
        accentColor={category.accentColor}
        restMinutes={restMinutes}
        actualHistory={timer.liveHistory}
        initialProfile={timer.isAssimilating ? timer.initialCarryover.restProfile : null}
        assimilationMinute={timer.isAssimilating ? timer.elapsedMin : null}
      />

      {/* Notes */}
      {(doneness?.notes || item.notes) && (
        <div className="notes-block">
          <strong>Notes:</strong> {doneness?.notes ?? item.notes}
        </div>
      )}

      {/* Sources */}
      {(doneness?.sources || item.sources) && (
        <div className="notes-block" style={{ borderColor: 'rgba(100,180,255,0.15)', background: 'rgba(100,180,255,0.04)' }}>
          <strong style={{ color: 'rgba(100,180,255,0.8)' }}>Sources:</strong>{' '}
          {(doneness?.sources ?? item.sources ?? []).join(', ')}
        </div>
      )}

      <div style={{ height: 16 }} />

      <button className="action-btn --secondary mb-16" onClick={startOver}>
        Cook something else
      </button>

      <div className="pb-safe" />
    </div>
  );
}

/** Individual physics parameter display */
function PhysicsParam({ label, symbol, value, detail }) {
  return (
    <div className="physics-param">
      <div className="physics-param-label">{label}</div>
      <div className="physics-param-value">{value}</div>
      <div className="physics-param-symbol">{symbol}</div>
      {detail && <div className="physics-param-detail">{detail}</div>}
    </div>
  );
}
