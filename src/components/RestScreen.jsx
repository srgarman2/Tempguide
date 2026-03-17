import { useMemo } from 'react';
import { getCategoryById, getItemById, getMethodById } from '../data/temperatures';
import { estimateCarryover } from '../utils/carryover';
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

  const timer = useRestTimer({
    methodId: selection.methodId,
    pullTempF,
    endTempF,
    restMinutes,
    thicknessInches: selection.thicknessInches,
    categoryId: selection.categoryId,
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

      {/* Live carryover estimate */}
      <div className="cook-card" style={{ margin: '0 20px 12px', position: 'relative', zIndex: 1 }}>
        <div className="cook-card-header">
          <span className="cook-card-title">Carryover Tracking</span>
          <span className="cook-card-value" style={{ color: '#f5a623' }}>
            ~{timer.estimatedCurrentTempF}°F
          </span>
        </div>
        <div className="carryover-row">
          <span className="label">Pull temp</span>
          <span className="val">{timer.adjustedPullTempF}°F</span>
        </div>
        <div className="carryover-row">
          <span className="label">Est. peak (+{carryover.deltaF}°F)</span>
          <span className="val" style={{ color: '#f5a623' }}>{carryover.peakTempF.toFixed(1)}°F</span>
        </div>
        <div className="carryover-row">
          <span className="label">Target final</span>
          <span className="val">{endTempDisplay}</span>
        </div>
        <div className="carryover-row">
          <span className="label">Minutes to peak carryover</span>
          <span className="val">~{carryover.minutesToPeak} min</span>
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
