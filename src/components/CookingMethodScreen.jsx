import { useState } from 'react';
import { getCategoryById, getItemById, COOKING_METHODS } from '../data/temperatures';
import { estimateCarryover, GEOMETRY_TYPES } from '../utils/carryover';
import NavBar from './NavBar';

// Default slider label positions (0.5–3.0) — used when item has no custom range
const DEFAULT_SLIDER_LABELS = [
  { label: '½"', value: 0.5 },
  { label: '1"', value: 1.0 },
  { label: '1½"', value: 1.5 },
  { label: '2"', value: 2.0 },
  { label: '3"', value: 3.0 },
];

export default function CookingMethodScreen({ selection, navigate, goBack, SCREENS }) {
  const category = getCategoryById(selection.categoryId);
  const item = getItemById(selection.categoryId, selection.itemId);
  if (!category || !item) return null;

  // Item-driven slider range or defaults
  const sliderMin     = item.sliderMin     ?? 0.5;
  const sliderMax     = item.sliderMax     ?? 3.0;
  const sliderStep    = item.sliderStep    ?? 0.25;
  const sliderDefault = item.sliderDefault ?? 1.0;
  const sliderLabels  = item.sliderLabels  ?? DEFAULT_SLIDER_LABELS;

  const [thickness, setThickness] = useState(selection.thicknessInches ?? sliderDefault);
  const [geometry, setGeometry]   = useState(selection.geometry ?? (item.defaultGeometry ?? 'slab'));
  const [boneIn, setBoneIn]       = useState(selection.boneIn ?? false);
  const [isWrapped, setIsWrapped] = useState(selection.isWrapped ?? false);

  const doneness = item.hasDoneness && selection.donenessIndex != null
    ? item.doneness[selection.donenessIndex]
    : null;

  // Determine pull temp for carryover preview
  const pullTempF = doneness
    ? (doneness.pullTemp != null && typeof doneness.pullTemp === 'object' ? doneness.pullTemp.min : doneness.pullTemp) ?? 125
    : item.pullTemp ?? 140;

  // Use per-item compatibleMethods when defined (more granular),
  // fall back to category-level filter for any items that don't list them.
  const availableMethods = COOKING_METHODS.filter(m =>
    item.compatibleMethods
      ? item.compatibleMethods.includes(m.id)
      : m.compatibleCategories.includes(selection.categoryId)
  );

  const handleProceed = (methodId) => {
    navigate(SCREENS.COOK, { methodId, thicknessInches: thickness, geometry, boneIn, isWrapped });
  };

  const showGeometrySelector = !item.hasBoneInOption && (selection.categoryId === 'beef' || selection.categoryId === 'pork');

  return (
    <div className="screen method-screen" style={{ '--accent': category.accentColor }}>
      <div className="category-bg" style={{ background: category.gradient, opacity: 0.5 }} />

      <NavBar onBack={goBack} title="Cooking Method" />

      <div className="screen-header">
        <h2>How are you<br />cooking it?</h2>
        <p>Affects pull temp via carryover physics</p>
      </div>

      {/* Thickness selector — relevant for carryover. Shown for all proteins; not shown for baked goods */}
      {selection.categoryId !== 'baked' && (
        <div className="thickness-section">
          <h4>{item.thicknessLabel ?? 'Thickness'}</h4>
          <div className="thickness-slider">
            <div className="thickness-value">{thickness.toFixed(1)}"</div>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              value={thickness}
              onChange={e => setThickness(parseFloat(e.target.value))}
              style={{ accentColor: category.accentColor }}
            />
            {/* Labels positioned to match actual slider positions */}
            <div className="thickness-labels" style={{ position: 'relative', height: 16 }}>
              {sliderLabels.map(({ label, value }) => (
                <span
                  key={value}
                  style={{
                    position: 'absolute',
                    left: `${((value - sliderMin) / (sliderMax - sliderMin)) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bone-in / Boneless selector — shown for items that support it (e.g. Prime Rib) */}
      {item.hasBoneInOption && (
        <div className="geometry-section">
          <h4>Bone</h4>
          <div className="geometry-selector">
            <button
              className={`geometry-chip${boneIn ? ' geometry-chip--active' : ''}`}
              onClick={() => setBoneIn(true)}
              style={boneIn ? { borderColor: category.accentColor, color: category.accentColor } : {}}
            >
              🦴 Bone-In
            </button>
            <button
              className={`geometry-chip${!boneIn ? ' geometry-chip--active' : ''}`}
              onClick={() => setBoneIn(false)}
              style={!boneIn ? { borderColor: category.accentColor, color: category.accentColor } : {}}
            >
              Boneless
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(240,240,240,0.4)', marginTop: 4, textAlign: 'center' }}>
            {boneIn
              ? 'Bone insulates one side — slower heat transfer, more uneven gradient, less carryover.'
              : 'Even exposure on all sides — faster heat transfer, more uniform carryover.'}
          </p>
        </div>
      )}

      {/* Wrapped rest toggle — shown for cuts with meaningful rest time */}
      {((doneness?.restMinutes ?? item.restMinutes ?? 0) >= 15 || item.restRangeMinutes || doneness?.restRangeMinutes) && selection.categoryId !== 'baked' && (
        <div className="geometry-section">
          <h4>Rest Method</h4>
          <div className="geometry-selector">
            <button
              className={`geometry-chip${!isWrapped ? ' geometry-chip--active' : ''}`}
              onClick={() => setIsWrapped(false)}
              style={!isWrapped ? { borderColor: category.accentColor, color: category.accentColor } : {}}
            >
              Unwrapped
            </button>
            <button
              className={`geometry-chip${isWrapped ? ' geometry-chip--active' : ''}`}
              onClick={() => setIsWrapped(true)}
              style={isWrapped ? { borderColor: category.accentColor, color: category.accentColor } : {}}
            >
              🌯 Wrapped / Tented
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(240,240,240,0.4)', marginTop: 4, textAlign: 'center' }}>
            {isWrapped
              ? 'Foil or butcher paper traps surface heat — more carryover. Account for this in pull temp.'
              : 'Open-air rest — surface cools freely, less heat conducts inward.'}
          </p>
        </div>
      )}

      {/* Geometry selector — cut shape affects carryover. Shown for beef & pork only. */}
      {showGeometrySelector && (
        <div className="geometry-section">
          <h4>Shape</h4>
          <div className="geometry-selector">
            {Object.entries(GEOMETRY_TYPES).map(([key, { label }]) => (
              <button
                key={key}
                className={`geometry-chip${geometry === key ? ' geometry-chip--active' : ''}`}
                onClick={() => setGeometry(key)}
                style={geometry === key ? { borderColor: category.accentColor, color: category.accentColor } : {}}
              >
                {label}
              </button>
            ))}
          </div>
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
            geometry,
            isWrapped,
            boneIn,
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
                  : <>{method.noCarryoverLabel ?? 'Bath = target • No carryover'}</>
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
