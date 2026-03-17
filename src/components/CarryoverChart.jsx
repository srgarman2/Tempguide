/**
 * SVG sparkline chart showing predicted carryover temperature profile
 * over the rest period. Displays pull temp baseline, peak, and target zone.
 */

const W = 320;
const H = 100;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

export default function CarryoverChart({
  profile,
  pullTempF,
  endTempF,
  peakTempF,
  currentMinute = 0,
  accentColor = '#c41e3a',
  restMinutes = 10,
}) {
  if (!profile || profile.length < 2) return null;

  // Display up to 30 minutes or restMinutes+15, whichever is larger
  const displayMinutes = Math.max(restMinutes + 10, 20);
  const visibleProfile = profile.filter(p => p.minute <= displayMinutes);

  const tempMin = Math.min(pullTempF - 5, ...visibleProfile.map(p => p.tempF));
  const tempMax = Math.max(peakTempF + 5, endTempF + 3, ...visibleProfile.map(p => p.tempF));
  const tempRange = tempMax - tempMin;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xScale = (minute) => PAD.left + (minute / displayMinutes) * innerW;
  const yScale = (temp) => PAD.top + innerH - ((temp - tempMin) / tempRange) * innerH;

  // Build SVG path
  const pathD = visibleProfile
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.minute).toFixed(1)} ${yScale(p.tempF).toFixed(1)}`)
    .join(' ');

  // Fill area
  const fillD = pathD
    + ` L ${xScale(visibleProfile[visibleProfile.length - 1].minute).toFixed(1)} ${yScale(tempMin).toFixed(1)}`
    + ` L ${PAD.left} ${yScale(tempMin).toFixed(1)} Z`;

  // Current time marker
  const currentX = xScale(Math.min(currentMinute, displayMinutes));
  const currentProfile = visibleProfile.find(p => p.minute >= Math.floor(currentMinute));
  const currentY = currentProfile ? yScale(currentProfile.tempF) : null;

  // Temp reference lines
  const pullY  = yScale(pullTempF);
  const endY   = yScale(endTempF);
  const peakY  = yScale(peakTempF);

  // Y-axis labels
  const yLabels = [pullTempF, endTempF, peakTempF]
    .filter((v, i, arr) => arr.indexOf(v) === i && v >= tempMin && v <= tempMax);

  return (
    <div className="carryover-chart">
      <div className="carryover-chart-title">Temperature Over Rest</div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="chartClip">
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH + 1} />
          </clipPath>
        </defs>

        {/* Pull temp baseline */}
        <line
          x1={PAD.left} y1={pullY}
          x2={PAD.left + innerW} y2={pullY}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
          strokeDasharray="4,4"
        />

        {/* End temp zone */}
        {Math.abs(endY - pullY) > 3 && (
          <line
            x1={PAD.left} y1={endY}
            x2={PAD.left + innerW} y2={endY}
            stroke={accentColor}
            strokeWidth="1"
            strokeDasharray="4,4"
            strokeOpacity="0.4"
          />
        )}

        {/* Fill */}
        <path d={fillD} fill="url(#chartFill)" clipPath="url(#chartClip)" />

        {/* Main curve */}
        <path
          d={pathD}
          fill="none"
          stroke={accentColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath="url(#chartClip)"
        />

        {/* Current time vertical line */}
        {currentMinute > 0 && (
          <line
            x1={currentX} y1={PAD.top}
            x2={currentX} y2={PAD.top + innerH}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="1.5"
          />
        )}

        {/* Current temp dot */}
        {currentY != null && currentMinute > 0 && (
          <circle
            cx={currentX}
            cy={currentY}
            r={4}
            fill="white"
            stroke={accentColor}
            strokeWidth="2"
          />
        )}

        {/* Y-axis labels */}
        {yLabels.map(temp => (
          <text
            key={temp}
            x={PAD.left - 4}
            y={yScale(temp)}
            textAnchor="end"
            dominantBaseline="middle"
            fill="rgba(240,240,240,0.4)"
            fontSize="9"
            fontFamily="Inter, sans-serif"
          >
            {Math.round(temp)}°
          </text>
        ))}

        {/* X-axis labels */}
        {[0, Math.round(displayMinutes / 2), displayMinutes].map(m => (
          <text
            key={m}
            x={xScale(m)}
            y={H - 4}
            textAnchor="middle"
            fill="rgba(240,240,240,0.35)"
            fontSize="9"
            fontFamily="Inter, sans-serif"
          >
            {m}m
          </text>
        ))}

        {/* Peak label */}
        {peakTempF > pullTempF + 2 && (
          <text
            x={xScale(visibleProfile.findIndex(p => p.tempF >= peakTempF - 0.5))}
            y={peakY - 8}
            textAnchor="middle"
            fill={accentColor}
            fontSize="9"
            fontWeight="700"
            fontFamily="Inter, sans-serif"
          >
            peak {peakTempF.toFixed(1)}°
          </text>
        )}
      </svg>
    </div>
  );
}
