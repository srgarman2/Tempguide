/**
 * SVG chart showing cook temperature history with a dotted "If Pulled Now"
 * carryover projection. Follows the same visual language as CarryoverChart.jsx.
 *
 * Renders:
 *  - Solid accent line:  core temp over cook time
 *  - Thinner amber line: surface temp (when probe connected)
 *  - Dotted white line:  projected carryover if pulled at current moment
 *  - Horizontal dashed:  pull temp (amber) and end temp (accent)
 *  - Shaded band:        target end temp range (when endTempRange exists)
 *  - White dot:          current reading
 */

import { useMemo } from 'react';

const W = 320;
const H = 140;
const PAD = { top: 14, right: 14, bottom: 22, left: 36 };

export default function CookChart({
  history,            // [{minute, coreTemp, surfaceTemp}]
  projectionProfile,  // [{minute, tempF}] from pullNowPreview.preview.restProfile
  currentCoreTemp,    // current live core reading (°F)
  currentMinute,      // elapsed minutes into the cook
  pullTempF,          // recommended pull temp (horizontal dashed line)
  endTempF,           // target end temp
  endTempRange,       // [min, max] array if applicable (shaded band)
  accentColor = '#c41e3a',
}) {
  // Need at least 2 data points to draw a line
  if (!history || history.length < 2) return null;

  // ── Build projection data in chart coordinates ───────────────────────
  // projectionProfile minutes are relative to rest start (0 = pull moment).
  // Offset by currentMinute so the projection extends rightward from "now".
  const projection = useMemo(() => {
    if (!projectionProfile || projectionProfile.length === 0) return [];
    return projectionProfile.map(p => ({
      minute: currentMinute + p.minute,
      tempF: p.tempF,
    }));
  }, [projectionProfile, currentMinute]);

  // ── Auto-scale axes ──────────────────────────────────────────────────
  const maxHistoryMin = history[history.length - 1].minute;
  const maxProjectionMin = projection.length > 0
    ? projection[projection.length - 1].minute
    : 0;

  // X-axis: round up to nearest 5 minutes, minimum 10
  const displayMinutes = useMemo(() => {
    const maxMin = Math.max(maxHistoryMin, maxProjectionMin);
    return Math.max(10, Math.ceil(maxMin / 5) * 5 + 5);
  }, [maxHistoryMin, maxProjectionMin]);

  // Y-axis: gather all temps to find bounds
  const { tempMin, tempMax } = useMemo(() => {
    const temps = history.map(p => p.coreTemp);
    // Include surface temps
    history.forEach(p => { if (p.surfaceTemp != null) temps.push(p.surfaceTemp); });
    // Include projection temps
    if (projection.length > 0) projection.forEach(p => temps.push(p.tempF));
    // Include reference lines
    if (pullTempF != null) temps.push(pullTempF);
    if (endTempF != null) temps.push(endTempF);
    if (endTempRange) { temps.push(endTempRange[0]); temps.push(endTempRange[1]); }
    if (currentCoreTemp != null) temps.push(currentCoreTemp);
    return {
      tempMin: Math.min(...temps) - 8,
      tempMax: Math.max(...temps) + 8,
    };
  }, [history, projection, pullTempF, endTempF, endTempRange, currentCoreTemp]);

  const tempRange = tempMax - tempMin;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xScale = (minute) => PAD.left + (minute / displayMinutes) * innerW;
  const yScale = (temp) => PAD.top + innerH - ((temp - tempMin) / tempRange) * innerH;

  // ── Core temp path (solid accent line) ───────────────────────────────
  const corePath = useMemo(() => {
    return history
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xScale(p.minute).toFixed(1)} ${yScale(p.coreTemp).toFixed(1)}`
      )
      .join(' ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, displayMinutes, tempMin, tempRange]);

  // Fill area under core line
  const coreFillPath = useMemo(() => {
    if (!corePath || history.length === 0) return '';
    const last = history[history.length - 1];
    return corePath
      + ` L ${xScale(last.minute).toFixed(1)} ${yScale(tempMin).toFixed(1)}`
      + ` L ${PAD.left} ${yScale(tempMin).toFixed(1)} Z`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corePath, history, tempMin, displayMinutes]);

  // ── Surface temp path (thinner amber) ────────────────────────────────
  const surfacePath = useMemo(() => {
    const withSurface = history.filter(p => p.surfaceTemp != null);
    if (withSurface.length < 2) return null;
    return withSurface
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xScale(p.minute).toFixed(1)} ${yScale(p.surfaceTemp).toFixed(1)}`
      )
      .join(' ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, displayMinutes, tempMin, tempRange]);

  // ── Projection path (dotted from current point forward) ──────────────
  const projPath = useMemo(() => {
    if (projection.length === 0 || currentCoreTemp == null) return null;
    const startPoint = `M ${xScale(currentMinute).toFixed(1)} ${yScale(currentCoreTemp).toFixed(1)}`;
    const linePoints = projection
      .map(p => `L ${xScale(p.minute).toFixed(1)} ${yScale(p.tempF).toFixed(1)}`)
      .join(' ');
    return startPoint + ' ' + linePoints;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, currentMinute, currentCoreTemp, displayMinutes, tempMin, tempRange]);

  // ── Projection peak (for label) ─────────────────────────────────────
  const projPeak = useMemo(() => {
    if (projection.length === 0) return null;
    return projection.reduce((max, p) => p.tempF > max.tempF ? p : max, projection[0]);
  }, [projection]);

  // ── Reference positions ──────────────────────────────────────────────
  const currentX = xScale(currentMinute);
  const currentY = currentCoreTemp != null ? yScale(currentCoreTemp) : null;
  const pullY = pullTempF != null ? yScale(pullTempF) : null;
  const endY = endTempF != null ? yScale(endTempF) : null;

  // Target zone band
  const hasRange = Array.isArray(endTempRange) && endTempRange.length === 2;
  const rangeY0 = hasRange ? yScale(endTempRange[1]) : null; // higher temp → lower Y
  const rangeY1 = hasRange ? yScale(endTempRange[0]) : null;

  // ── Axis labels ──────────────────────────────────────────────────────
  const xLabels = useMemo(() => {
    const step = displayMinutes <= 20 ? 5 : displayMinutes <= 60 ? 10 : 30;
    const labels = [0];
    for (let m = step; m <= displayMinutes; m += step) labels.push(m);
    return labels;
  }, [displayMinutes]);

  const yLabels = useMemo(() => {
    const labels = [];
    if (pullTempF != null) labels.push(pullTempF);
    if (endTempF != null && Math.abs(endTempF - (pullTempF ?? 0)) > 3) labels.push(endTempF);
    return labels.filter(t => t >= tempMin && t <= tempMax);
  }, [pullTempF, endTempF, tempMin, tempMax]);

  return (
    <div className="cook-chart">
      <div className="cook-chart-title">Cook Progress</div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <linearGradient id="cookFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.20" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="cookClip">
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH + 1} />
          </clipPath>
        </defs>

        {/* Target zone band */}
        {hasRange && (
          <rect
            x={PAD.left} y={rangeY0}
            width={innerW}
            height={rangeY1 - rangeY0}
            fill={accentColor}
            fillOpacity="0.08"
            clipPath="url(#cookClip)"
          />
        )}

        {/* Pull temp dashed line */}
        {pullY != null && (
          <line
            x1={PAD.left} y1={pullY}
            x2={PAD.left + innerW} y2={pullY}
            stroke="rgba(255,180,60,0.4)"
            strokeWidth="1"
            strokeDasharray="4,4"
          />
        )}

        {/* End temp dashed line */}
        {endY != null && pullY != null && Math.abs(endY - pullY) > 3 && (
          <line
            x1={PAD.left} y1={endY}
            x2={PAD.left + innerW} y2={endY}
            stroke={accentColor}
            strokeWidth="1"
            strokeDasharray="4,4"
            strokeOpacity="0.4"
          />
        )}

        {/* Fill under core line */}
        {coreFillPath && (
          <path d={coreFillPath} fill="url(#cookFill)" clipPath="url(#cookClip)" />
        )}

        {/* Core temp solid line */}
        <path
          d={corePath}
          fill="none"
          stroke={accentColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath="url(#cookClip)"
        />

        {/* Surface temp line (thinner, amber) */}
        {surfacePath && (
          <path
            d={surfacePath}
            fill="none"
            stroke="rgba(245,166,35,0.4)"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath="url(#cookClip)"
          />
        )}

        {/* Projection dotted line — "If Pulled Now" carryover trajectory */}
        {projPath && (
          <path
            d={projPath}
            fill="none"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="1.5"
            strokeDasharray="3,4"
            strokeLinecap="round"
            clipPath="url(#cookClip)"
          />
        )}

        {/* Projection peak label */}
        {projPeak && projPeak.tempF > (currentCoreTemp ?? 0) + 1.5 && (
          <text
            x={Math.min(xScale(projPeak.minute), PAD.left + innerW - 40)}
            y={yScale(projPeak.tempF) - 7}
            textAnchor="middle"
            fill="rgba(255,255,255,0.45)"
            fontSize="8"
            fontWeight="600"
            fontFamily="Inter, sans-serif"
          >
            if pulled now → {Math.round(projPeak.tempF)}°
          </text>
        )}

        {/* Pull temp Y-axis label */}
        {pullY != null && (
          <text
            x={PAD.left + innerW + 2}
            y={pullY}
            textAnchor="start"
            dominantBaseline="middle"
            fill="rgba(255,180,60,0.5)"
            fontSize="8"
            fontFamily="Inter, sans-serif"
          >
            pull
          </text>
        )}

        {/* Current temp dot */}
        {currentY != null && (
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
        {xLabels.map(m => (
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
      </svg>
    </div>
  );
}
