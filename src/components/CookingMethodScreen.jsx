import { useState } from 'react';
import { getCategoryById, getItemById, COOKING_METHODS } from '../data/temperatures';
import { estimateCarryover } from '../utils/carryover';
import NavBar from './NavBar';

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
            <div className="thickness-labels">
              <span>½"</span>
              <span>1"</span>
              <span>1½"</span>
              <span>2"</span>
              <span>3"</span>
            </div>
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
