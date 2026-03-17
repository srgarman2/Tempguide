import { useState, useMemo } from 'react';
import { getCategoryById, getItemById, getMethodById } from '../data/temperatures';
import { estimateCarryover, formatTemp, getCookStatus } from '../utils/carryover';
import { THERMOMETER_STATE } from '../hooks/useThermometer';
import NavBar from './NavBar';
import TempGauge from './TempGauge';
import ThermoBar from './ThermoBar';

export default function CookScreen({ selection, thermo, navigate, goBack, SCREENS }) {
  const [manualTemp, setManualTemp] = useState('');

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

  // Carryover calculation — deltaF is independent of pullTempF (surface gradient = excess),
  // so we derive the adjusted pull temp from endTemp − deltaF ensuring pull + carryover = target.
  const co = useMemo(() => {
    if (method.id === 'sous-vide') {
      return estimateCarryover({
        methodId: selection.methodId,
        pullTempF: rawEndTemp ?? 125,
        thicknessInches: selection.thicknessInches,
        restMinutes: Math.max(restMinutes, 4),
      });
    }
    const { deltaF } = estimateCarryover({
      methodId: selection.methodId,
      pullTempF: rawPullTemp ?? 125,
      thicknessInches: selection.thicknessInches,
      restMinutes: Math.max(restMinutes, 4),
    });
    const adjustedPull = rawEndTemp != null ? Math.round(rawEndTemp - deltaF) : (rawPullTemp ?? 125);
    return estimateCarryover({
      methodId: selection.methodId,
      pullTempF: adjustedPull,
      thicknessInches: selection.thicknessInches,
      restMinutes: Math.max(restMinutes, 4),
    });
  }, [selection.methodId, rawPullTemp, rawEndTemp, selection.thicknessInches, restMinutes, method.id]);

  // For sous vide: pull = bath = target. For others: pull = endTemp − carryover.
  const displayPullTemp = method.id === 'sous-vide'
    ? (doneness?.sousVideTemp ?? rawEndTemp)
    : rawEndTemp != null ? Math.round(rawEndTemp - co.deltaF) : rawPullTemp;

  // Determine current temp: BLE if connected, else manual input
  const isConnected = thermo.state === THERMOMETER_STATE.CONNECTED;
  const currentTemp = isConnected
    ? thermo.coreTemp
    : (manualTemp !== '' ? parseFloat(manualTemp) : null);

  const status = getCookStatus(currentTemp, displayPullTemp, rawEndTemp);
  const shouldPull = currentTemp !== null && currentTemp >= displayPullTemp;

  const handlePull = () => {
    navigate(SCREENS.REST, { thicknessInches: selection.thicknessInches });
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
        <div className="manual-temp-input" style={{ margin: '0 20px 12px' }}>
          <label>Enter temp manually</label>
          <input
            type="number"
            placeholder="—"
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
            <span className="cook-card-title">Probe Sensors (T1=tip → T8=handle)</span>
          </div>
          <SensorBar sensors={thermo.sensors} accentColor={category.accentColor} />
        </div>
      )}

      <div className="cook-cards">
        {/* Pull temp */}
        <div className="cook-card">
          <div className="cook-card-header">
            <span className="cook-card-title">Pull Temperature</span>
            <span className="cook-card-value" style={{ color: category.accentColor }}>
              {displayPullTemp ? `${displayPullTemp}°F` : '—'}
            </span>
          </div>
          {method.id !== 'sous-vide' && (
            <div className="carryover-row">
              <span className="label">Carryover (+{co.deltaF}°F)</span>
              <span className="val">→ {endTempDisplay} final</span>
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
                Basting/flip method — lower pull temp accounts for continuous surface heat
              </span>
            </div>
          )}
        </div>

        {/* Target temp */}
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
              <span className="label">Est. surface temp at pull</span>
              <span className="val">{co.surfaceTempAtPull}°F</span>
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
function SensorBar({ sensors, accentColor }) {
  if (!sensors || sensors.length === 0) return null;

  const minTemp = Math.min(...sensors);
  const maxTemp = Math.max(...sensors);
  const range = Math.max(maxTemp - minTemp, 10);

  return (
    <>
      <div className="sensor-bar">
        {sensors.map((temp, i) => {
          const heightPct = 20 + ((temp - minTemp) / range) * 80;
          // Color: cold = blue-ish, hot = red/orange
          const normalized = (temp - minTemp) / range;
          const r = Math.round(60 + normalized * 180);
          const g = Math.round(120 - normalized * 80);
          const b = Math.round(200 - normalized * 180);
          const bg = `rgb(${r},${g},${b})`;

          return (
            <div
              key={i}
              className="sensor-pip"
              style={{ height: `${heightPct}%`, background: bg, minHeight: 24 }}
            >
              {Math.round(temp)}
            </div>
          );
        })}
      </div>
      <div className="sensor-label-row">
        {sensors.map((_, i) => (
          <span key={i}>T{i + 1}</span>
        ))}
      </div>
    </>
  );
}
