import { useState, useMemo } from 'react';
import { getCategoryById, getItemById, COOKING_METHODS } from '../data/temperatures';
import { estimateCarryover } from '../utils/carryover';
import NavBar from './NavBar';

// Thickness sample points for the chart (more points = smoother curves)
const CHART_THICKNESSES = [0.5, 0.625, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

// Slider label positions — must match actual slider range (0.5–3.0)
const SLIDER_LABELS = [
  { label: '½"', value: 0.5 },
  { label: '1"', value: 1.0 },
  { label: '1½"', value: 1.5 },
  { label: '2"', value: 2.0 },
  { label: '3"', value: 3.0 },
];

// Unique color per method so lines are distinguishable
const METHOD_COLORS = {
  'pan-sear':      '#ff6b4a',
  'basting-flip':  '#ffa040',
  'grill-high':    '#ff4444',
  'grill-medium':  '#ee8866',
  'reverse-sear':  '#4488ff',
  'oven-moderate': '#66bbff',
  'oven-high':     '#ff6688',
  'low-slow':      '#44ddaa',
  'smoker':        '#88ccaa',
  'sous-vide':     '#44eedd',
  'air-fryer':     '#aa88ff',
};

/** Small carryover-by-thickness chart rendered as inline SVG */
function CarryoverChart({ chartData, currentThickness, maxCarryover }) {
  // Chart dimensions (SVG viewBox coords — scales responsively)
  const W = 300, H = 120;
  const pad = { top: 6, right: 8, bottom: 20, left: 32 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  // Scales
  const xMin = 0.5, xMax = 3.0;
  const yMin = 0, yMax = Math.max(maxCarryover + 2, 12);
  const x = v => pad.left + ((v - xMin) / (xMax - xMin)) * cw;
  const y = v => pad.top + ch - ((v - yMin) / (yMax - yMin)) * ch;

  // Y-axis grid lines
  const yTicks = [];
  const yStep = yMax <= 15 ? 5 : 10;
  for (let t = 0; t <= yMax; t += yStep) yTicks.push(t);

  // X-axis ticks
  const xTicks = [0.5, 1.0, 1.5, 2.0, 3.0];

  // Current thickness line
  const cx = x(currentThickness);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Y grid lines + labels */}
      {yTicks.map(t => (
        <g key={`y-${t}`}>
          <line
            x1={pad.left} y1={y(t)} x2={W - pad.right} y2={y(t)}
            stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
          />
          <text x={pad.left - 4} y={y(t) + 3} textAnchor="end"
            fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="Inter, system-ui, sans-serif">
            {t}°
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {xTicks.map(t => (
        <text key={`x-${t}`} x={x(t)} y={H - 4} textAnchor="middle"
          fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="Inter, system-ui, sans-serif">
          {t === 0.5 ? '½"' : t === 1.5 ? '1½"' : `${t}"`}
        </text>
      ))}

      {/* Method lines */}
      {chartData.map(({ methodId, label, color, points }) => {
        const d = points
          .map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(pt.thickness).toFixed(1)},${y(pt.carryover).toFixed(1)}`)
          .join(' ');

        // Find the point at (or closest to) the current thickness for the dot
        let closest = points[0];
        let minDist = Infinity;
        for (const pt of points) {
          const dist = Math.abs(pt.thickness - currentThickness);
          if (dist < minDist) { minDist = dist; closest = pt; }
        }

        return (
          <g key={methodId}>
            {/* Line */}
            <path d={d} fill="none" stroke={color} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
            {/* Dot at current thickness */}
            <circle cx={x(closest.thickness)} cy={y(closest.carryover)}
              r={3} fill={color} opacity={0.9} />
          </g>
        );
      })}

      {/* Current thickness vertical indicator */}
      <line
        x1={cx} y1={pad.top} x2={cx} y2={pad.top + ch}
        stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3,3"
      />
    </svg>
  );
}

/** Legend row for the chart */
function ChartLegend({ chartData }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '6px 12px',
      marginTop: 6, padding: '0 2px',
    }}>
      {chartData.map(({ methodId, label, color }) => (
        <div key={methodId} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10, color: 'rgba(255,255,255,0.5)',
        }}>
          <span style={{
            width: 8, height: 3, borderRadius: 1,
            background: color, opacity: 0.8, flexShrink: 0,
          }} />
          {label}
        </div>
      ))}
    </div>
  );
}

export default function CookingMethodScreen({ selection, navigate, goBack, SCREENS }) {
  const [thickness, setThickness] = useState(selection.thicknessInches ?? 1.0);

  const category = getCategoryById(selection.categoryId);
  const item = getItemById(selection.categoryId, selection.itemId);
  if (!category || !item) return null;

  const doneness = item.hasDoneness && selection.donenessIndex != null
    ? item.doneness[selection.donenessIndex]
    : null;

  // Determine pull temp for carryover preview
  const pullTempF = doneness
    ? (doneness.pullTemp != null && typeof doneness.pullTemp === 'object' ? doneness.pullTemp.min : doneness.pullTemp) ?? 125
    : item.pullTemp ?? 140;

  const availableMethods = COOKING_METHODS.filter(m =>
    m.compatibleCategories.includes(selection.categoryId)
  );

  // Compute chart data: carryover at each thickness for each method
  const { chartData, maxCarryover } = useMemo(() => {
    let max = 0;
    const data = availableMethods
      .filter(m => m.appliesCarryover)
      .map(method => {
        const points = CHART_THICKNESSES.map(t => {
          const co = estimateCarryover({
            methodId: method.id,
            pullTempF,
            thicknessInches: t,
            restMinutes: 10,
            categoryId: selection.categoryId,
          });
          if (co.deltaF > max) max = co.deltaF;
          return { thickness: t, carryover: co.deltaF };
        });
        return {
          methodId: method.id,
          label: method.label,
          color: METHOD_COLORS[method.id] || '#888',
          points,
        };
      });
    return { chartData: data, maxCarryover: max };
  }, [pullTempF, selection.categoryId, availableMethods.length]);

  const handleProceed = (methodId) => {
    navigate(SCREENS.COOK, { methodId, thicknessInches: thickness });
  };

  return (
    <div className="screen method-screen" style={{ '--accent': category.accentColor }}>
      <div className="category-bg" style={{ background: category.gradient, opacity: 0.5 }} />

      <NavBar onBack={goBack} title="Cooking Method" />

      <div className="screen-header">
        <h2>How are you<br />cooking it?</h2>
        <p>Affects pull temp via carryover physics</p>
      </div>

      {/* Thickness selector — relevant for carryover */}
      {item.hasDoneness && (
        <div className="thickness-section">
          <h4>Thickness</h4>
          <div className="thickness-slider">
            <div className="thickness-value">{thickness.toFixed(1)}"</div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.25"
              value={thickness}
              onChange={e => setThickness(parseFloat(e.target.value))}
              style={{ accentColor: category.accentColor }}
            />
            {/* Labels positioned to match actual slider positions (0.5–3.0 range) */}
            <div className="thickness-labels" style={{ position: 'relative', height: 16 }}>
              {SLIDER_LABELS.map(({ label, value }) => (
                <span
                  key={value}
                  style={{
                    position: 'absolute',
                    left: `${((value - 0.5) / 2.5) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Carryover by thickness chart */}
          {chartData.length > 0 && (
            <div style={{
              marginTop: 12,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 10px 6px',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--text-tertiary)',
                marginBottom: 6,
              }}>
                Carryover by thickness
              </div>
              <CarryoverChart
                chartData={chartData}
                currentThickness={thickness}
                maxCarryover={maxCarryover}
              />
              <ChartLegend chartData={chartData} />
            </div>
          )}
        </div>
      )}

      <div className="method-grid">
        {availableMethods.map(method => {
          // Preview carryover for this method
          const co = estimateCarryover({
            methodId: method.id,
            pullTempF,
            thicknessInches: thickness,
            restMinutes: 10,
            categoryId: selection.categoryId,
          });

          return (
            <button
              key={method.id}
              className="method-card"
              onClick={() => handleProceed(method.id)}
            >
              <span className="method-icon">{method.icon}</span>
              <h3>{method.label}</h3>
              <p>{method.description}</p>
              <div className="method-carryover">
                {method.appliesCarryover
                  ? <>Carryover: <strong>+{co.deltaF}°F</strong></>
                  : <>Bath = target • No carryover</>
                }
                {method.usesBastingPullTemps && (
                  <> · <span style={{ color: 'rgba(255,180,80,0.8)' }}>Special pull temps</span></>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
