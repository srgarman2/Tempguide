import { useState, useMemo } from 'react';
import { getCategoryById, getItemById, getMethodById } from '../data/temperatures';
import { estimateCarryover, formatTemp, getCookStatus } from '../utils/carryover';
import { THERMOMETER_STATE } from '../constants/thermometer';
import useCookHistory from '../hooks/useCookHistory';
import NavBar from './NavBar';
import TempGauge from './TempGauge';
import ThermoBar from './ThermoBar';
import CookChart from './CookChart';

export default function CookScreen({ selection, thermo, navigate, goBack, SCREENS }) {
  const [manualTemp, setManualTemp] = useState('');

  // Hooks must be called before any early return (React rules of hooks).
  // Compute temp values inline so useCookHistory is always called.
  const isConnected = thermo.state === THERMOMETER_STATE.CONNECTED;
  const currentTemp = isConnected
    ? thermo.coreTemp
    : (manualTemp !== '' ? parseFloat(manualTemp) : null);
  const cookHistory = useCookHistory(currentTemp, isConnected ? thermo.surfaceTemp : null);

  const category = getCategoryById(selection.categoryId);
  const item = getItemById(selection.categoryId, selection.itemId);
  const method = getMethodById(selection.methodId);

  if (!category || !item || !method) return null;

  const doneness = item.hasDoneness && selection.donenessIndex != null
    ? item.doneness[selection.donenessIndex]
    : null;

  const isBasting = method.usesBastingPullTemps;

  // Resolve pull temp and end temp for the selected method
  const rawPullTemp = (() => {
    if (doneness) {
      if (isBasting) return doneness.bastingPullTemp ?? doneness.pullTemp?.min;
      if (doneness.pullTemp != null && typeof doneness.pullTemp === 'object') return doneness.pullTemp.min;
      return doneness.pullTemp;
    }
    return item.pullTemp;
  })();

  const rawEndTemp = (() => {
    if (doneness) {
      if (doneness.endTemp != null && typeof doneness.endTemp === 'object') return doneness.endTemp.min;
      return doneness.endTemp ?? doneness.sousVideTemp;
    }
    if (Array.isArray(item.endTempRange)) return item.endTempRange[0];
    return item.endTemp ?? item.pullTemp;
  })();

  const endTempDisplay = doneness
    ? (doneness.endTemp != null && typeof doneness.endTemp === 'object'
        ? `${doneness.endTemp.min}–${doneness.endTemp.max}°F`
        : `${doneness.endTemp ?? doneness.sousVideTemp ?? '—'}°F`)
    : formatTemp(Array.isArray(item.endTempRange) ? item.endTempRange : (item.endTemp ?? item.pullTemp));

  // Resolve rest time: doneness level takes priority over item level
  const restMinutes = isBasting
    ? (doneness?.bastingRestMinutes ?? doneness?.restMinutes ?? item.restMinutes ?? 10)
    : (doneness?.restMinutes ?? item.restMinutes ?? 0);

  // Use probe ambient sensor when available, otherwise assume room temp
  const ambientTempF = isConnected && thermo.ambientTemp != null ? thermo.ambientTemp : 72;

  // Carryover calculation — deltaF is independent of pullTempF (surface gradient = excess),
  // so we derive the adjusted pull temp from endTemp − deltaF ensuring pull + carryover = target.
  const co = useMemo(() => {
    if (method.id === 'sous-vide') {
      return estimateCarryover({
        methodId: selection.methodId,
        pullTempF: rawEndTemp ?? 125,
        thicknessInches: selection.thicknessInches,
        restMinutes: Math.max(restMinutes, 4),
        categoryId: selection.categoryId,
        ambientTempF,
      });
    }
    const { deltaF } = estimateCarryover({
      methodId: selection.methodId,
      pullTempF: rawPullTemp ?? 125,
      thicknessInches: selection.thicknessInches,
      restMinutes: Math.max(restMinutes, 4),
      categoryId: selection.categoryId,
      ambientTempF,
    });
    const adjustedPull = rawEndTemp != null ? Math.round(rawEndTemp - deltaF) : (rawPullTemp ?? 125);
    return estimateCarryover({
      methodId: selection.methodId,
      pullTempF: adjustedPull,
      thicknessInches: selection.thicknessInches,
      restMinutes: Math.max(restMinutes, 4),
      categoryId: selection.categoryId,
      ambientTempF,
    });
  }, [selection.methodId, selection.categoryId, rawPullTemp, rawEndTemp, selection.thicknessInches, restMinutes, method.id, ambientTempF]);

  // For sous vide: pull = bath = target. For others: pull = endTemp − carryover.
  const displayPullTemp = method.id === 'sous-vide'
    ? (doneness?.sousVideTemp ?? rawEndTemp)
    : rawEndTemp != null ? Math.round(rawEndTemp - co.deltaF) : rawPullTemp;

  // Resolve endTempRange for chart target zone band
  const rawEndTempRange = doneness
    ? (doneness.endTemp != null && typeof doneness.endTemp === 'object'
        ? [doneness.endTemp.min, doneness.endTemp.max]
        : null)
    : (Array.isArray(item.endTempRange) ? item.endTempRange : null);

  const status = getCookStatus(currentTemp, displayPullTemp, rawEndTemp);
  const shouldPull = currentTemp !== null && currentTemp >= displayPullTemp;

  // ── "If pulled now" live preview ────────────────────────────────────────
  // Recalculates carryover using current temp as the hypothetical pull temp.
  // When probe is connected in Normal mode, uses the full T_core→T_surface gradient
  // to run a finite-difference simulation — highest fidelity prediction.
  // Falls back to overrideSurfaceTempF (single surface sensor) or empirical model.
  // Wrapped in useMemo so the FD simulation (~2ms) doesn't re-run on every render.
  const pullNowPreview = useMemo(() => {
    if (method.id === 'sous-vide' || currentTemp == null) return null;

    // Full sensor gradient: slice from virtual core to virtual surface (inclusive).
    // Only available in Normal mode with full 8-sensor data.
    const liveGradient = (
      isConnected &&
      !thermo.isInstantRead &&
      thermo.sensors != null &&
      thermo.sensors.length >= 2 &&
      thermo.virtualSurfaceIndex != null
    ) ? thermo.sensors.slice(thermo.virtualCoreIndex, thermo.virtualSurfaceIndex + 1)
      : null;

    // surfaceTemp is null in Instant Read mode (hook handles this); used as fallback
    const liveSurfaceTemp = isConnected ? thermo.surfaceTemp : null;

    const preview = estimateCarryover({
      methodId: selection.methodId,
      pullTempF: currentTemp,
      thicknessInches: selection.thicknessInches,
      restMinutes: Math.max(restMinutes, 4),
      categoryId: selection.categoryId,
      overrideSurfaceTempF: liveSurfaceTemp,   // used only if liveGradient is null
      sensorGradientF: liveGradient,            // triggers FD when available
      ambientTempF,
    });

    const projectedPeak   = Math.round((currentTemp + preview.deltaF) * 10) / 10;
    const deltaFromTarget = rawEndTemp != null ? Math.round((projectedPeak - rawEndTemp) * 10) / 10 : null;
    const surfaceSource   = liveGradient   != null ? 'finite-diff'
                          : liveSurfaceTemp != null ? 'measured'
                          : 'modeled';

    // Verdict based on delta from target
    let verdict, verdictColor, verdictIcon;
    if (deltaFromTarget == null) {
      verdict = 'No target set'; verdictColor = 'var(--text-tertiary)'; verdictIcon = '—';
    } else if (deltaFromTarget > 5) {
      verdict = `Overshoot — ${deltaFromTarget}°F past target`; verdictColor = '#ff4b4b'; verdictIcon = '⚠️';
    } else if (deltaFromTarget >= -2) {
      verdict = 'On target — pull now!'; verdictColor = '#4cde80'; verdictIcon = '✅';
    } else if (deltaFromTarget >= -7) {
      verdict = `Almost there — ${Math.abs(deltaFromTarget)}°F away`; verdictColor = '#f5a623'; verdictIcon = '⚡';
    } else {
      verdict = `Keep cooking — ${Math.abs(deltaFromTarget)}°F below target`; verdictColor = 'var(--text-secondary)'; verdictIcon = '⏳';
    }

    return { preview, projectedPeak, deltaFromTarget, verdict, verdictColor, verdictIcon, surfaceSource, liveSurfaceTemp, liveGradient };
  }, [
    method.id, currentTemp, selection.methodId, selection.categoryId,
    selection.thicknessInches, restMinutes, rawEndTemp,
    thermo.surfaceTemp, thermo.sensors, thermo.virtualCoreIndex,
    thermo.virtualSurfaceIndex, thermo.isInstantRead, isConnected, ambientTempF,
  ]);

  const handlePull = () => {
    // Capture live probe readings at the exact moment of pull.
    // coreTemp and surfaceTemp use Combustion's Virtual Sensor IDs (byte 22) — not heuristics.
    // surfaceTemp is null in Instant Read mode, making actualSurfaceTempF null naturally.
    const hasFullSensors = isConnected && thermo.sensors?.length === 8 && !thermo.isInstantRead;
    navigate(SCREENS.REST, {
      thicknessInches: selection.thicknessInches,
      actualCoreTempF:    isConnected ? thermo.coreTemp    : null,
      actualSurfaceTempF: isConnected ? thermo.surfaceTemp : null,
      actualAmbientTempF: isConnected ? thermo.ambientTemp : null,
      sensorReadingsAtPull:      hasFullSensors ? [...thermo.sensors] : null,
      virtualCoreIndexAtPull:    hasFullSensors ? thermo.virtualCoreIndex    : null,
      virtualSurfaceIndexAtPull: hasFullSensors ? thermo.virtualSurfaceIndex : null,
    });
  };

  return (
    <div className="screen cook-screen" style={{ '--accent': category.accentColor }}>
      <div className="category-bg" style={{ background: category.gradient, opacity: 0.4 }} />

      <NavBar onBack={goBack} title={`${item.label}${doneness ? ` · ${doneness.level}` : ''}`} />

      {/* Thermometer connection bar */}
      <ThermoBar thermo={thermo} accentColor={category.accentColor} />

      <div style={{ height: 12 }} />

      {/* Temperature gauge */}
      <div className="cook-hero">
        <TempGauge
          currentTemp={currentTemp}
          pullTemp={displayPullTemp}
          endTemp={rawEndTemp}
          accentColor={category.accentColor}
          donenessColor={doneness?.color}
        />
      </div>

      {/* Manual temp input when not connected */}
      {!isConnected && (
        <div
          className={`manual-temp-input${shouldPull ? ' manual-temp-input--warning' : currentTemp !== null && currentTemp >= displayPullTemp - 5 ? ' manual-temp-input--near' : ''}`}
          style={{ margin: '0 20px 12px' }}
        >
          <label>Current temp</label>
          <input
            type="number"
            placeholder="Enter °F"
            value={manualTemp}
            onChange={e => setManualTemp(e.target.value)}
            inputMode="decimal"
          />
          <span className="unit">°F</span>
        </div>
      )}

      {/* Multi-sensor probe display when connected */}
      {isConnected && thermo.sensors && (
        <div className="cook-card" style={{ margin: '0 20px 12px' }}>
          <div className="cook-card-header">
            <span className="cook-card-title">
              {thermo.isInstantRead
                ? 'Instant Read — T1 tip only'
                : `Probe Sensors — core: T${thermo.virtualCoreIndex + 1}`}
            </span>
            {thermo.isInstantRead && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#f5a623',
                background: 'rgba(245,166,35,0.12)', padding: '2px 8px',
                borderRadius: 20, border: '1px solid rgba(245,166,35,0.3)',
              }}>INSTANT</span>
            )}
          </div>
          <SensorBar
            sensors={thermo.sensors}
            accentColor={category.accentColor}
            virtualCoreIndex={thermo.virtualCoreIndex}
            virtualSurfaceIndex={thermo.virtualSurfaceIndex}
            virtualAmbientIndex={thermo.virtualAmbientIndex}
          />
        </div>
      )}

      {/* Cook progress chart with "If Pulled Now" projection */}
      <CookChart
        history={cookHistory.history}
        projectionProfile={pullNowPreview?.preview?.restProfile ?? null}
        currentCoreTemp={currentTemp}
        currentMinute={cookHistory.elapsedMin}
        pullTempF={displayPullTemp}
        endTempF={rawEndTemp}
        endTempRange={rawEndTempRange}
        accentColor={category.accentColor}
      />

      <div className="cook-cards">
        {/* Target temp — the user's goal, shown first */}
        <div className="cook-card">
          <div className="cook-card-header">
            <span className="cook-card-title">Target Final Temperature</span>
            <span className="cook-card-value">{endTempDisplay}</span>
          </div>
          {doneness?.notes && (
            <p style={{ fontSize: 12, color: 'rgba(240,240,240,0.5)', marginTop: 4, lineHeight: 1.5 }}>
              {doneness.notes}
            </p>
          )}
          {!doneness && item.notes && (
            <p style={{ fontSize: 12, color: 'rgba(240,240,240,0.5)', marginTop: 4, lineHeight: 1.5 }}>
              {item.notes}
            </p>
          )}
        </div>

        {/* Pull temp — the app's recommendation, derived from target */}
        <div className={`cook-card${shouldPull ? ' cook-card--warning' : ''}`}>
          <div className="cook-card-header">
            <span className="cook-card-title">Recommended Pull Temperature</span>
            <span className="cook-card-value" style={{ color: shouldPull ? '#ff6b4a' : category.accentColor }}>
              {displayPullTemp ? `${displayPullTemp}°F` : '—'}
            </span>
          </div>
          {method.id !== 'sous-vide' && (
            <div className="carryover-row">
              <span className="label">
                {displayPullTemp}°F + {co.deltaF}°F carryover = {endTempDisplay}
              </span>
            </div>
          )}
          {method.id === 'sous-vide' && (
            <div className="carryover-row">
              <span className="label">Bath temperature = target</span>
              <span className="val">No carryover</span>
            </div>
          )}
          {isBasting && (
            <div className="carryover-row">
              <span className="label" style={{ color: 'rgba(255,180,80,0.8)' }}>
                Basting/flip method — lower pull accounts for continuous surface heat
              </span>
            </div>
          )}
        </div>

        {/* Carryover details */}
        {method.id !== 'sous-vide' && (
          <div className="cook-card">
            <div className="cook-card-header">
              <span className="cook-card-title">Carryover Physics</span>
              <span className="cook-card-value" style={{ color: '#f5a623' }}>+{co.deltaF}°F</span>
            </div>
            <div className="carryover-row">
              <span className="label">Method</span>
              <span className="val">{method.label}</span>
            </div>
            <div className="carryover-row">
              <span className="label">
                Sub-surface gradient at pull{' '}
                {isConnected && thermo.surfaceTemp != null ? '🌡' : ''}
              </span>
              <span className="val">
                {isConnected && thermo.surfaceTemp != null
                  ? `${thermo.surfaceTemp.toFixed(1)}°F (probe)`
                  : `${co.surfaceTempAtPull}°F (est.)`}
              </span>
            </div>
            <div className="carryover-row">
              <span className="label">Thickness</span>
              <span className="val">{selection.thicknessInches}"</span>
            </div>
            <div className="carryover-row">
              <span className="label">Fourier number (Fo)</span>
              <span className="val">{co.fourier}</span>
            </div>
            <div className="carryover-row">
              <span className="label">Minutes to peak</span>
              <span className="val">~{co.minutesToPeak} min</span>
            </div>
          </div>
        )}

        {/* If pulled now — live projection */}
        {pullNowPreview && (
          <div className="cook-card pull-now-card">
            <div className="cook-card-header">
              <span className="cook-card-title">If Pulled Now</span>
              <span className="pull-now-verdict-badge" style={{ color: pullNowPreview.verdictColor }}>
                {pullNowPreview.verdictIcon} {pullNowPreview.verdict}
              </span>
            </div>

            {/* Hero: current → projected peak */}
            <div className="pull-now-hero">
              <div className="pull-now-hero-col">
                <div className="pull-now-hero-label">Core now</div>
                <div className="pull-now-hero-temp">{currentTemp?.toFixed(1)}°F</div>
              </div>
              <div className="pull-now-hero-arrow">+ {pullNowPreview.preview.deltaF}°F →</div>
              <div className="pull-now-hero-col">
                <div className="pull-now-hero-label">Projected peak</div>
                <div className="pull-now-hero-temp" style={{ color: pullNowPreview.verdictColor }}>
                  {pullNowPreview.projectedPeak}°F
                </div>
              </div>
            </div>

            {/* Detail rows */}
            {rawEndTemp != null && (
              <div className="carryover-row">
                <span className="label">vs Target final</span>
                <span className="val" style={{ color: pullNowPreview.verdictColor }}>
                  {pullNowPreview.deltaFromTarget > 0 ? '+' : ''}{pullNowPreview.deltaFromTarget}°F ({endTempDisplay})
                </span>
              </div>
            )}
            <div className="carryover-row">
              <span className="label">
                Surface gradient{' '}
                {pullNowPreview.surfaceSource === 'finite-diff' ? '🔬'
                  : pullNowPreview.surfaceSource === 'measured' ? '🌡'
                  : '(modeled)'}
              </span>
              <span className="val">
                {pullNowPreview.surfaceSource === 'finite-diff'
                  ? `${pullNowPreview.preview.surfaceGradientF}°F (${pullNowPreview.liveGradient?.length}-sensor FD)`
                  : pullNowPreview.liveSurfaceTemp != null
                    ? `${pullNowPreview.liveSurfaceTemp.toFixed(1)}°F (probe)`
                    : `${pullNowPreview.preview.surfaceTempAtPull}°F (est.)`
                }
              </span>
            </div>
            <div className="carryover-row">
              <span className="label">Fourier Fo</span>
              <span className="val">
                {pullNowPreview.preview.fourier != null
                  ? pullNowPreview.preview.fourier
                  : 'N/A (FD sim)'}
              </span>
            </div>
            <div className="carryover-row">
              <span className="label">Ambient {isConnected && thermo.ambientTemp != null ? '🌡' : '(assumed)'}</span>
              <span className="val">
                {isConnected && thermo.ambientTemp != null
                  ? `${thermo.ambientTemp.toFixed(1)}°F (probe)`
                  : '72°F (room temp)'}
              </span>
            </div>

            {/* Overshoot recovery tip */}
            {pullNowPreview.deltaFromTarget > 5 && (
              <div className="pull-now-overshoot-tip">
                <span className="pull-now-overshoot-icon">💡</span>
                <span>
                  <strong>Recovery tip:</strong> Slice or carve the meat sooner than usual and skip the full rest.
                  Cutting opens the interior and releases heat rapidly — this effectively halts carryover and
                  prevents the center from climbing further.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Method tip */}
        {method.tip && (
          <div className="notes-block">
            <strong>Tip — {method.label}:</strong> {method.tip}
          </div>
        )}

        {/* Wrap temp for brisket/shoulder */}
        {item.wrapTemp && (
          <div className="wrap-card">
            <span>🌯</span>
            <div>
              <span>Wrap at </span>
              <strong>{item.wrapTemp.min}–{item.wrapTemp.max}°F</strong>
              <br />
              <span style={{ fontSize: 12, color: 'rgba(240,240,240,0.4)' }}>
                When fat is visibly bubbling and rendering
              </span>
            </div>
          </div>
        )}

        {/* Rest time preview */}
        <div className="cook-card">
          <div className="cook-card-header">
            <span className="cook-card-title">Rest Time</span>
            <span className="cook-card-value">
              {Array.isArray(item.restRangeMinutes)
                ? `${item.restRangeMinutes[0]}–${item.restRangeMinutes[1]} min`
                : restMinutes === 0
                  ? 'Serve immediately'
                  : `${restMinutes} min`
              }
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(240,240,240,0.5)' }}>
            {restMinutes === 0
              ? (selection.categoryId === 'seafood'
                  ? 'Seafood is best plated and eaten immediately off the pan.'
                  : 'No rest needed — serve right away.')
              : `After you pull, rest uncovered on a wire rack or cutting board.${isBasting ? ' The basting method uses a longer rest.' : ''}`
            }
          </p>
        </div>
      </div>

      {/* Pull alert or CTA */}
      {shouldPull ? (
        <div className="pull-alert" style={{ margin: '0 20px 20px' }}>
          <span>🚨</span>
          <div>
            <p>Pull now! {currentTemp?.toFixed(1)}°F reached</p>
            <p style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              Carryover will carry it to {endTempDisplay}
            </p>
          </div>
        </div>
      ) : null}

      <button
        className="action-btn --primary mb-16"
        style={{ background: category.accentColor }}
        onClick={handlePull}
      >
        I pulled it — start rest timer →
      </button>

      <div className="pb-safe" />
    </div>
  );
}

// ── Sensor Bar ──────────────────────────────────────────────────────────────
function SensorBar({ sensors, accentColor, virtualCoreIndex, virtualSurfaceIndex, virtualAmbientIndex }) {
  if (!sensors || sensors.length === 0) return null;

  const minTemp = Math.min(...sensors);
  const maxTemp = Math.max(...sensors);
  const range = Math.max(maxTemp - minTemp, 10);

  return (
    <>
      <div className="sensor-bar">
        {sensors.map((temp, i) => {
          const heightPct = 20 + ((temp - minTemp) / range) * 80;
          const normalized = (temp - minTemp) / range;
          const r = Math.round(60 + normalized * 180);
          const g = Math.round(120 - normalized * 80);
          const b = Math.round(200 - normalized * 180);
          const bg = `rgb(${r},${g},${b})`;
          const isCore    = i === virtualCoreIndex;
          const isSurface = i === virtualSurfaceIndex;
          const isAmbient = i === virtualAmbientIndex;

          return (
            <div
              key={i}
              className={`sensor-pip${isCore ? ' sensor-pip--core' : isSurface ? ' sensor-pip--surface' : ''}`}
              style={{ height: `${heightPct}%`, background: bg, minHeight: 24 }}
            >
              {Math.round(temp)}
            </div>
          );
        })}
      </div>
      <div className="sensor-label-row">
        {sensors.map((_, i) => {
          const isCore    = i === virtualCoreIndex;
          const isSurface = i === virtualSurfaceIndex;
          const isAmbient = i === virtualAmbientIndex;
          return (
            <span key={i} style={{
              color: isCore ? '#4cde80' : isSurface ? '#f5a623' : isAmbient ? '#66bbff' : undefined,
              fontWeight: isCore || isSurface ? 700 : 400,
            }}>
              {isCore ? '●' : isSurface ? '○' : ''}T{i + 1}
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(240,240,240,0.35)', marginTop: 4, display: 'flex', gap: 10 }}>
        {virtualCoreIndex != null    && <span><span style={{ color: '#4cde80' }}>●</span> core (T{virtualCoreIndex + 1})</span>}
        {virtualSurfaceIndex != null && <span><span style={{ color: '#f5a623' }}>○</span> surface (T{virtualSurfaceIndex + 1})</span>}
        {virtualAmbientIndex != null && <span><span style={{ color: '#66bbff' }}>· </span>ambient (T{virtualAmbientIndex + 1})</span>}
      </div>
    </>
  );
}
