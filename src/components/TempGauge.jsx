/**
 * SVG Arc Temperature Gauge — Joule-inspired
 * Displays current temp vs pull target with a radial arc.
 */

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 88;
const STROKE = 10;
const START_DEG = 220;
const END_DEG = 500; // 280° sweep
const SWEEP = END_DEG - START_DEG;

function polarToXY(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx, cy, r, startDeg, endDeg) {
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

export default function TempGauge({
  currentTemp,
  pullTemp,
  endTemp,
  accentColor = '#c41e3a',
  donenessColor,
}) {
  // Temperature range to display: floor at pullTemp - 80, ceiling at pullTemp + 20
  const low  = (pullTemp ?? 100) - 80;
  const high = (pullTemp ?? 100) + 25;
  const range = high - low;

  // Map a temp to degrees around the arc
  const tempToDeg = (temp) => {
    const frac = Math.max(0, Math.min(1, (temp - low) / range));
    return START_DEG + frac * SWEEP;
  };

  const pullDeg = pullTemp != null ? tempToDeg(pullTemp) : END_DEG;
  const currentDeg = currentTemp != null ? tempToDeg(currentTemp) : null;
  const endDeg = endTemp != null ? tempToDeg(endTemp) : null;

  const hasTemp = currentTemp != null;
  const atPull  = hasTemp && currentTemp >= pullTemp;

  // Colors
  const trackColor      = 'rgba(255,255,255,0.08)';
  const pullZoneColor   = `${accentColor}40`;
  const progressColor   = donenessColor ?? accentColor;
  const needleColor     = atPull ? '#4cde80' : (donenessColor ?? accentColor);

  return (
    <div className="temp-gauge-wrap" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track (full arc) */}
        <path
          d={describeArc(CX, CY, R, START_DEG, END_DEG)}
          stroke={trackColor}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
        />

        {/* Pull zone (pull → end temp) */}
        {endDeg != null && (
          <path
            d={describeArc(CX, CY, R, pullDeg, Math.min(endDeg, END_DEG))}
            stroke={pullZoneColor}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* Progress arc (low → current) */}
        {currentDeg != null && (
          <path
            d={describeArc(CX, CY, R, START_DEG, currentDeg)}
            stroke={progressColor}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            style={{ transition: 'd 0.5s ease, stroke 0.3s' }}
          />
        )}

        {/* Pull temp marker */}
        {pullTemp != null && (() => {
          const pt = polarToXY(CX, CY, R, pullDeg);
          return (
            <circle
              cx={pt.x}
              cy={pt.y}
              r={7}
              fill={accentColor}
              stroke="#0a0a0a"
              strokeWidth={2}
            />
          );
        })()}

        {/* Pull temp label */}
        {pullTemp != null && (() => {
          const pt = polarToXY(CX, CY, R + 22, pullDeg);
          return (
            <text
              x={pt.x}
              y={pt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={accentColor}
              fontSize="11"
              fontWeight="700"
              fontFamily="Inter, system-ui, sans-serif"
            >
              {Math.round(pullTemp)}°
            </text>
          );
        })()}

        {/* Current temp needle */}
        {currentDeg != null && (() => {
          const pt = polarToXY(CX, CY, R, currentDeg);
          return (
            <circle
              cx={pt.x}
              cy={pt.y}
              r={9}
              fill={needleColor}
              stroke="#0a0a0a"
              strokeWidth={3}
              style={{ transition: 'cx 0.5s ease, cy 0.5s ease, fill 0.3s' }}
            />
          );
        })()}
      </svg>

      {/* Center readout */}
      <div className="temp-gauge-center">
        {hasTemp ? (
          <>
            <div
              className={`gauge-temp ${atPull ? '--connected' : '--manual'}`}
              style={{ color: hasTemp ? (atPull ? '#4cde80' : progressColor) : undefined }}
            >
              {currentTemp.toFixed(1)}
            </div>
            <div className="gauge-unit">°F</div>
            <div className="gauge-label">{atPull ? 'Pull now!' : 'current'}</div>
          </>
        ) : (
          <>
            <div className="gauge-temp --waiting">—</div>
            <div className="gauge-unit">°F</div>
            <div className="gauge-label">no probe</div>
          </>
        )}
      </div>
    </div>
  );
}
